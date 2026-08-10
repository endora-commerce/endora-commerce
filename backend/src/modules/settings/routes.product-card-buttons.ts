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
    const salesChannelCode = getResolvedChannel(request).code;
    const data = await deps.productCardButtonsResolver.resolve(salesChannelCode);
    return { data };
  });
}
