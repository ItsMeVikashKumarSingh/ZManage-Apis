import { FastifyInstance } from 'fastify';
import {
    listPayouts,
    settlePayout,
    getPayoutsSummary
} from '../controllers/payoutsController';

export default async function payoutRoutes(app: FastifyInstance) {
    app.get('/', listPayouts);
    app.get('/summary', getPayoutsSummary);
    app.post('/:id/settle', settlePayout);
}
