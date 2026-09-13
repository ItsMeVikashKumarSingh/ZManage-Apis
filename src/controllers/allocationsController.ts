import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listAllocations(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { start_date, end_date } = request.query as { start_date?: string; end_date?: string };

    let query = supabase
        .schema('zmanage')
        .from('allocations')
        .select(`
            *,
            asset_locks (*, assets (name, category, serial_number)),
            worker_shifts (*, workers (name, primary_role, phone))
        `)
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('start_time', { ascending: true });

    if (start_date) query = query.gte('start_time', start_date);
    if (end_date) query = query.lte('end_time', end_date);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    return reply.send({ success: true, count: data?.length || 0, allocations: data });
}

export async function createAllocation(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as {
        title: string;
        client_name?: string;
        client_phone?: string;
        venue?: string;
        start_time: string;
        end_time: string;
        notes?: string;
        asset_ids?: string[];
        crew?: Array<{
            worker_id: string;
            assigned_role: string;
            call_time?: string;
            wrap_time?: string;
            agreed_pay?: number;
        }>;
    };

    const { title, client_name, client_phone, venue, start_time, end_time, notes, asset_ids, crew } = body;

    // 1. Collision Verification for Assets
    if (asset_ids && asset_ids.length > 0) {
        for (const assetId of asset_ids) {
            const { data: isAvailable } = await supabase.rpc('fn_check_asset_availability', {
                p_project_id: projectId,
                p_asset_id: assetId,
                p_start_time: start_time,
                p_end_time: end_time
            });

            if (!isAvailable) {
                // Fetch asset name for error message
                const { data: asset } = await supabase
                    .schema('zmanage')
                    .from('assets')
                    .select('name')
                    .eq('id', assetId)
                    .single();

                return reply.code(409).send({
                    error: `Collision detected: Equipment '${asset?.name || assetId}' is already locked for an overlapping event.`
                });
            }
        }
    }

    // 2. Collision Verification for Workers
    if (crew && crew.length > 0) {
        for (const member of crew) {
            const callTime = member.call_time || start_time;
            const wrapTime = member.wrap_time || end_time;

            const { data: isAvailable } = await supabase.rpc('fn_check_worker_availability', {
                p_project_id: projectId,
                p_worker_id: member.worker_id,
                p_start_time: callTime,
                p_end_time: wrapTime
            });

            if (!isAvailable) {
                const { data: worker } = await supabase
                    .schema('zmanage')
                    .from('workers')
                    .select('name')
                    .eq('id', member.worker_id)
                    .single();

                return reply.code(409).send({
                    error: `Collision detected: Team member '${worker?.name || member.worker_id}' is already booked on an overlapping shoot.`
                });
            }
        }
    }

    // 3. Create Allocation Record
    const { data: allocation, error: allocError } = await supabase
        .schema('zmanage')
        .from('allocations')
        .insert({
            client_id: clientId,
            project_id: projectId,
            title,
            client_name,
            client_phone,
            venue,
            start_time,
            end_time,
            notes,
            status: 'confirmed'
        })
        .select()
        .single();

    if (allocError) return reply.code(400).send({ error: allocError.message });

    // 4. Lock Assets
    if (asset_ids && asset_ids.length > 0) {
        const assetLocks = asset_ids.map(id => ({
            client_id: clientId,
            project_id: projectId,
            asset_id: id,
            allocation_id: allocation.id,
            lock_start: start_time,
            lock_end: end_time,
            status: 'locked'
        }));
        await supabase.schema('zmanage').from('asset_locks').insert(assetLocks);
    }

    // 5. Dispatch Shifts & Stage Worker Payouts
    if (crew && crew.length > 0) {
        for (const member of crew) {
            const callTime = member.call_time || start_time;
            const wrapTime = member.wrap_time || end_time;
            const pay = member.agreed_pay || 0;

            const { data: shift } = await supabase
                .schema('zmanage')
                .from('worker_shifts')
                .insert({
                    client_id: clientId,
                    project_id: projectId,
                    worker_id: member.worker_id,
                    allocation_id: allocation.id,
                    assigned_role: member.assigned_role,
                    call_time: callTime,
                    wrap_time: wrapTime,
                    agreed_pay: pay,
                    attendance_status: 'scheduled'
                })
                .select()
                .single();

            // Auto-stage pending worker payout in financial ledger
            if (shift && pay > 0) {
                await supabase
                    .schema('zmanage')
                    .from('worker_payouts')
                    .insert({
                        client_id: clientId,
                        project_id: projectId,
                        worker_id: member.worker_id,
                        shift_id: shift.id,
                        allocation_id: allocation.id,
                        base_amount: pay,
                        total_amount: pay,
                        payout_status: 'pending'
                    });
            }
        }
    }

    logAuditEvent(request, 'SHOOT_ALLOCATED', 'ALLOCATION', {
        allocation_id: allocation.id,
        title: allocation.title || body.title,
        venue: allocation.venue || body.venue,
        start_time: allocation.start_time,
        end_time: allocation.end_time,
        locked_gear_count: (asset_ids || []).length,
        crew_count: (crew || []).length
    });

    return reply.code(201).send({
        success: true,
        allocation_id: allocation.id,
        allocation
    });
}

export async function deleteAllocation(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    // Soft delete allocation
    const { error } = await supabase
        .schema('zmanage')
        .from('allocations')
        .update({ status: 'cancelled', deleted_flag: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId);

    if (error) return reply.code(400).send({ error: error.message });

    // Release asset locks
    await supabase
        .schema('zmanage')
        .from('asset_locks')
        .update({ status: 'released', deleted_flag: true })
        .eq('allocation_id', id);

    logAuditEvent(request, 'SHOOT_CANCELLED', 'ALLOCATION', {
        allocation_id: id
    });

    return reply.send({ success: true, message: 'Allocation cancelled and resources released' });
}

// 1-Tap Booking Synchronization: Step 1 - Discover Client Bookings from Studio Platform
export async function getBookingCandidates(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;

    // 1. Fetch confirmed bookings for this client tenant from studio.tbl_bookings
    const { data: studioBookings, error: bookingsError } = await supabase
        .schema('studio')
        .from('tbl_bookings')
        .select('*')
        .eq('client_id', clientId)
        .eq('tb_deleted_flag', false)
        .order('tb_created_at', { ascending: false });

    if (bookingsError) {
        return reply.code(500).send({ error: bookingsError.message });
    }

    // 2. Fetch active allocations in zmanage for this project to detect already synced items
    const { data: existingAllocations, error: allocError } = await supabase
        .schema('zmanage')
        .from('allocations')
        .select('id, title, client_name, client_phone, start_time, notes')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    if (allocError) {
        return reply.code(500).send({ error: allocError.message });
    }

    const allocationsList = existingAllocations || [];

    // Helper: Map candidate
    const candidates = (studioBookings || []).map(b => {
        const paymentDetails = b.tb_payment_details || {};
        const customerJson = b.tb_customer_json || {};
        const packageSnapshot = b.tb_package_snapshot || {};

        const packageName = packageSnapshot.title || paymentDetails.packageName || 'Studio Client Shoot';
        const clientName = customerJson.customerName || paymentDetails.customerName || customerJson.name || 'Valued Client';
        const clientPhone = customerJson.customerPhone || paymentDetails.customerPhone || customerJson.phone || '';
        const clientEmail = b.tb_user_email || customerJson.customerEmail || paymentDetails.customerEmail || '';
        const venue = customerJson.venue || paymentDetails.venue || 'Studio / On-Location';
        const orderId = paymentDetails.order_id || b.tb_id.slice(0, 8);

        // Normalize date and time windows
        const rawDate = paymentDetails.event_date || customerJson.event_date || b.tb_created_at?.split('T')[0];
        let eventDateStr = rawDate;
        if (eventDateStr && eventDateStr.includes('T')) {
            eventDateStr = eventDateStr.split('T')[0];
        }

        const rawTime = paymentDetails.event_time || customerJson.event_time || '09:00';
        let safeTime = rawTime.trim();
        if (!safeTime || !safeTime.includes(':')) {
            safeTime = '09:00';
        }
        if (safeTime.length === 4 && safeTime.indexOf(':') === 1) {
            safeTime = `0${safeTime}`;
        }

        const startTime = `${eventDateStr}T${safeTime}:00Z`;
        // Wrap time: 8 hours later or 18:00
        const endTime = `${eventDateStr}T18:00:00Z`;

        // Check if already synced via notes reference or matching phone + date
        const isAlreadySynced = allocationsList.some(alloc => {
            if (alloc.notes && alloc.notes.includes(b.tb_id)) return true;
            if (alloc.notes && alloc.notes.includes(orderId)) return true;
            const sameDate = alloc.start_time?.startsWith(eventDateStr);
            const samePhone = clientPhone && alloc.client_phone === clientPhone;
            return Boolean(sameDate && samePhone);
        });

        return {
            booking_id: b.tb_id,
            order_id: orderId,
            package_name: packageName,
            client_name: clientName,
            client_phone: clientPhone,
            client_email: clientEmail,
            event_date: eventDateStr,
            start_time: startTime,
            end_time: endTime,
            venue,
            amount: Number(b.tb_amount) || 0,
            status: b.tb_status || 'confirmed',
            is_offline: b.tb_reference_type === 'OFFLINE_BOOKING' || customerJson.source === 'offline',
            is_already_synced: isAlreadySynced
        };
    });

    return reply.send({
        success: true,
        total_candidates: candidates.length,
        already_synced: candidates.filter(c => c.is_already_synced).length,
        candidates
    });
}

// 1-Tap Booking Synchronization: Step 2 - Batch Sync Selected Bookings
export async function batchSyncBookings(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const { selected_bookings } = request.body as {
        selected_bookings: Array<{
            booking_id: string;
            title: string;
            client_name?: string;
            client_phone?: string;
            venue?: string;
            start_time: string;
            end_time: string;
            notes?: string;
        }>;
    };

    if (!selected_bookings || selected_bookings.length === 0) {
        return reply.code(400).send({ error: 'No bookings selected for synchronization' });
    }

    const payload = selected_bookings.map(item => ({
        client_id: clientId,
        project_id: projectId,
        title: item.title,
        client_name: item.client_name || 'Studio Client',
        client_phone: item.client_phone || '',
        venue: item.venue || 'Studio / On-Location',
        start_time: item.start_time,
        end_time: item.end_time,
        status: 'confirmed',
        notes: `${item.notes ? item.notes + ' ' : ''}[Synced from Studio Booking Ref: ${item.booking_id}]`
    }));

    const { data, error } = await supabase
        .schema('zmanage')
        .from('allocations')
        .insert(payload)
        .select();

    if (error) {
        return reply.code(400).send({ error: error.message });
    }

    return reply.code(201).send({
        success: true,
        synced_count: data?.length || 0,
        allocations: data
    });
}

// Manual Creation of Offline / Walk-in Studio Orders
export async function createOfflineBooking(request: FastifyRequest, reply: FastifyReply) {
    const { clientId } = request.tenantContext!;
    const {
        client_name,
        client_phone,
        client_email,
        package_name,
        event_date,
        event_time,
        venue,
        amount,
        payment_status,
        notes
    } = request.body as {
        client_name: string;
        client_phone?: string;
        client_email?: string;
        package_name: string;
        event_date: string;
        event_time?: string;
        venue?: string;
        amount?: number | string;
        payment_status?: string;
        notes?: string;
    };

    if (!client_name || !event_date || !package_name) {
        return reply.code(400).send({ error: 'Client name, event date, and package name are required' });
    }

    const orderId = `OFFLINE_${Date.now()}`;
    const safeAmount = Number(amount) || 0;
    const safeEmail = client_email?.trim() || `${client_phone ? client_phone.replace(/[^0-9]/g, '') : 'offline'}@offline.client`;
    const safeTime = event_time?.trim() || '10:00';
    const safeVenue = venue?.trim() || 'Studio Floor / On-Location';
    const safePayStatus = payment_status || 'pending';

    const customerJson = {
        customerName: client_name.trim(),
        customerPhone: client_phone?.trim() || '',
        customerEmail: safeEmail,
        venue: safeVenue,
        event_date: event_date,
        event_time: safeTime,
        order_id: orderId,
        packageName: package_name.trim(),
        source: 'offline',
        payment_mode: safePayStatus,
        notes: notes?.trim() || ''
    };

    const paymentDetails = {
        order_id: orderId,
        customerName: client_name.trim(),
        customerPhone: client_phone?.trim() || '',
        customerEmail: safeEmail,
        venue: safeVenue,
        event_date: event_date,
        event_time: safeTime,
        packageName: package_name.trim(),
        total_amount: String(safeAmount),
        payment_mode: safePayStatus,
        source: 'offline'
    };

    const packageSnapshot = {
        title: package_name.trim(),
        price: String(safeAmount),
        is_offline: true
    };

    const { data, error } = await supabase
        .schema('studio')
        .from('tbl_bookings')
        .insert({
            client_id: clientId,
            tb_user_email: safeEmail,
            tb_amount: safeAmount,
            tb_status: 'confirmed',
            tb_reference_type: 'OFFLINE_BOOKING',
            tb_reference_id: orderId,
            tb_package_snapshot: packageSnapshot,
            tb_customer_json: customerJson,
            tb_payment_details: paymentDetails,
            tb_status_flag: true,
            tb_deleted_flag: false
        })
        .select()
        .single();

    if (error) {
        return reply.code(400).send({ error: error.message });
    }

    logAuditEvent(request, 'OFFLINE_BOOKING_CREATED', 'BOOKING', {
        booking_id: data.tb_id,
        order_id: orderId,
        client_name: client_name.trim(),
        package_name: package_name.trim(),
        amount: safeAmount,
        event_date: event_date
    });

    return reply.code(201).send({
        success: true,
        message: 'Offline booking created successfully',
        booking: data
    });
}


