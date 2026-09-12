import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

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

    return reply.send({ success: true, message: 'Allocation cancelled and resources released' });
}
