import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import { isProductVisibleTo, type CatalogProductReadPort } from '@b2b/contracts';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import { productAudienceOf } from '../../http/product-audience.js';

export interface StorefrontPricingRoutesDeps {
  priceListService: PriceListService;
  pricingService: PricingServiceContract;
  emFactory: () => EntityManager;
  /**
   * Feature 075 Phase C — the product these two routes price, over `catalog`'s
   * read port instead of its `Product` entity. It fails closed when `catalog`
   * is off, which is the answer a storefront price probe should get: quoting a
   * price for a product the platform will not serve is worse than refusing.
   */
  catalogProductRead: CatalogProductReadPort;
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
  const { priceListService, pricingService, catalogProductRead } = deps;

  app.get<{ Params: { productId: string } }>(
    '/api/v1/storefront/pricing/display-mode/:productId',
    async (request, reply) => {
      const product = await catalogProductRead.findById(request.params.productId);
      // Issue #227 — both routes below are anonymous by design, and both took
      // a bare product id and answered about it. Whether a price is even
      // displayed for a product an operator restricted to one distributor is
      // that operator's answer, so the row has to pass the audience test before
      // this route says anything about it at all.
      if (!product || !isProductVisibleTo(product, productAudienceOf(request))) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      // Feature 053 / FR-002: read the channel resolved once by the canonical
      // middleware (`getResolvedChannel()`) — no header re-parse, no re-query.
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
      const product = await catalogProductRead.findById(request.params.id);
      // Issue #227 — see the display-mode route above. A resolved price is the
      // most direct disclosure this module has.
      if (!product || !isProductVisibleTo(product, productAudienceOf(request))) {
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
