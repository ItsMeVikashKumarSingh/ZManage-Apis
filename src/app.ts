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

export async function buildApp() {
    const app = fastify({
        logger: false,
        trustProxy: true
    });

    // Core Security Plugins
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cors, {
        origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
        credentials: true
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
