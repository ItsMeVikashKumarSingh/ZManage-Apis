import { FastifyInstance } from 'fastify';
import {
    listAssets,
    createAsset,
    updateAsset,
    checkAssetAvailability,
    checkoutAsset,
    checkinAsset
} from '../controllers/assetsController';

export default async function assetRoutes(app: FastifyInstance) {
    app.get('/', listAssets);
    app.post('/', createAsset);
    app.patch('/:id', updateAsset);
    app.post('/check-availability', checkAssetAvailability);
    app.post('/:id/checkout', checkoutAsset);
    app.post('/:id/checkin', checkinAsset);
}
