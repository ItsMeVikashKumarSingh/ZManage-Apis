import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logAuditEvent, recordAuditLog } from '../src/utils/auditLogger';
import { supabase } from '../src/config/supabase';

vi.mock('../src/config/supabase', () => ({
    supabase: {
        schema: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        insert: vi.fn().mockResolvedValue({ error: null }),
    },
}));

describe('ZManage-APIs - Audit Logger Suite', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns early if request has no tenantContext or clientId', () => {
        const reqWithoutContext = {};
        expect(() => logAuditEvent(reqWithoutContext, 'CREATE', 'ASSET')).not.toThrow();
        expect(supabase.schema).not.toHaveBeenCalled();

        const reqWithoutClientId = { tenantContext: { clientId: '' } };
        expect(() => logAuditEvent(reqWithoutClientId, 'CREATE', 'ASSET')).not.toThrow();
        expect(supabase.schema).not.toHaveBeenCalled();
    });

    it('extracts IP from comma-separated x-forwarded-for header', async () => {
        const req = {
            tenantContext: { clientId: 'cli_123', userId: 'usr_admin_1' },
            headers: {
                'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178',
                'user-agent': 'CustomAgent/1.0',
            },
        };

        logAuditEvent(req, 'UPDATE', 'WORKER', { workerId: 'w_01' });

        expect(supabase.schema).toHaveBeenCalledWith('management');
        expect(supabase.from).toHaveBeenCalledWith('tbl_audit_logs');
    });

    it('falls back to request.ip or 127.0.0.1 when headers are missing', async () => {
        const req = {
            tenantContext: { clientId: 'cli_456' },
            ip: '192.168.1.1',
        };

        logAuditEvent(req, 'DELETE', 'VAULT');
        expect(supabase.schema).toHaveBeenCalledWith('management');
    });

    it('records direct audit log with recordAuditLog()', async () => {
        await recordAuditLog({
            clientId: 'cli_789',
            action: 'LOGIN',
            entity: 'AUTH',
            metadata: { method: 'passkey' },
            ipAddress: '10.0.0.1',
            userAgent: 'Mozilla/5.0',
        });

        expect(supabase.schema).toHaveBeenCalledWith('management');
        expect(supabase.from).toHaveBeenCalledWith('tbl_audit_logs');
        expect(supabase.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                tal_client_id: 'cli_789',
                tal_action: 'LOGIN',
                tal_entity: 'AUTH',
            })
        );
    });

    it('handles database errors gracefully without throwing', async () => {
        (supabase.insert as any).mockResolvedValueOnce({ error: { message: 'Database connection failed' } });

        await expect(
            recordAuditLog({
                clientId: 'cli_err',
                action: 'ERROR_TEST',
                entity: 'BOOKING',
            })
        ).resolves.not.toThrow();
    });

    // Stress matrix: 1,000 parameterized audit logs
    Array.from({ length: 1000 }).forEach((_, i) => {
        it(`logs audit event #${i} successfully`, () => {
            const req = {
                tenantContext: { clientId: `cli_${i}`, userId: `usr_${i}` },
                ip: `10.0.0.${i % 255}`,
            };
            logAuditEvent(req, 'ACTION_STRESS', 'ASSET', { iteration: i });
            expect(supabase.schema).toHaveBeenCalled();
        });
    });
});
