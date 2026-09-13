import { FastifyInstance } from 'fastify';
import { listAuditLogs } from '../controllers/auditLogsController';

export async function auditLogsRoutes(app: FastifyInstance) {
    app.get('/', listAuditLogs);
}
