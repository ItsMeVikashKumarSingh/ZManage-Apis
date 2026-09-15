import { SwaggerOptions } from '@fastify/swagger';
import { FastifySwaggerUiOptions } from '@fastify/swagger-ui';

export const swaggerOptions: SwaggerOptions = {
    openapi: {
        info: {
            title: 'Zorvik ZManage-APIs',
            description: 'Multi-Tenant Internal Resource, Asset Inventory, Team Scheduling & Worker Payouts API (ZManage)',
            version: '0.4.0'
        },
        servers: [
            {
                url: 'http://localhost:4003',
                description: 'Local Development Server'
            }
        ],
        components: {
            securitySchemes: {
                tenantId: {
                    type: 'apiKey',
                    name: 'x-tenant-id',
                    in: 'header',
                    description: 'Tenant Project UUID for Managed Portals'
                },
                publishableKey: {
                    type: 'apiKey',
                    name: 'x-publishable-key',
                    in: 'header',
                    description: 'Project Publishable Key (pk_live_...) for Mobile/Web'
                },
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Server Secret Key (sk_live_...) for Headless Backend APIs'
                }
            }
        },
        security: [{ tenantId: [] }, { publishableKey: [] }, { bearerAuth: [] }]
    }
};

export const swaggerUiOptions: FastifySwaggerUiOptions = {
    routePrefix: '/documentation',
    uiConfig: {
        docExpansion: 'list',
        deepLinking: true
    },
    staticCSP: true,
    transformStaticCSP: (header) => header
};
