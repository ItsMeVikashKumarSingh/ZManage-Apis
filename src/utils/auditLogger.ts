import { supabase } from '../config/supabase';

export interface AuditLogParams {
    clientId: string;
    adminId?: string | null;
    action: string;
    entity: 'ASSET' | 'WORKER' | 'ALLOCATION' | 'PAYOUT' | 'BOOKING' | 'AUTH' | 'VAULT' | 'CONSUMABLE' | 'KIT';
    metadata?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
}

/**
 * Asynchronously records an immutable audit log record to management.tbl_audit_logs.
 * Designed per Rule 3.1: Non-blocking, isolated, and fault-tolerant.
 */
export async function recordAuditLog(params: AuditLogParams): Promise<void> {
    try {
        const adminId = params.adminId || params.clientId;
        const { error } = await supabase
            .schema('management')
            .from('tbl_audit_logs')
            .insert({
                tal_client_id: params.clientId,
                tal_admin_id: adminId,
                tal_action: params.action,
                tal_entity: params.entity,
                tal_metadata: params.metadata || {},
                tal_ip_address: params.ipAddress || null,
                tal_user_agent: params.userAgent || null
            });

        if (error) {
            // eslint-disable-next-line no-console
            console.error('[AuditLogger] Warning: failed to record audit log:', error.message);
        }
    } catch (err: any) {
        // eslint-disable-next-line no-console
        console.error('[AuditLogger] Unexpected error writing audit log:', err?.message || err);
    }
}

/**
 * Convenience helper to log an audit event directly from a Fastify request.
 */
export function logAuditEvent(
    request: { tenantContext?: { clientId: string; userId?: string }; ip?: string; headers?: Record<string, any> },
    action: string,
    entity: 'ASSET' | 'WORKER' | 'ALLOCATION' | 'PAYOUT' | 'BOOKING' | 'AUTH' | 'VAULT' | 'CONSUMABLE' | 'KIT',
    metadata?: Record<string, any>
): void {
    if (!request.tenantContext?.clientId) return;

    const rawIp = (request.headers?.['x-forwarded-for'] as string) || request.ip || '127.0.0.1';
    // Take the first IP if forwarded-for contains comma-separated chain
    const ipAddress = rawIp.split(',')[0].trim();
    const userAgent = (request.headers?.['user-agent'] as string) || 'ZManage-App';

    // Non-blocking asynchronous execution
    recordAuditLog({
        clientId: request.tenantContext.clientId,
        adminId: request.tenantContext.userId || request.tenantContext.clientId,
        action,
        entity,
        metadata,
        ipAddress,
        userAgent
    }).catch(err => {
        // eslint-disable-next-line no-console
        console.error('[AuditLogger] Async dispatch error:', err?.message || err);
    });
}
