import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

export async function listAssets(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { category, status, search } = request.query as { category?: string; status?: string; search?: string };

    let query = supabase
        .schema('zresource')
        .from('assets')
        .select('*')
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('created_at', { ascending: false });

    if (category) query = query.eq('category', category);
    if (status) query = query.eq('status', status);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    return reply.send({ success: true, count: data?.length || 0, assets: data });
}

export async function createAsset(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as any;

    const { data, error } = await supabase
        .schema('zresource')
        .from('assets')
        .insert({
            client_id: clientId,
            project_id: projectId,
            name: body.name,
            code: body.code,
            category: body.category,
            serial_number: body.serial_number,
            condition: body.condition || 'excellent',
            status: body.status || 'available',
            purchase_date: body.purchase_date,
            purchase_cost: body.purchase_cost,
            currency: body.currency || 'INR',
            image_url: body.image_url,
            specs: body.specs || {},
            maintenance_notes: body.maintenance_notes
        })
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });
    return reply.code(201).send({ success: true, asset: data });
}

export async function updateAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const { data, error } = await supabase
        .schema('zresource')
        .from('assets')
        .update({
            ...body,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });
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
        .schema('zresource')
        .from('assets')
        .update({ status: 'on_shoot', updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    // Update lock status
    await supabase
        .schema('zresource')
        .from('asset_locks')
        .update({
            status: 'checked_out',
            checked_out_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('asset_id', id)
        .eq('allocation_id', allocation_id);

    return reply.send({ success: true, asset: data });
}

export async function checkinAsset(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const { condition, return_notes } = request.body as { condition?: string; return_notes?: string };

    const { data, error } = await supabase
        .schema('zresource')
        .from('assets')
        .update({
            status: 'available',
            condition: condition || 'excellent',
            maintenance_notes: return_notes,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(400).send({ error: error.message });

    await supabase
        .schema('zresource')
        .from('asset_locks')
        .update({
            status: 'returned',
            checked_in_at: new Date().toISOString(),
            return_condition: condition || 'excellent',
            updated_at: new Date().toISOString()
        })
        .eq('asset_id', id)
        .eq('status', 'checked_out');

    return reply.send({ success: true, asset: data });
}
