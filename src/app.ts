import fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env } from './config/env';
import { swaggerOptions, swaggerUiOptions } from './config/swagger';
import { clientAuthMiddleware } from './middleware/clientAuth';

// Route Imports
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import assetRoutes from './routes/assets';
import workerRoutes from './routes/workers';
import allocationRoutes from './routes/allocations';
import payoutRoutes from './routes/payouts';
import analyticsRoutes from './routes/analytics';
import { auditLogsRoutes } from './routes/auditLogs';
import vaultRoutes from './routes/vaults';
import consumableRoutes from './routes/consumables';
import kitRoutes from './routes/kits';
import aiRoutes from './routes/ai';

export async function buildApp() {
    const app = fastify({
        logger: false,
        trustProxy: true,
        bodyLimit: 15 * 1024 * 1024 // 15MB for PDF and multimodal document uploads
    });

    // Core Security Plugins
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cors, {
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Tenant-ID',
            'X-Publishable-Key',
            'x-tenant-id',
            'x-publishable-key',
            'Accept'
        ]
    });

    // Swagger Documentation
    await app.register(swagger, swaggerOptions);
    await app.register(swaggerUi, swaggerUiOptions);

    // Global Pre-Handler Hook for Multi-Tenant Auth
    app.addHook('preHandler', async (request, reply) => {
        await clientAuthMiddleware(request, reply);
    });

    // Root Welcome
    app.get('/', async () => {
        return {
            service: 'Zorvik ZManage-APIs',
            version: '0.1.0',
            status: 'online',
            documentation: '/documentation',
            health: '/api/v1/health'
        };
    });

    // Register API Modules
    await app.register(healthRoutes, { prefix: '/api/v1' });
    await app.register(authRoutes, { prefix: '/api/v1/auth' });
    await app.register(assetRoutes, { prefix: '/api/v1/assets' });
    await app.register(workerRoutes, { prefix: '/api/v1/workers' });
    await app.register(allocationRoutes, { prefix: '/api/v1/allocations' });
    await app.register(payoutRoutes, { prefix: '/api/v1/payouts' });
    await app.register(analyticsRoutes, { prefix: '/api/v1/analytics' });
    await app.register(auditLogsRoutes, { prefix: '/api/v1/audit-logs' });
    await app.register(vaultRoutes, { prefix: '/api/v1/vaults' });
    await app.register(consumableRoutes, { prefix: '/api/v1/consumables' });
    await app.register(kitRoutes, { prefix: '/api/v1/kits' });
    await app.register(aiRoutes, { prefix: '/api/v1/ai' });

    return app;
}

// Start Server if directly invoked
if (process.env.NODE_ENV !== 'test') {
    buildApp()
        .then((app) => {
            app.listen({ port: env.PORT, host: '0.0.0.0' }, (err, address) => {
                if (err) {
                    // eslint-disable-next-line no-console
                    console.error('Failed to start ZManage-APIs:', err);
                    process.exit(1);
                }
                // eslint-disable-next-line no-console
                console.log(`🚀 ZManage-APIs running at ${address}`);
                // eslint-disable-next-line no-console
                console.log(`📖 Documentation available at ${address}/documentation`);
            });
        })
        .catch((err) => {
            // eslint-disable-next-line no-console
            console.error('Bootstrap error:', err);
            process.exit(1);
        });
}
