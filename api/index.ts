import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';

let app: FastifyInstance | null = null;

export default async (req: any, res: any) => {
    if (!app) {
        app = await buildApp();
        await app.ready();
    }

    await new Promise<void>((resolve) => {
        res.on('finish', resolve);
        res.on('close', resolve);
        res.on('error', resolve);
        app!.server.emit('request', req, res);
    });
};
