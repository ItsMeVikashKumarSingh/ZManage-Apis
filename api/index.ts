import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance | null = null;

export default async (req: any, res: any) => {
    if (!app) {
        app = await buildApp();
        await app.ready();
    }
    app.server.emit('request', req, res);
};
