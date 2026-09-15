import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

export default async function authRoutes(app: FastifyInstance) {
    /**
     * @route POST /api/v1/auth/login
     * @desc Client login with plain email and password (identical to Zorvik Tech client login)
     */
    app.post(
        '/login',
        {
            config: {
                rateLimit: {
                    max: 10,
                    timeWindow: '1 minute'
                }
            }
        },
        async (request: FastifyRequest, reply: FastifyReply) => {
        const { email, password } = request.body as { email?: string; password?: string };

        if (!email || !password) {
            return reply.code(400).send({ error: 'Email and password are required' });
        }

        const lowerEmail = email.toLowerCase().trim();

        // 1. Authenticate with Supabase Auth
        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
            email: lowerEmail,
            password: password
        });

        if (authError || !authData.user) {
            return reply.code(401).send({ error: 'Invalid email or password' });
        }

        const userId = authData.user.id;

        // 2. Resolve Client and Project from management schema
        // Look up either in tbl_clients (owner) or tbl_client_projects
        let clientId: string | null = null;
        let projectId: string | null = null;
        let clientName: string = 'Client Studio';

        // Check if user is direct client owner
        const { data: client } = await supabase
            .schema('management')
            .from('tbl_clients')
            .select('tc_id, tc_client_name')
            .eq('tc_contact_email', lowerEmail)
            .eq('tc_deleted_flag', false)
            .maybeSingle();

        if (client) {
            clientId = client.tc_id;
            clientName = client.tc_client_name || 'Client Studio';

            // Find primary project
            const { data: project } = await supabase
                .schema('management')
                .from('tbl_client_projects')
                .select('tcp_id')
                .eq('tcp_client_id', clientId)
                .eq('tcp_deleted_flag', false)
                .order('tcp_is_primary', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (project) {
                projectId = project.tcp_id;
            }
        } else {
            // Fallback: Check studio.tbl_profiles
            const { data: profile } = await supabase
                .schema('studio')
                .from('tbl_profiles')
                .select('id, client_id, full_name, role')
                .eq('id', userId)
                .eq('is_deleted', false)
                .maybeSingle();

            if (profile) {
                clientId = profile.client_id;
                clientName = profile.full_name || 'Studio Staff';

                const { data: project } = await supabase
                    .schema('management')
                    .from('tbl_client_projects')
                    .select('tcp_id')
                    .eq('tcp_client_id', clientId)
                    .eq('tcp_deleted_flag', false)
                    .limit(1)
                    .maybeSingle();

                if (project) {
                    projectId = project.tcp_id;
                }
            }
        }

        // Fetch all RMS-enabled or active projects for this client
        let clientProjects: Array<{ id: string; name: string; category?: string; websiteType?: string }> = [];
        if (clientId) {
            const { data: projs } = await supabase
                .schema('management')
                .from('tbl_client_projects')
                .select('tcp_id, tcp_name, tcp_project_category, tcp_website_type, tcp_rms_enabled')
                .eq('tcp_client_id', clientId)
                .eq('tcp_deleted_flag', false)
                .order('tcp_is_primary', { ascending: false });

            clientProjects = (projs || [])
                .filter(p => p.tcp_rms_enabled !== false)
                .map(p => ({
                    id: p.tcp_id,
                    name: p.tcp_name,
                    category: p.tcp_project_category,
                    websiteType: p.tcp_website_type
                }));
        }

        // Only assign primary project if it has RMS enabled
        if (!projectId && clientProjects.length > 0) {
            projectId = clientProjects[0].id;
        }

        // If client/project exists, return enriched session
        return reply.send({
            success: true,
            token: authData.session?.access_token || `zm_auth_${userId}`,
            tenantId: projectId || clientId || '',
            clientName,
            rmsEnabled: clientProjects.length > 0,
            projects: clientProjects,
            user: {
                id: userId,
                email: lowerEmail,
                name: clientName
            }
        });
    });

    /**
     * @route GET /api/v1/auth/projects
     * @desc Returns all projects owned by the currently authenticated tenant
     */
    app.get('/projects', async (request: FastifyRequest, reply: FastifyReply) => {
        const authHeader = request.headers['authorization'];
        const tenantIdHeader = request.headers['x-tenant-id'] as string;
        const query = request.query as { tenantId?: string; projectId?: string };
        const fallbackId = tenantIdHeader || query.projectId || query.tenantId;

        let clientId: string | null = null;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.replace('Bearer ', '').trim();
            const { data: userData } = await supabase.auth.getUser(token);

            if (userData?.user) {
                const email = (userData.user.email || '').toLowerCase().trim();
                const userId = userData.user.id;

                const { data: client } = await supabase
                    .schema('management')
                    .from('tbl_clients')
                    .select('tc_id, tc_client_name')
                    .or(`tc_auth_user_id.eq.${userId},tc_contact_email.ilike.${email}`)
                    .eq('tc_deleted_flag', false)
                    .maybeSingle();

                if (client?.tc_id) {
                    clientId = client.tc_id;
                }
            }
        }

        // If not found via Bearer token, fallback to tenantId / projectId
        if (!clientId && fallbackId) {
            const { data: proj } = await supabase
                .schema('management')
                .from('tbl_client_projects')
                .select('tcp_client_id')
                .or(`tcp_id.eq.${fallbackId},tcp_client_id.eq.${fallbackId}`)
                .eq('tcp_deleted_flag', false)
                .limit(1)
                .maybeSingle();

            if (proj?.tcp_client_id) {
                clientId = proj.tcp_client_id;
            }
        }

        if (!clientId) {
            return reply.send({ success: true, count: 0, projects: [] });
        }

        const { data: projs, error: projErr } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_name, tcp_project_category, tcp_website_type, tcp_rms_enabled, tcp_is_primary')
            .eq('tcp_client_id', clientId)
            .eq('tcp_deleted_flag', false)
            .order('tcp_is_primary', { ascending: false });

        if (projErr) return reply.code(500).send({ error: projErr.message });

        const projects = (projs || [])
            .filter(p => p.tcp_rms_enabled !== false)
            .map(p => ({
                id: p.tcp_id,
                name: p.tcp_name,
                category: p.tcp_project_category,
                websiteType: p.tcp_website_type,
                isPrimary: Boolean(p.tcp_is_primary)
            }));

        return reply.send({ success: true, count: projects.length, projects });
    });

    /**
     * @route GET /api/v1/auth/verify-access
     * @desc Checks if a given project or tenant has RMS enabled
     */
    app.get('/verify-access', async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { projectId?: string; tenantId?: string };
        const tenantIdHeader = request.headers['x-tenant-id'] as string;
        const targetId = query.projectId || query.tenantId || tenantIdHeader;

        if (!targetId) {
            return reply.code(400).send({
                success: false,
                hasAccess: false,
                rmsEnabled: false,
                error: 'Project or Tenant ID required for access verification'
            });
        }

        const { data: project, error } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_client_id, tcp_name, tcp_rms_enabled, tcp_is_active, tcp_deleted_flag')
            .or(`tcp_id.eq.${targetId},tcp_client_id.eq.${targetId}`)
            .eq('tcp_deleted_flag', false)
            .limit(1)
            .maybeSingle();

        if (error || !project || project.tcp_is_active === false) {
            return reply.send({
                success: true,
                hasAccess: false,
                rmsEnabled: false,
                error: 'Project not found or inactive',
                details: error ? error.message : (!project ? 'No record matching targetId' : 'Project inactive')
            });
        }

        const isRmsEnabled = project.tcp_rms_enabled !== false;

        // Also fetch all available RMS projects for this client so client can switch if needed
        const { data: projs } = await supabase
            .schema('management')
            .from('tbl_client_projects')
            .select('tcp_id, tcp_name, tcp_project_category, tcp_website_type, tcp_rms_enabled, tcp_is_primary')
            .eq('tcp_client_id', project.tcp_client_id)
            .eq('tcp_deleted_flag', false)
            .order('tcp_is_primary', { ascending: false });

        const availableProjects = (projs || [])
            .filter(p => p.tcp_rms_enabled !== false)
            .map(p => ({
                id: p.tcp_id,
                name: p.tcp_name,
                category: p.tcp_project_category,
                websiteType: p.tcp_website_type,
                isPrimary: Boolean(p.tcp_is_primary)
            }));

        return reply.send({
            success: true,
            hasAccess: isRmsEnabled,
            rmsEnabled: isRmsEnabled,
            projectId: project.tcp_id,
            projectName: project.tcp_name,
            availableProjects
        });
    });
}
