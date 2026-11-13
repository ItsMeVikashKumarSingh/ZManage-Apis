import { describe, it, expect, vi, beforeEach } from 'vitest';
import { clientAuthMiddleware } from '../src/middleware/clientAuth';
import { supabase } from '../src/config/supabase';

vi.mock('../src/config/supabase', () => {
    return {
        supabase: {
            auth: {
                getUser: vi.fn(),
            },
            schema: vi.fn().mockReturnThis(),
            from: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            filter: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            single: vi.fn(),
            maybeSingle: vi.fn(),
        },
    };
});

function createMockReply() {
    const reply: any = {
        statusCode: 200,
        sentData: null,
        code: vi.fn().mockImplementation((c: number) => {
            reply.statusCode = c;
            return reply;
        }),
        send: vi.fn().mockImplementation((data: any) => {
            reply.sentData = data;
            return reply;
        }),
    };
    return reply;
}

describe('ZManage-APIs - Tenant Isolation & BOLA Protection Suite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Public Routes Bypass', () => {
        it('allows access to documentation and health endpoints without credentials', async () => {
            const reply = createMockReply();
            const reqHealth: any = { url: '/api/v1/health', headers: {} };
            await clientAuthMiddleware(reqHealth, reply);
            expect(reply.code).not.toHaveBeenCalled();

            const reqDocs: any = { url: '/documentation/static/index.html', headers: {} };
            await clientAuthMiddleware(reqDocs, reply);
            expect(reply.code).not.toHaveBeenCalled();

            const reqRoot: any = { url: '/', headers: {} };
            await clientAuthMiddleware(reqRoot, reply);
            expect(reply.code).not.toHaveBeenCalled();
        });
    });

    describe('Unauthenticated Rejection', () => {
        it('rejects protected route requests with 401 when no headers provided', async () => {
            const req: any = { url: '/api/v1/assets', headers: {} };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).toHaveBeenCalledWith(401);
            expect(reply.sentData.error).toContain('Security authorization failure');
        });
    });

    describe('Server Secret Key (sk_live_...) Handling', () => {
        it('authenticates valid sk_live key and populates tenantContext', async () => {
            (supabase.single as any).mockResolvedValueOnce({
                data: {
                    tcp_id: 'proj_001',
                    tcp_client_id: 'client_alpha',
                    tcp_is_active: true,
                    tcp_rms_enabled: true,
                    tcp_deleted_flag: false,
                },
                error: null,
            });

            const req: any = {
                url: '/api/v1/assets',
                headers: { authorization: 'Bearer sk_live_secret_key_123' },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).not.toHaveBeenCalled();
            expect(req.tenantContext).toEqual({
                clientId: 'client_alpha',
                projectId: 'proj_001',
                channel: 'CUSTOM_API',
            });
        });

        it('rejects sk_live key when project has RMS disabled (403)', async () => {
            (supabase.single as any).mockResolvedValueOnce({
                data: {
                    tcp_id: 'proj_002',
                    tcp_client_id: 'client_alpha',
                    tcp_is_active: true,
                    tcp_rms_enabled: false,
                    tcp_deleted_flag: false,
                },
                error: null,
            });

            const req: any = {
                url: '/api/v1/assets',
                headers: { authorization: 'Bearer sk_live_secret_key_123' },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).toHaveBeenCalledWith(403);
            expect(reply.sentData.error).toBe('RMS_DISABLED');
        });
    });

    describe('Supabase JWT Authentication & BOLA Defense', () => {
        it('PREVENTS IDOR/BOLA: blocks Client A user targeting Client B project via X-Tenant-ID header', async () => {
            // Mock valid user JWT
            (supabase.auth.getUser as any).mockResolvedValueOnce({
                data: {
                    user: { id: 'usr_client_a', email: 'owner@clienta.com' },
                },
                error: null,
            });

            // Mock user's client resolution (User belongs to Client A)
            (supabase.maybeSingle as any)
                .mockResolvedValueOnce({
                    // tbl_clients lookup
                    data: { tc_id: 'client_A', tc_status_flag: true, tc_deleted_flag: false },
                    error: null,
                })
                .mockResolvedValueOnce({
                    // tbl_client_projects lookup for targeted project (Target belongs to Client B!)
                    data: {
                        tcp_id: 'proj_target_b',
                        tcp_client_id: 'client_B',
                        tcp_is_active: true,
                        tcp_rms_enabled: true,
                        tcp_deleted_flag: false,
                    },
                    error: null,
                });

            const req: any = {
                url: '/api/v1/assets',
                headers: {
                    authorization: 'Bearer valid_jwt_token_user_a',
                    'x-tenant-id': 'proj_target_b',
                },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            // Must be strictly forbidden!
            expect(reply.code).toHaveBeenCalledWith(403);
            expect(reply.sentData).toEqual({
                error: 'FORBIDDEN',
                message: 'Access denied. You do not have permissions for this tenant project.',
            });
            expect(req.tenantContext).toBeUndefined();
        });

        it('allows Client A user to access their own project via X-Tenant-ID header', async () => {
            (supabase.auth.getUser as any).mockResolvedValueOnce({
                data: {
                    user: { id: 'usr_client_a', email: 'owner@clienta.com' },
                },
                error: null,
            });

            // User belongs to Client A and targets Client A's project
            (supabase.maybeSingle as any)
                .mockResolvedValueOnce({
                    data: { tc_id: 'client_A', tc_status_flag: true, tc_deleted_flag: false },
                    error: null,
                })
                .mockResolvedValueOnce({
                    data: {
                        tcp_id: 'proj_client_a',
                        tcp_client_id: 'client_A',
                        tcp_is_active: true,
                        tcp_rms_enabled: true,
                        tcp_deleted_flag: false,
                    },
                    error: null,
                });

            const req: any = {
                url: '/api/v1/assets',
                headers: {
                    authorization: 'Bearer valid_jwt_token_user_a',
                    'x-tenant-id': 'proj_client_a',
                },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).not.toHaveBeenCalled();
            expect(req.tenantContext).toEqual({
                clientId: 'client_A',
                projectId: 'proj_client_a',
                channel: 'MANAGED',
                userId: 'usr_client_a',
            });
        });

        it('allows global super_admin to access any tenant project via X-Tenant-ID header', async () => {
            (supabase.auth.getUser as any).mockResolvedValueOnce({
                data: {
                    user: { id: 'usr_superadmin', email: 'admin@zorviktech.com' },
                },
                error: null,
            });

            // Not a normal client in tbl_clients
            (supabase.maybeSingle as any)
                .mockResolvedValueOnce({
                    data: null, // no client profile
                    error: null,
                })
                .mockResolvedValueOnce({
                    // tbl_users admin check
                    data: { tu_id: 'tu_admin_1', tu_role: 'super_admin' },
                    error: null,
                })
                .mockResolvedValueOnce({
                    // Target project lookup (Client X)
                    data: {
                        tcp_id: 'proj_client_x',
                        tcp_client_id: 'client_X',
                        tcp_is_active: true,
                        tcp_rms_enabled: true,
                        tcp_deleted_flag: false,
                    },
                    error: null,
                });

            const req: any = {
                url: '/api/v1/assets',
                headers: {
                    authorization: 'Bearer valid_admin_jwt',
                    'x-tenant-id': 'proj_client_x',
                },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).not.toHaveBeenCalled();
            expect(req.tenantContext).toEqual({
                clientId: 'client_X',
                projectId: 'proj_client_x',
                channel: 'MANAGED',
                userId: 'usr_superadmin',
            });
        });

        it('falls back to client primary project when X-Tenant-ID is omitted', async () => {
            (supabase.auth.getUser as any).mockResolvedValueOnce({
                data: {
                    user: { id: 'usr_client_a', email: 'owner@clienta.com' },
                },
                error: null,
            });

            (supabase.maybeSingle as any)
                .mockResolvedValueOnce({
                    data: { tc_id: 'client_A', tc_status_flag: true, tc_deleted_flag: false },
                    error: null,
                })
                .mockResolvedValueOnce({
                    // Primary project lookup
                    data: { tcp_id: 'proj_primary_a', tcp_rms_enabled: true },
                    error: null,
                });

            const req: any = {
                url: '/api/v1/assets',
                headers: { authorization: 'Bearer valid_jwt_token_user_a' },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).not.toHaveBeenCalled();
            expect(req.tenantContext).toEqual({
                clientId: 'client_A',
                projectId: 'proj_primary_a',
                channel: 'MANAGED',
                userId: 'usr_client_a',
            });
        });
    });

    describe('Publishable Key (pk_live_...) Handling', () => {
        it('authenticates valid pk_live key for client mobile/web', async () => {
            (supabase.single as any).mockResolvedValueOnce({
                data: {
                    tcp_id: 'proj_pub_01',
                    tcp_client_id: 'client_beta',
                    tcp_is_active: true,
                    tcp_rms_enabled: true,
                    tcp_deleted_flag: false,
                },
                error: null,
            });

            const req: any = {
                url: '/api/v1/assets',
                headers: { 'x-publishable-key': 'pk_live_some_valid_key' },
            };
            const reply = createMockReply();

            await clientAuthMiddleware(req, reply);

            expect(reply.code).not.toHaveBeenCalled();
            expect(req.tenantContext).toEqual({
                clientId: 'client_beta',
                projectId: 'proj_pub_01',
                channel: 'CUSTOM_MOBILE',
            });
        });
    });
});
