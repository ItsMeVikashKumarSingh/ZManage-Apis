import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

interface ListAuditLogsQuery {
    entity?: string;
    action?: string;
    search?: string;
    limit?: string;
    offset?: string;
}

export async function listAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    const { clientId } = request.tenantContext!;
    const { entity, action, search, limit = '50', offset = '0' } = request.query as ListAuditLogsQuery;

    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
    const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0);

    try {
        // 1. Fetch total counts and metrics for the client
        const { data: allMetricsData, error: metricsError } = await supabase
            .schema('management')
            .from('tbl_audit_logs')
            .select('tal_entity, tal_action')
            .eq('tal_client_id', clientId);

        if (metricsError) {
            // eslint-disable-next-line no-console
            console.error('[AuditLogs] Error fetching metrics:', metricsError.message);
        }

        const allLogs = allMetricsData || [];
        const metrics = {
            totalEvents: allLogs.length,
            gearOperations: allLogs.filter(l => l.tal_entity === 'ASSET').length,
            timelineDispatches: allLogs.filter(l => l.tal_entity === 'ALLOCATION' || l.tal_entity === 'BOOKING').length,
            payoutSettlements: allLogs.filter(l => l.tal_entity === 'PAYOUT').length,
            crewOperations: allLogs.filter(l => l.tal_entity === 'WORKER').length
        };

        // 2. Fetch filtered paginated logs
        let query = supabase
            .schema('management')
            .from('tbl_audit_logs')
            .select('*', { count: 'exact' })
            .eq('tal_client_id', clientId)
            .order('tal_created_at', { ascending: false })
            .range(parsedOffset, parsedOffset + parsedLimit - 1);

        if (entity && entity !== 'all') {
            query = query.eq('tal_entity', entity.toUpperCase());
        }

        if (action && action !== 'all') {
            query = query.eq('tal_action', action.toUpperCase());
        }

        if (search && search.trim()) {
            const term = search.trim();
            // Search action, entity, user-agent, or cast metadata to text
            query = query.or(`tal_action.ilike.%${term}%,tal_entity.ilike.%${term}%,tal_ip_address.ilike.%${term}%`);
        }

        const { data, count, error } = await query;

        if (error) {
            return reply.code(500).send({
                success: false,
                error: error.message
            });
        }

        const formattedLogs = (data || []).map(row => ({
            id: row.tal_id,
            admin_id: row.tal_admin_id,
            client_id: row.tal_client_id,
            action: row.tal_action,
            entity: row.tal_entity,
            metadata: row.tal_metadata || {},
            ip_address: row.tal_ip_address,
            user_agent: row.tal_user_agent,
            created_at: row.tal_created_at
        }));

        return reply.send({
            success: true,
            total: count || 0,
            limit: parsedLimit,
            offset: parsedOffset,
            metrics,
            logs: formattedLogs
        });
    } catch (err: any) {
        return reply.code(500).send({
            success: false,
            error: err.message || 'Failed to list audit logs'
        });
    }
}
