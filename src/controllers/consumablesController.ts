import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listConsumables(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { category, location_id, search } = request.query as {
        category?: string;
        location_id?: string;
        search?: string;
    };

    let query = supabase
        .schema('zmanage')
        .from('consumables')
        .select(`
            *,
            storage_locations (id, name)
        `)
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('name', { ascending: true });

    if (category) query = query.eq('category', category);
    if (location_id) query = query.eq('location_id', location_id);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    const enriched = (data || []).map((item: any) => ({
        ...item,
        is_low_stock: (item.stock_quantity ?? 0) <= (item.min_reorder_level ?? 5),
        location_name: item.storage_locations?.name || null
    }));

    return reply.send({
        success: true,
        count: enriched.length,
        low_stock_count: enriched.filter((i: any) => i.is_low_stock).length,
        consumables: enriched
    });
}

export async function createConsumable(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as {
        name: string;
        category?: string;
        stock_quantity?: number;
        unit?: string;
        min_reorder_level?: number;
        unit_cost?: number;
        currency?: string;
        location_id?: string;
    };

    if (!body?.name?.trim()) {
        return reply.code(400).send({ error: 'Consumable name is required' });
    }

    const { data, error } = await supabase
        .schema('zmanage')
        .from('consumables')
        .insert({
            client_id: clientId,
            project_id: projectId,
            location_id: body.location_id || null,
            name: body.name.trim(),
            category: body.category?.trim() || 'expendable',
            stock_quantity: Math.max(0, body.stock_quantity ?? 0),
            unit: body.unit?.trim() || 'units',
            min_reorder_level: Math.max(0, body.min_reorder_level ?? 5),
            unit_cost: Math.max(0, body.unit_cost ?? 0),
            currency: body.currency || 'INR'
        })
        .select(`*, storage_locations (id, name)`)
        .single();

    if (error) return reply.code(500).send({ error: error.message });

    logAuditEvent(request, 'CONSUMABLE_CREATED', 'CONSUMABLE', {
        consumable_id: data.id,
        name: data.name,
        stock_quantity: data.stock_quantity
    });

    return reply.code(201).send({ success: true, consumable: data });
}

export async function updateConsumable(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updatePayload: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updatePayload.name = body.name.trim();
    if (body.category !== undefined) updatePayload.category = body.category.trim();
    if (body.stock_quantity !== undefined) updatePayload.stock_quantity = Math.max(0, Number(body.stock_quantity));
    if (body.unit !== undefined) updatePayload.unit = body.unit.trim();
    if (body.min_reorder_level !== undefined) updatePayload.min_reorder_level = Math.max(0, Number(body.min_reorder_level));
    if (body.unit_cost !== undefined) updatePayload.unit_cost = Math.max(0, Number(body.unit_cost));
    if (body.currency !== undefined) updatePayload.currency = body.currency;
    if (body.location_id !== undefined) updatePayload.location_id = body.location_id || null;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('consumables')
        .update(updatePayload)
        .eq('id', id)
        .eq('project_id', projectId)
        .select(`*, storage_locations (id, name)`)
        .single();

    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Consumable not found' });

    logAuditEvent(request, 'CONSUMABLE_UPDATED', 'CONSUMABLE', {
        consumable_id: data.id,
        name: data.name,
        stock_quantity: data.stock_quantity
    });

    return reply.send({ success: true, consumable: data });
}

export async function adjustStock(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as {
        action: 'add' | 'deduct';
        amount: number;
        reason?: string;
    };

    if (!body?.action || !['add', 'deduct'].includes(body.action) || !body.amount || body.amount <= 0) {
        return reply.code(400).send({ error: 'Valid action (add/deduct) and positive amount required' });
    }

    // Fetch current stock
    const { data: current, error: fetchErr } = await supabase
        .schema('zmanage')
        .from('consumables')
        .select('*')
        .eq('id', id)
        .eq('project_id', projectId)
        .single();

    if (fetchErr || !current) return reply.code(404).send({ error: 'Consumable not found' });

    const newStock = body.action === 'add'
        ? (current.stock_quantity || 0) + Number(body.amount)
        : Math.max(0, (current.stock_quantity || 0) - Number(body.amount));

    const { data: updated, error: updateErr } = await supabase
        .schema('zmanage')
        .from('consumables')
        .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select(`*, storage_locations (id, name)`)
        .single();

    if (updateErr) return reply.code(500).send({ error: updateErr.message });

    logAuditEvent(request, 'CONSUMABLE_STOCK_ADJUSTED', 'CONSUMABLE', {
        consumable_id: id,
        name: current.name,
        action: body.action,
        amount: body.amount,
        previous_stock: current.stock_quantity,
        new_stock: newStock,
        reason: body.reason || null
    });

    return reply.send({
        success: true,
        previous_stock: current.stock_quantity,
        new_stock: newStock,
        consumable: updated
    });
}

export async function deleteConsumable(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('consumables')
        .update({ deleted_flag: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Consumable not found' });

    logAuditEvent(request, 'CONSUMABLE_DELETED', 'CONSUMABLE', {
        consumable_id: id,
        name: data.name
    });

    return reply.send({ success: true, message: 'Consumable deleted successfully' });
}
