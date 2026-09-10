import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../config/supabase';

export default async function authRoutes(app: FastifyInstance) {
    /**
     * @route POST /api/v1/auth/login
     * @desc Client login with plain email and password (identical to Zorvik Tech client login)
     */
    app.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
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

        // If client/project exists, return enriched session
        return reply.send({
            success: true,
            token: authData.session?.access_token || `zres_auth_${userId}`,
            tenantId: projectId || clientId || '4321ffd8-648e-40e5-b1f0-d64956dfb62c',
            clientName,
            user: {
                id: userId,
                email: lowerEmail,
                name: clientName
            }
        });
    });
}
