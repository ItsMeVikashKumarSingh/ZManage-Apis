import { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';
import { TenantContext } from '../interfaces';

declare module 'fastify' {
    interface FastifyRequest {
        tenantContext?: TenantContext;
    }
}

export async function clientAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
    const url = request.url;

    // Public / Skip Routes
    if (
        url.startsWith('/documentation') ||
        url.startsWith('/api/v1/health') ||
        url.startsWith('/api/v1/auth') ||
        url === '/'
    ) {
        return;
    }

    const tenantIdHeader = request.headers['x-tenant-id'] as string;
    const pubKeyHeader = request.headers['x-publishable-key'] as string;
    const authHeader = request.headers['authorization'];

    // 1. Direct Server Secret Key (Bearer sk_live_...)
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        if (token.startsWith('sk_live_')) {
            const { data: project, error } = await supabase
                .schema('management')
                .from('tbl_client_projects')
                .select('tcp_id, tcp_client_id')
                .eq('tcp_secret_key', token)
                .single();

            if (error || !project) {
                return reply.code(401).send({ error: 'Invalid or revoked Secret Key' });
            }

            request.tenantContext = {
                clientId: project.tcp_client_id,
                projectId: project.tcp_id,
                channel: 'CUSTOM_API'
            };
            return;
        }
    }

    // 2. Publishable Key (pk_live_...) for Mobile / Web
    if (pubKeyHeader && pubKeyHeader.startsWith('pk_live_')) {
        const { data: project, error } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_client_id')
            .eq('tcp_publishable_key', pubKeyHeader)
            .single();

        if (error || !project) {
            return reply.code(401).send({ error: 'Invalid or revoked Publishable Key' });
        }

        request.tenantContext = {
            clientId: project.tcp_client_id,
            projectId: project.tcp_id,
            channel: 'CUSTOM_MOBILE'
        };
        return;
    }

    // 3. Managed Portals (X-Tenant-ID Header)
    if (tenantIdHeader) {
        // Look up by project id or client id
        const { data: project, error } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_client_id')
            .or(`tcp_id.eq.${tenantIdHeader},tcp_client_id.eq.${tenantIdHeader}`)
            .limit(1)
            .single();

        if (error || !project) {
            return reply.code(401).send({ error: 'Tenant project could not be resolved' });
        }

        request.tenantContext = {
            clientId: project.tcp_client_id,
            projectId: project.tcp_id,
            channel: 'MANAGED'
        };
        return;
    }

    return reply.code(401).send({
        error: 'Missing required tenant credentials. Provide X-Tenant-ID, X-Publishable-Key, or Bearer <sk_live_...>'
    });
}
