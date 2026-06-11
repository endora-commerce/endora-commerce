import type { FastifyInstance, FastifyRequest } from 'fastify';
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
    const salesChannelCode = readHeader(request, 'x-sales-channel');
    const data = await deps.productCardButtonsResolver.resolve(salesChannelCode);
    return { data };
  });
}

function readHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}
