import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { logAuditEvent } from '../utils/auditLogger';

export async function listVaults(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;

    const { data: vaults, error } = await supabase
        .schema('zmanage')
        .from('storage_locations')
        .select('*')
        .eq('project_id', projectId)
        .eq('deleted_flag', false)
        .order('name', { ascending: true });

    if (error) return reply.code(500).send({ error: error.message });

    // Fetch counts of assets, kits, consumables assigned to each vault
    const { data: assetCounts } = await supabase
        .schema('zmanage')
        .from('assets')
        .select('location_id')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    const { data: kitCounts } = await supabase
        .schema('zmanage')
        .from('asset_kits')
        .select('location_id')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    const { data: consumableCounts } = await supabase
        .schema('zmanage')
        .from('consumables')
        .select('location_id')
        .eq('project_id', projectId)
        .eq('deleted_flag', false);

    const enrichedVaults = (vaults || []).map((vault: any) => {
        const totalAssets = (assetCounts || []).filter((a: any) => a.location_id === vault.id).length;
        const totalKits = (kitCounts || []).filter((k: any) => k.location_id === vault.id).length;
        const totalConsumables = (consumableCounts || []).filter((c: any) => c.location_id === vault.id).length;
        return {
            ...vault,
            asset_count: totalAssets,
            kit_count: totalKits,
            consumable_count: totalConsumables,
            total_items: totalAssets + totalKits + totalConsumables
        };
    });

    return reply.send({ success: true, count: enrichedVaults.length, vaults: enrichedVaults });
}

export async function createVault(request: FastifyRequest, reply: FastifyReply) {
    const { clientId, projectId } = request.tenantContext!;
    const body = request.body as { name: string; description?: string };

    if (!body?.name?.trim()) {
        return reply.code(400).send({ error: 'Vault name is required' });
    }

    const { data, error } = await supabase
        .schema('zmanage')
        .from('storage_locations')
        .insert({
            client_id: clientId,
            project_id: projectId,
            name: body.name.trim(),
            description: body.description?.trim() || null,
            is_active: true
        })
        .select()
        .single();

    if (error) return reply.code(500).send({ error: error.message });

    logAuditEvent(request, 'VAULT_CREATED', 'VAULT', {
        vault_id: data.id,
        name: data.name
    });

    return reply.code(201).send({ success: true, vault: data });
}

export async function updateVault(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; description?: string; is_active?: boolean };

    const updatePayload: any = { updated_at: new Date().toISOString() };
    if (body.name !== undefined) updatePayload.name = body.name.trim();
    if (body.description !== undefined) updatePayload.description = body.description.trim();
    if (body.is_active !== undefined) updatePayload.is_active = body.is_active;

    const { data, error } = await supabase
        .schema('zmanage')
        .from('storage_locations')
        .update(updatePayload)
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Vault not found' });

    logAuditEvent(request, 'VAULT_UPDATED', 'VAULT', {
        vault_id: data.id,
        name: data.name
    });

    return reply.send({ success: true, vault: data });
}

export async function deleteVault(request: FastifyRequest, reply: FastifyReply) {
    const { projectId } = request.tenantContext!;
    const { id } = request.params as { id: string };

    const { data, error } = await supabase
        .schema('zmanage')
        .from('storage_locations')
        .update({ deleted_flag: true, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('project_id', projectId)
        .select()
        .single();

    if (error) return reply.code(500).send({ error: error.message });
    if (!data) return reply.code(404).send({ error: 'Vault not found' });

    // Gracefully detach from assets, kits, consumables
    await supabase.schema('zmanage').from('assets').update({ location_id: null }).eq('location_id', id);
    await supabase.schema('zmanage').from('asset_kits').update({ location_id: null }).eq('location_id', id);
    await supabase.schema('zmanage').from('consumables').update({ location_id: null }).eq('location_id', id);

    logAuditEvent(request, 'VAULT_DELETED', 'VAULT', {
        vault_id: id,
        name: data.name
    });

    return reply.send({ success: true, message: 'Vault deleted successfully' });
}
