import { FastifyInstance } from 'fastify';
import {
    listConsumables,
    createConsumable,
    updateConsumable,
    adjustStock,
    deleteConsumable
} from '../controllers/consumablesController';

export default async function consumableRoutes(app: FastifyInstance) {
    app.get('/', listConsumables);
    app.post('/', createConsumable);
    app.patch('/:id', updateConsumable);
    app.put('/:id', updateConsumable);
    app.post('/:id/adjust-stock', adjustStock);
    app.delete('/:id', deleteConsumable);
}
