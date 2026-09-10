import { FastifyInstance } from 'fastify';
import {
    listWorkers,
    createWorker,
    updateWorker,
    checkWorkerAvailability,
    getImportCandidates,
    batchImportWorkers
} from '../controllers/workersController';

export default async function workerRoutes(app: FastifyInstance) {
    app.get('/', listWorkers);
    app.post('/', createWorker);
    app.patch('/:id', updateWorker);
    app.post('/check-availability', checkWorkerAvailability);

    // 1-Tap Team Onboarding Routes
    app.get('/import/candidates', getImportCandidates);
    app.post('/import/batch', batchImportWorkers);
}
