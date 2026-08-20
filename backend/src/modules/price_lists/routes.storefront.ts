import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import {
  isProductVisibleTo,
  type CatalogProductReadPort,
  type OrganizationDetailsPort,
} from '@b2b/contracts';
import { getResolvedChannel } from '../../kernel/sales-channels/sales-channel-resolver.middleware.js';
import { markPersonalisedPricing, productAudienceOf } from '../../http/product-audience.js';

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
  /**
   * The buying organisation behind a signed-in request (issue #265). The same
   * port the admin resolved-price probe in `routes.ts` reads, for the same
   * reason: a price is resolved against an Organization, and the request only
   * carries its id.
   */
  organizationDetails: OrganizationDetailsPort;
}

/**
 * Storefront pricing endpoints (T025/T026 / contracts/pricing-resolution).
 *
 *   GET /api/v1/storefront/products/:id/resolved-price
 *   GET /api/v1/storefront/pricing/display-mode/:productId
 *
 * Mounted from `plugin.ts` under the platform's existing
 * `/api/v1/storefront/` prefix. Both routes are reachable without a
 * credential; the resolved price **reads** one when it is there.
 *
 * The header above used to say auth was "intentionally absent", and the handler
 * below passed `organization: null` to the engine behind a comment promising
 * the organisation would be derived "when wired" (issue #265). It never was —
 * so the one endpoint on the platform whose name promises a per-customer answer
 * quoted every caller the channel price, from feature 011 until now. The
 * ruling MR !796 settled for the catalogue applies here unchanged: an anonymous
 * visitor sees the channel price, a signed-in buyer sees their own.
 */
export async function registerStorefrontPricingRoutes(
  app: FastifyInstance,
  deps: StorefrontPricingRoutesDeps,
): Promise<void> {
  const { priceListService, pricingService, catalogProductRead, organizationDetails } = deps;

  app.get<{ Params: { productId: string } }>(
    '/api/v1/storefront/pricing/display-mode/:productId',
    async (request, reply) => {
      const product = await catalogProductRead.findById(request.params.productId);
      // Issue #227 — this route took a bare product id and answered about it.
      // Whether a price is even displayed for a product an operator restricted
      // to one distributor is that operator's answer, so the row has to pass the
      // audience test before this route says anything about it at all.
      if (!product || !isProductVisibleTo(product, productAudienceOf(request))) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      // Feature 053 / FR-002: read the channel resolved once by the canonical
      // middleware (`getResolvedChannel()`) — no header re-parse, no re-query.
      const channel = getResolvedChannel(request);
      // Left anonymous, deliberately, and it is not the same question as the
      // route below (issue #265). A display mode is net-versus-gross
      // *presentation*: resolving it for the viewer would pick the
      // `authenticated` settings key instead of the `unauthenticated` one and
      // admit the organisation-scope override, which changes how a signed-in
      // buyer's **cart totals** read — the one caller of this endpoint. That is
      // a product decision about presentation, not the pricing ruling this
      // change carries out, so it stays as it was and is named here rather than
      // moved quietly. The consequence to know: the `displayMode` inside a
      // resolved price *is* the viewer's now, because the engine derives
      // `customerKind` from the organisation it was handed, so a signed-in
      // buyer's product page and their cart can disagree about net/gross where
      // the two settings keys differ.
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
      const audience = productAudienceOf(request);
      // Before the read, as `catalog`'s public routes do: this response's price
      // is resolved for the caller, and so is the 404 below, so a response that
      // named an organisation must not enter a shared cache whatever it turned
      // out to be. Anonymous responses are left unstamped and unchanged — still
      // the representation a crawler indexes.
      markPersonalisedPricing(reply, audience);

      const product = await catalogProductRead.findById(request.params.id);
      // Issue #227 — see the display-mode route above. A resolved price is the
      // most direct disclosure this module has.
      if (!product || !isProductVisibleTo(product, audience)) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }

      const channel = getResolvedChannel(request);

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase();
      const variantId = request.query.variantId ?? null;

      // The viewer's Organization, or `null` — and `null` covers three callers
      // that all get the channel price for reasons that happen to agree: the
      // anonymous visitor, the authenticated caller with no Organization
      // (feature 026's guest-style account, an unbound API key), and the buyer
      // whose Organization row is gone. The engine reads `customerGroupId` off
      // the record, so the organisation's group travels with it; a customer's
      // *own* group override (feature 040 R6) is not resolved here, exactly as
      // it is not on the catalogue listing this page's cards come from.
      const organization =
        audience.organizationId === null
          ? null
          : await organizationDetails.findById(audience.organizationId);

      const out = await pricingService.resolveEngine({
        product,
        variantId,
        context: {
          quantity,
          organization,
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
