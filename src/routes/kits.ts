import { FastifyInstance } from 'fastify';
import {
    listKits,
    createKit,
    updateKit,
    deleteKit
} from '../controllers/kitsController';

export default async function kitRoutes(app: FastifyInstance) {
    app.get('/', listKits);
    app.post('/', createKit);
    app.patch('/:id', updateKit);
    app.put('/:id', updateKit);
    app.delete('/:id', deleteKit);
}
