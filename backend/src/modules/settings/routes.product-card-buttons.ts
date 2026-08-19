import type { FastifyInstance } from 'fastify';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import type { ProductCardButtonsResolver } from './services/product-card-buttons-resolver.js';

/**
 * Public storefront read for the product-card button visibility toggles.
 *
 *   GET /api/v1/storefront/settings/product-card-buttons
 *
 * Returns `{ showAddToCart, showAddToShoppingList, showAddToQuote }` for the
 * request's sales channel (from `x-sales-channel`, falling back to the
 * system-default channel). Each flag defaults to true on any read error.
 */
export async function registerSettingsProductCardButtonsRoutes(
  app: FastifyInstance,
  deps: { productCardButtonsResolver: ProductCardButtonsResolver },
): Promise<void> {
  app.get('/api/v1/storefront/settings/product-card-buttons', async (request, reply) => {
    reply.header('cache-control', 'public, max-age=60');
    // The id, not the code: the channel is already resolved, and handing the
    // resolver a code made it re-resolve one (feature 075 / D-87).
    const salesChannelId = getResolvedChannel(request).id;
    const data = await deps.productCardButtonsResolver.resolve(salesChannelId);
    return { data };
  });
}
