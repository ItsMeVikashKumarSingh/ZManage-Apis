import { FastifyInstance } from 'fastify';
import {
    listVaults,
    createVault,
    updateVault,
    deleteVault
} from '../controllers/vaultsController';

export default async function vaultRoutes(app: FastifyInstance) {
    app.get('/', listVaults);
    app.post('/', createVault);
    app.patch('/:id', updateVault);
    app.put('/:id', updateVault);
    app.delete('/:id', deleteVault);
}
