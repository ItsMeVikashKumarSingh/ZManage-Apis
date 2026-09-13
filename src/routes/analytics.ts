import { FastifyInstance } from 'fastify';
import { getProjectAnalytics } from '../controllers/analyticsController';

export default async function analyticsRoutes(app: FastifyInstance) {
    app.get('/overview', getProjectAnalytics);
}
