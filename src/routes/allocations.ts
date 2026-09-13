import { FastifyInstance } from 'fastify';
import {
    listAllocations,
    createAllocation,
    deleteAllocation,
    getBookingCandidates,
    batchSyncBookings,
    createOfflineBooking
} from '../controllers/allocationsController';

export default async function allocationRoutes(app: FastifyInstance) {
    app.get('/', listAllocations);
    app.post('/', createAllocation);
    app.get('/sync-candidates', getBookingCandidates);
    app.post('/batch-sync', batchSyncBookings);
    app.post('/offline-booking', createOfflineBooking);
    app.delete('/:id', deleteAllocation);
}

