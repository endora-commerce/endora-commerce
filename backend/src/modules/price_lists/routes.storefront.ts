import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingService } from './services/pricing-service.js';
import { Product } from '../catalog/entities/product.entity.js';
import { getResolvedChannel } from '../sales_channels/middleware/sales-channel-resolver.js';

export interface StorefrontPricingRoutesDeps {
  priceListService: PriceListService;
  pricingService: PricingService;
  emFactory: () => EntityManager;
}

/**
 * Storefront-public pricing endpoints (T025/T026 / contracts/pricing-resolution).
 *
 *   GET /api/v1/storefront/products/:id/resolved-price
 *   GET /api/v1/storefront/pricing/display-mode/:productId
 *
 * Mounted from `plugin.ts` under the platform's existing
 * `/api/v1/storefront/` prefix. Auth is intentionally absent — these
 * routes are public and read-only; the resolver derives the
 * organization from a future `Authorization` header upstream.
 */
export async function registerStorefrontPricingRoutes(
  app: FastifyInstance,
  deps: StorefrontPricingRoutesDeps,
): Promise<void> {
  const { priceListService, pricingService, emFactory } = deps;

  app.get<{ Params: { productId: string } }>(
    '/api/v1/storefront/pricing/display-mode/:productId',
    async (request, reply) => {
      const em = emFactory();
      const product = await em.findOne(Product, { id: request.params.productId });
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      // Feature 053 / FR-002: read the channel resolved once by the canonical
      // middleware (`request.salesChannel`) — no header re-parse, no re-query.
      const channel = getResolvedChannel(request);
      const mode = await priceListService.resolveDisplayMode({
        productId: product.id,
        organizationId: null,
        salesChannelId: channel.id,
        customerKind: 'guest',
      });
      return { data: { displayMode: mode } };
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { quantity?: string; currency?: string; variantId?: string };
  }>(
    '/api/v1/storefront/products/:id/resolved-price',
    async (request, reply) => {
      const em = emFactory();
      const product = await em.findOne(Product, { id: request.params.id });
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }

      const channel = getResolvedChannel(request);

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase();
      const variantId = request.query.variantId ?? null;

      // Customer organization is derived from the request session when wired —
      // for now keep this anonymous to ship the route; quote-request and cart
      // paths inject the organization explicitly via the service layer.
      const out = await pricingService.resolveEngine({
        product,
        variantId,
        context: {
          quantity,
          organization: null,
          salesChannel: channel,
          ...(currency ? { currencyCode: currency } : {}),
        },
      });

      return {
        data: {
          resolvedPrice: {
            baseListId: out.base.listId,
            basePrice: out.base.bracket
              ? { amount: out.base.bracket.amount, currency: out.currencyCode }
              : null,
            saleListId: out.sale?.listId ?? null,
            salePrice: out.sale
              ? { amount: out.sale.bracket.amount, currency: out.currencyCode }
              : null,
            displayMode: out.displayMode,
            currencyCode: out.currencyCode,
            quantityBracket: out.base.bracket
              ? {
                  minQuantity: out.base.bracket.minQuantity,
                  maxQuantity: out.base.bracket.maxQuantity ?? null,
                }
              : null,
          },
        },
      };
    },
  );
}
