import { FastifyInstance } from 'fastify';
import {
    listAssets,
    createAsset,
    updateAsset,
    checkAssetAvailability,
    checkoutAsset,
    checkinAsset,
    deleteAsset,
    getAssetHistory,
    addAssetNote
} from '../controllers/assetsController';

export default async function assetRoutes(app: FastifyInstance) {
    app.get('/', listAssets);
    app.post('/', createAsset);
    app.get('/:id/history', getAssetHistory);
    app.post('/:id/notes', addAssetNote);
    app.patch('/:id', updateAsset);
    app.put('/:id', updateAsset);
    app.delete('/:id', deleteAsset);
    app.post('/check-availability', checkAssetAvailability);
    app.post('/:id/checkout', checkoutAsset);
    app.post('/:id/checkin', checkinAsset);
}
