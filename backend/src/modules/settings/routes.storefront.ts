import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '../sales_channels/middleware/sales-channel-resolver.js';
import type { ShopInfoResolver } from './services/shop-info-resolver.js';

/**
 * Public storefront read for the shop / company contact information.
 *
 *   GET /api/v1/storefront/shop-info
 *
 * Resolves the `shop.*` settings for the request's sales channel (from the
 * `x-sales-channel` header, falling back to the system-default channel). Every
 * field is always present as a string; unset values come back empty.
 */
export async function registerSettingsStorefrontRoutes(
  app: FastifyInstance,
  deps: { shopInfoResolver: ShopInfoResolver },
): Promise<void> {
  app.get('/api/v1/storefront/shop-info', async (request) => {
    const salesChannelCode = getResolvedChannel(request).code;
    const data = await deps.shopInfoResolver.resolve(salesChannelCode);
    return { data };
  });
}
