import { FastifyInstance } from 'fastify';
import {
    listPayouts,
    createPayout,
    settlePayout,
    getPayoutsSummary
} from '../controllers/payoutsController';

export default async function payoutRoutes(app: FastifyInstance) {
    app.get('/', listPayouts);
    app.post('/', createPayout);
    app.get('/summary', getPayoutsSummary);
    app.post('/:id/settle', settlePayout);
}
