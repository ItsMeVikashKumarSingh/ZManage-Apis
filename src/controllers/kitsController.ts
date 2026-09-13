import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listKits(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { location_id, search } = request.query as { location_id?: string; search?: string };

    let query = supabase
        .schema('zmanage')
        .from('asset_kits')
        .select(`
            *,
            storage_locations (id, name),
            kit_items (
                id,
                item_type,
                category_or_name,
                specific_asset_id,
                consumable_id,
                quantity_required,
                assets (id, name, code, condition, status),
                consumables (id, name, stock_quantity, unit)
            )
        `)
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('name', { ascending: true });

    if (location_id) query = query.eq('location_id', location_id);
    if (search) query = query.ilike('name', `%${search}%`);

    const { data, error } = await query;
    if (error) return reply.code(500).send({ error: error.message });

    const enriched = (data || []).map((kit: any) => ({
        ...kit,
        location_name: kit.storage_locations?.name || null,
        items: kit.kit_items || []
    }));

    return reply.send({ success: true, count: enriched.length, kits: enriched });
}

export async function createKit(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as {
        name: string;
        code?: string;
        category?: string;
        total_kits_count?: number;
        location_id?: string;
        description?: string;
        items?: Array<{
            item_type?: string;
            category_or_name: string;
            specific_asset_id?: string;
            consumable_id?: string;
            quantity_required: number;
        }>;
    };

    if (!body?.name?.trim()) {
        return reply.code(400).send({ error: 'Kit name is required' });
    }

    // Auto-generate kit code if empty
    let kitCode = (body.code || '').trim();
    if (!kitCode) {
        const { count } = await supabase
            .schema('zmanage')
            .from('asset_kits')
            .select('*', { count: 'exact', head: true })
            .eq('project_id', projectId);
        kitCode = `KIT-${String((count || 0) + 1).padStart(3, '0')}`;
    }

    // 1. Insert Kit Master
    const { data: kit, error: kitErr } = await supabase
        .schema('zmanage')
        .from('asset_kits')
        .insert({
            client_id: clientId,
            project_id: projectId,
            location_id: body.location_id || null,
            name: body.name.trim(),
            code: kitCode,
            category: body.category?.trim() || 'production_kit',
            total_kits_count: Math.max(1, body.total_kits_count ?? 1),
            description: body.description?.trim() || null,
            is_active: true
        })
        .select(`*, storage_locations (id, name)`)
        .single();

    if (kitErr) return reply.code(500).send({ error: kitErr.message });

    // 2. Insert Kit Items
    let insertedItems: any[] = [];
    if (body.items && body.items.length > 0) {
        const itemsPayload = body.items.map((item) => ({
            kit_id: kit.id,
            item_type: item.item_type || 'asset_category',
            category_or_name: item.category_or_name.trim(),
            specific_asset_id: item.specific_asset_id || null,
            consumable_id: item.consumable_id || null,
            quantity_required: Math.max(1, item.quantity_required ?? 1)
        }));

        const { data: itemsData, error: itemsErr } = await supabase
            .schema('zmanage')
            .from('kit_items')
            .insert(itemsPayload)
            .select();

        if (itemsErr) {
            // Clean up created kit
            await supabase.schema('zmanage').from('asset_kits').delete().eq('id', kit.id);
            return reply.code(500).send({ error: itemsErr.message });
        }
        insertedItems = itemsData || [];
    }

    logAuditEvent(request, 'KIT_CREATED', 'KIT', {
        kit_id: kit.id,
        name: kit.name,
        code: kit.code,
        total_kits_count: kit.total_kits_count,
        items_count: insertedItems.length
    });

    return reply.code(201).send({
        success: true,
        kit: {
            ...kit,
            items: insertedItems
        }
    });
}

export async function updateKit(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as any;

    const updatePayload: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updatePayload.name = body.name.trim();
    if (body.code !== undefined) updatePayload.code = body.code.trim();
    if (body.category !== undefined) updatePayload.category = body.category.trim();
    if (body.total_kits_count !== undefined) updatePayload.total_kits_count = Math.max(1, Number(body.total_kits_count));
    if (body.location_id !== undefined) updatePayload.location_id = body.location_id || null;
    if (body.description !== undefined) updatePayload.description = body.description?.trim() || null;
    if (body.is_active !== undefined) updatePayload.is_active = body.is_active;

    const { data: kit, error: kitErr } = await supabase
        .schema('zmanage')
        .from('asset_kits')
        .update(updatePayload)
        .eq('id', id)
        .eq('project_id', projectId)
        .select(`*, storage_locations (id, name)`)
        .single();

    if (kitErr) return reply.code(500).send({ error: kitErr.message });
    if (!kit) return reply.code(404).send({ error: 'Kit not found' });

    // Update items if provided
    if (body.items && Array.isArray(body.items)) {
        await supabase.schema('zmanage').from('kit_items').delete().eq('kit_id', id);

        if (body.items.length > 0) {
            const itemsPayload = body.items.map((item: any) => ({
                kit_id: id,
                item_type: item.item_type || 'asset_category',
                category_or_name: (item.category_or_name || '').trim(),
                specific_asset_id: item.specific_asset_id || null,
                consumable_id: item.consumable_id || null,
                quantity_required: Math.max(1, Number(item.quantity_required) || 1)
            }));

            await supabase.schema('zmanage').from('kit_items').insert(itemsPayload);
        }
    }

    const { data: freshItems } = await supabase
        .schema('zmanage')
        .from('kit_items')
        .select('*')
        .eq('kit_id', id);

    logAuditEvent(request, 'KIT_UPDATED', 'KIT', {
        kit_id: kit.id,
        name: kit.name,
        code: kit.code,
        total_kits_count: kit.total_kits_count
    });

    return reply.send({
        success: true,
        kit: {
            ...kit,
            items: freshItems || []
        }
    });
}

export async function deleteKit(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('asset_kits')
        .update({ deleted_flag: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Kit not found' });

    logAuditEvent(request, 'KIT_DELETED', 'KIT', {
        kit_id: id,
        name: data.name
    });

    return reply.send({ success: true, message: 'Kit deleted successfully' });
}
