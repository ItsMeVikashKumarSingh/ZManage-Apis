import { FastifyInstance } from 'fastify';
import {
    listAllocations,
    createAllocation,
    deleteAllocation
} from '../controllers/allocationsController';

export default async function allocationRoutes(app: FastifyInstance) {
    app.get('/', listAllocations);
    app.post('/', createAllocation);
    app.delete('/:id', deleteAllocation);
}
