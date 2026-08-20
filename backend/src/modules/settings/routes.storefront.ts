import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
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
    // The id, not the code: the channel is already resolved, and handing the
    // resolver a code made it re-resolve one (feature 075 / D-87).
    const salesChannelId = getResolvedChannel(request).id;
    const data = await deps.shopInfoResolver.resolve(salesChannelId);
    return { data };
  });
}
