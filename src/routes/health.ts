import { FastifyInstance } from 'fastify';

export default async function healthRoutes(app: FastifyInstance) {
    app.get('/health', async () => {
        return {
            service: 'ZResource-APIs',
            status: 'healthy',
            timestamp: new Date().toISOString()
        };
    });
}
