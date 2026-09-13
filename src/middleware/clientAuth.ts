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
                .select('tcp_id, tcp_client_id, tcp_is_active, tcp_rms_enabled, tcp_deleted_flag')
                .eq('tcp_secret_key', token)
                .eq('tcp_deleted_flag', false)
                .single();

            if (error || !project || project.tcp_is_active === false) {
                return reply.code(401).send({ error: 'Invalid, inactive, or revoked Secret Key' });
            }

            if (project.tcp_rms_enabled === false) {
                return reply.code(403).send({
                    error: 'RMS_DISABLED',
                    message: 'Resource Management System is not enabled for this project.'
                });
            }

            request.tenantContext = {
                clientId: project.tcp_client_id,
                projectId: project.tcp_id,
                channel: 'CUSTOM_API'
            };
            return;
        }

        // 2. Supabase User JWT Session Token
        try {
            const { data: userData, error: userError } = await supabase.auth.getUser(token);

            if (!userError && userData?.user) {
                const userId = userData.user.id;
                const userEmail = (userData.user.email || '').toLowerCase().trim();

                // Cross-validate tenant ownership in management schema
                let targetClientId: string | null = null;
                let targetProjectId: string | null = null;

                // Priority: if X-Tenant-ID header was supplied, verify the user has access to it
                if (tenantIdHeader) {
                    const { data: targetProject } = await supabase
                        .schema('management')
                        .from('tbl_client_projects')
                        .select('tcp_id, tcp_client_id, tcp_is_active, tcp_rms_enabled, tcp_deleted_flag')
                        .or(`tcp_id.eq.${tenantIdHeader},tcp_client_id.eq.${tenantIdHeader}`)
                        .eq('tcp_deleted_flag', false)
                        .limit(1)
                        .maybeSingle();

                    if (targetProject && targetProject.tcp_is_active !== false) {
                        if (targetProject.tcp_rms_enabled === false) {
                            return reply.code(403).send({
                                error: 'RMS_DISABLED',
                                message: 'Resource Management System is not enabled for this project.'
                            });
                        }
                        targetClientId = targetProject.tcp_client_id;
                        targetProjectId = targetProject.tcp_id;
                    }
                }

                // If not resolved from header, resolve from client profile
                if (!targetProjectId) {
                    const { data: client } = await supabase
                        .schema('management')
                        .from('tbl_clients')
                        .select('tc_id, tc_status_flag, tc_deleted_flag')
                        .or(`tc_auth_user_id.eq.${userId},tc_contact_email.ilike.${userEmail}`)
                        .eq('tc_deleted_flag', false)
                        .maybeSingle();

                    if (client && client.tc_status_flag !== false) {
                        targetClientId = client.tc_id;

                        const { data: proj } = await supabase
                            .schema('management')
                            .from('tbl_client_projects')
                            .select('tcp_id, tcp_rms_enabled')
                            .eq('tcp_client_id', targetClientId)
                            .eq('tcp_deleted_flag', false)
                            .filter('tcp_rms_enabled', 'neq', false)
                            .order('tcp_is_primary', { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (proj) {
                            targetProjectId = proj.tcp_id;
                        }
                    }
                }

                // If verified client project was found, attach context
                if (targetClientId && targetProjectId) {
                    request.tenantContext = {
                        clientId: targetClientId,
                        projectId: targetProjectId,
                        channel: 'MANAGED',
                        userId
                    };
                    return;
                }
            }
        } catch {
            // Token verification error
        }
    }

    // 3. Publishable Key (pk_live_...) for Mobile / Web
    if (pubKeyHeader && pubKeyHeader.startsWith('pk_live_')) {
        const { data: project, error } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_client_id, tcp_is_active, tcp_rms_enabled, tcp_deleted_flag')
            .eq('tcp_publishable_key', pubKeyHeader)
            .eq('tcp_deleted_flag', false)
            .single();

        if (error || !project || project.tcp_is_active === false) {
            return reply.code(401).send({ error: 'Invalid or revoked Publishable Key' });
        }

        if (project.tcp_rms_enabled === false) {
            return reply.code(403).send({
                error: 'RMS_DISABLED',
                message: 'Resource Management System is not enabled for this project.'
            });
        }

        request.tenantContext = {
            clientId: project.tcp_client_id,
            projectId: project.tcp_id,
            channel: 'CUSTOM_MOBILE'
        };
        return;
    }

    // 4. Managed Portals with X-Tenant-ID Header
    if (tenantIdHeader) {
        const { data: project, error } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_client_id, tcp_is_active, tcp_rms_enabled, tcp_deleted_flag')
            .or(`tcp_id.eq.${tenantIdHeader},tcp_client_id.eq.${tenantIdHeader}`)
            .eq('tcp_deleted_flag', false)
            .limit(1)
            .maybeSingle();

        if (error || !project || project.tcp_is_active === false) {
            return reply.code(401).send({ error: 'Tenant project could not be resolved or is inactive' });
        }

        if (project.tcp_rms_enabled === false) {
            return reply.code(403).send({
                error: 'RMS_DISABLED',
                message: 'Resource Management System is not enabled for this project.'
            });
        }

        request.tenantContext = {
            clientId: project.tcp_client_id,
            projectId: project.tcp_id,
            channel: 'MANAGED'
        };
        return;
    }

    return reply.code(401).send({
        error: 'Security authorization failure: Missing or invalid credentials (Bearer token, X-Tenant-ID, or API key required).'
    });
}
