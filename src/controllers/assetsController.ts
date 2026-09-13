import { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listAssets(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { category, status, search, location_id } = request.query as {
        category?: string;
        status?: string;
        search?: string;
        location_id?: string;
    };

    let query = supabase
        .schema('zmanage')
        .from('assets')
        .select(`
            *,
            storage_locations (id, name)
        `)
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    if (location_id) query = query.eq('location_id', location_id);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    const enriched = (data || []).map((asset: any) => {
        let currentBookValue = asset.purchase_cost || 0;
        if (asset.is_depreciation_applicable && asset.purchase_cost && asset.useful_life_months) {
            const purchaseDate = asset.purchase_date ? new Date(asset.purchase_date) : new Date(asset.created_at);
            const now = new Date();
            const ageMonths = Math.max(0, (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth()));
            const salvage = Number(asset.salvage_value) || 0;
            const cost = Number(asset.purchase_cost) || 0;
            const depreciableAmount = Math.max(0, cost - salvage);
            const monthlyDepreciation = depreciableAmount / asset.useful_life_months;
            currentBookValue = Math.max(salvage, Math.round((cost - (monthlyDepreciation * ageMonths)) * 100) / 100);
        }

        return {
            ...asset,
            location_name: asset.storage_locations?.name || null,
            book_value: currentBookValue
        };
    });

    return reply.send({ success: true, count: enriched.length, assets: enriched });
}

export async function createAsset(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as any;

    // Auto-generate human-readable asset code (e.g. CAM-001, LNS-002) if not manually supplied
    let assetCode = (body.code || '').trim();
    if (!assetCode && body.category) {
        const { data: generatedCode } = await supabase.rpc('fn_generate_next_asset_code', {
            p_project_id: projectId,
            p_category: body.category
        });
        assetCode = generatedCode || `${body.category.substring(0, 3).toUpperCase()}-001`;
    }

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .insert({
            client_id: clientId,
            project_id: projectId,
            name: body.name,
            code: assetCode,
            category: body.category,
            serial_number: body.serial_number || 'N/A',
            condition: body.condition || 'excellent',
            status: body.status || 'available',
            purchase_date: body.purchase_date,
            purchase_cost: body.purchase_cost,
            currency: body.currency || 'INR',
            image_url: body.image_url,
            specs: body.specs || {},
            maintenance_notes: body.maintenance_notes,
            location_id: body.location_id || null,
            is_maintenance_applicable: Boolean(body.is_maintenance_applicable),
            maintenance_interval_days: body.maintenance_interval_days ? Number(body.maintenance_interval_days) : 90,
            last_serviced_at: body.last_serviced_at || null,
            next_service_due: body.next_service_due || null,
            is_depreciation_applicable: Boolean(body.is_depreciation_applicable),
            salvage_value: body.salvage_value !== undefined ? Number(body.salvage_value) : 0,
            useful_life_months: body.useful_life_months ? Number(body.useful_life_months) : 36
        })
        .select(`*, storage_locations (id, name)`)
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'ASSET_CREATED', 'ASSET', {
        asset_id: data.id,
        name: data.name,
        code: assetCode,
        category: data.category,
        purchase_cost: data.purchase_cost
    });

    return reply.code(201).send({ success: true, asset: data });
}

export async function updateAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as any;

    if (!id) {
        return reply.code(400).send({ error: 'Asset ID is required' });
    }

    const { data: existingAsset } = await supabase
        .schema('zmanage')
        .from('assets')
        .select('*')
        .eq('id', id)
        .eq('project_id', projectId)
        .maybeSingle();

    if (!existingAsset) {
        return reply.code(404).send({ error: 'Asset not found' });
    }

    const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString()
    };

    if (body.name !== undefined) updatePayload.name = typeof body.name === 'string' ? body.name.trim() : body.name;
    if (body.code !== undefined) updatePayload.code = typeof body.code === 'string' ? (body.code.trim() || null) : body.code;
    if (body.category !== undefined) updatePayload.category = typeof body.category === 'string' ? (body.category.trim() || 'General') : body.category;
    if (body.serial_number !== undefined) updatePayload.serial_number = typeof body.serial_number === 'string' ? (body.serial_number.trim() || null) : body.serial_number;
    if (body.condition !== undefined) updatePayload.condition = body.condition;
    if (body.status !== undefined) updatePayload.status = body.status;
    if (body.purchase_cost !== undefined) updatePayload.purchase_cost = Number(body.purchase_cost) || 0;
    if (body.purchase_date !== undefined) updatePayload.purchase_date = body.purchase_date || null;
    if (body.currency !== undefined) updatePayload.currency = body.currency || 'INR';
    if (body.image_url !== undefined) updatePayload.image_url = body.image_url || null;
    if (body.location_id !== undefined) updatePayload.location_id = body.location_id || null;
    if (body.is_maintenance_applicable !== undefined) updatePayload.is_maintenance_applicable = Boolean(body.is_maintenance_applicable);
    if (body.maintenance_interval_days !== undefined) updatePayload.maintenance_interval_days = Number(body.maintenance_interval_days) || 90;
    if (body.last_serviced_at !== undefined) updatePayload.last_serviced_at = body.last_serviced_at || null;
    if (body.next_service_due !== undefined) updatePayload.next_service_due = body.next_service_due || null;
    if (body.is_depreciation_applicable !== undefined) updatePayload.is_depreciation_applicable = Boolean(body.is_depreciation_applicable);
    if (body.salvage_value !== undefined) updatePayload.salvage_value = Number(body.salvage_value) || 0;
    if (body.useful_life_months !== undefined) updatePayload.useful_life_months = Number(body.useful_life_months) || 36;

    // Handle specs and notes history preservation
    const currentSpecs = (body.specs !== undefined ? body.specs : existingAsset.specs) || {};
    const notesHistory: any[] = Array.isArray(currentSpecs.notes_history) ? [...currentSpecs.notes_history] : [];

    // Fallback: populate existing note if notes_history is empty
    if (notesHistory.length === 0 && existingAsset.maintenance_notes) {
        notesHistory.push({
            id: randomUUID(),
            note: existingAsset.maintenance_notes,
            condition: existingAsset.condition || 'excellent',
            action: 'maintenance',
            created_at: existingAsset.updated_at || existingAsset.created_at || new Date().toISOString()
        });
    }

    if (body.maintenance_notes !== undefined) {
        const trimmedNote = typeof body.maintenance_notes === 'string' ? body.maintenance_notes.trim() : '';
        updatePayload.maintenance_notes = trimmedNote || null;

        if (trimmedNote && trimmedNote !== notesHistory[0]?.note) {
            notesHistory.unshift({
                id: randomUUID(),
                note: trimmedNote,
                condition: body.condition || existingAsset.condition || 'excellent',
                action: 'maintenance',
                created_at: new Date().toISOString()
            });
        }
    }

    currentSpecs.notes_history = notesHistory;
    updatePayload.specs = currentSpecs;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .update(updatePayload)
        .eq('id', id)
        .eq('project_id', projectId)
        .select(`*, storage_locations (id, name)`)
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'ASSET_UPDATED', 'ASSET', {
        asset_id: id,
        name: data.name,
        code: data.code,
        condition: data.condition,
        status: data.status,
        note: body.maintenance_notes ? String(body.maintenance_notes).trim() : undefined,
        updated_fields: Object.keys(updatePayload).filter(k => k !== 'specs' && k !== 'updated_at')
    });

    return reply.send({ success: true, asset: data });
}

export async function checkAssetAvailability(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { asset_id, start_time, end_time, exclude_allocation_id } = request.body as {
        asset_id: string;
        start_time: string;
        end_time: string;
        exclude_allocation_id?: string;
    };

    const { data, error } = await supabase.rpc('fn_check_asset_availability', {
        p_project_id: projectId,
        p_asset_id: asset_id,
        p_start_time: start_time,
        p_end_time: end_time,
        p_exclude_allocation_id: exclude_allocation_id || null
    });

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ asset_id, is_available: Boolean(data) });
}

export async function checkoutAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const { allocation_id } = request.body as { allocation_id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .update({ status: 'on_shoot', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    // Update lock status
    await supabase
        .schema('zmanage')
        .from('asset_locks')
        .update({
            status: 'checked_out',
            checked_out_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('asset_id', id)
        .eq('allocation_id', allocation_id);

    logAuditEvent(request, 'ASSET_CHECKOUT', 'ASSET', {
        asset_id: id,
        name: data.name,
        code: data.code,
        allocation_id
    });

    return reply.send({ success: true, asset: data });
}

export async function checkinAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const { condition, return_notes } = request.body as { condition?: string; return_notes?: string };

    const { data: existingAsset } = await supabase
        .schema('zmanage')
        .from('assets')
        .select('*')
        .eq('id', id)
        .eq('project_id', projectId)
        .maybeSingle();

    if (!existingAsset) {
        return reply.code(404).send({ error: 'Asset not found' });
    }

    const currentSpecs = existingAsset.specs || {};
    const notesHistory: any[] = Array.isArray(currentSpecs.notes_history) ? [...currentSpecs.notes_history] : [];

    if (notesHistory.length === 0 && existingAsset.maintenance_notes) {
        notesHistory.push({
            id: randomUUID(),
            note: existingAsset.maintenance_notes,
            condition: existingAsset.condition || 'excellent',
            action: 'maintenance',
            created_at: existingAsset.updated_at || existingAsset.created_at || new Date().toISOString()
        });
    }

    const trimmedReturnNote = return_notes ? return_notes.trim() : '';
    if (trimmedReturnNote) {
        notesHistory.unshift({
            id: randomUUID(),
            note: trimmedReturnNote,
            condition: condition || 'excellent',
            action: 'return_inspection',
            created_at: new Date().toISOString()
        });
    }

    currentSpecs.notes_history = notesHistory;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .update({
            status: 'available',
            condition: condition || 'excellent',
            maintenance_notes: trimmedReturnNote || existingAsset.maintenance_notes,
            specs: currentSpecs,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    await supabase
        .schema('zmanage')
        .from('asset_locks')
        .update({
            status: 'returned',
            checked_in_at: new Date().toISOString(),
            return_condition: condition || 'excellent',
            updated_at: new Date().toISOString()
        })
        .eq('asset_id', id)
        .eq('status', 'checked_out');

    logAuditEvent(request, 'ASSET_CHECKIN', 'ASSET', {
        asset_id: id,
        name: data.name,
        code: data.code,
        return_condition: condition || 'excellent',
        note: trimmedReturnNote || null
    });

    return reply.send({ success: true, asset: data });
}

export async function addAssetNote(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const { note, condition, action } = (request.body || {}) as { note: string; condition?: string; action?: string };

    if (!note || !note.trim()) {
        return reply.code(400).send({ error: 'Note content is required' });
    }

    const { data: existingAsset } = await supabase
        .schema('zmanage')
        .from('assets')
        .select('*')
        .eq('id', id)
        .eq('project_id', projectId)
        .maybeSingle();

    if (!existingAsset) {
        return reply.code(404).send({ error: 'Asset not found' });
    }

    const currentSpecs = existingAsset.specs || {};
    const notesHistory: any[] = Array.isArray(currentSpecs.notes_history) ? [...currentSpecs.notes_history] : [];

    if (notesHistory.length === 0 && existingAsset.maintenance_notes) {
        notesHistory.push({
            id: randomUUID(),
            note: existingAsset.maintenance_notes,
            condition: existingAsset.condition || 'excellent',
            action: 'maintenance',
            created_at: existingAsset.updated_at || existingAsset.created_at || new Date().toISOString()
        });
    }

    const newEntry = {
        id: randomUUID(),
        note: note.trim(),
        condition: condition || existingAsset.condition || 'excellent',
        action: action || 'maintenance',
        created_at: new Date().toISOString()
    };

    notesHistory.unshift(newEntry);
    currentSpecs.notes_history = notesHistory;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .update({
            condition: condition || existingAsset.condition,
            maintenance_notes: note.trim(),
            specs: currentSpecs,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'ASSET_NOTE_ADDED', 'ASSET', {
        asset_id: id,
        name: data.name,
        code: data.code,
        condition: data.condition,
        note: note.trim(),
        action: action || 'maintenance'
    });

    return reply.send({
        success: true,
        asset: data,
        entry: newEntry,
        notes_history: notesHistory
    });
}

export async function deleteAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('assets')
        .update({
            deleted_flag: true,
            is_active: false,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    logAuditEvent(request, 'ASSET_DELETED', 'ASSET', {
        asset_id: id,
        name: data.name,
        code: data.code
    });

    return reply.send({ success: true, message: 'Asset deleted successfully', asset: data });
}

export async function getAssetHistory(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data: asset, error: assetErr } = await supabase
        .schema('zmanage')
        .from('assets')
        .select('*')
        .eq('id', id)
        .eq('project_id', projectId)
        .single();

    if (assetErr || !asset) {
        return reply.code(404).send({ error: 'Asset not found' });
    }

    const { data: history, error: historyErr } = await supabase
        .schema('zmanage')
        .from('asset_locks')
        .select(`
            id,
            status,
            lock_start,
            lock_end,
            checked_out_at,
            checked_in_at,
            return_condition,
            created_at,
            allocations (
                id,
                title,
                venue,
                client_name,
                client_phone,
                start_time,
                end_time,
                status
            )
        `)
        .eq('asset_id', id)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

    if (historyErr) {
        return reply.code(500).send({ error: historyErr.message });
    }

    const notes_history: any[] = Array.isArray(asset.specs?.notes_history) ? [...asset.specs.notes_history] : [];

    if (notes_history.length === 0 && asset.maintenance_notes) {
        notes_history.push({
            id: 'legacy-init',
            note: asset.maintenance_notes,
            condition: asset.condition || 'excellent',
            action: 'return_inspection',
            created_at: asset.updated_at || asset.created_at || new Date().toISOString()
        });
    }

    return reply.send({
        success: true,
        asset,
        history: history || [],
        notes_history
    });
}
