import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import {
  isProductVisibleTo,
  type CatalogProductReadPort,
  type OrganizationDetailsPort,
  type OrganizationRecord,
  type ProductAudience,
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
 * Who is asking, for both routes below — resolved once, in one place
 * (issue #271).
 *
 * The two endpoints answer two halves of one question ("what does this buyer
 * pay, and in which convention?"), and until this existed they derived their
 * viewer differently: the resolved price took the request's actor, the
 * display mode took nobody. So a signed-in buyer read gross on the product page
 * and net in the cart wherever the two `pricing.*` settings keys differed, which
 * is a pricing error to the buyer and to support even though every figure was
 * right.
 *
 * `customerKind` is the engine's own rule, written down once rather than twice:
 * `PricingService.resolveEngine` derives it from the organisation it was
 * **handed**, not from the id on the session, so a buyer whose Organization row
 * is gone is a guest to the price chain. An endpoint that read the session id
 * alone would call that same viewer signed-in and disagree with the price
 * beside it — the same defect one layer down.
 */
interface PricingViewer {
  readonly audience: ProductAudience;
  readonly organization: OrganizationRecord | null;
  readonly customerKind: 'guest' | 'signed_in';
}

async function pricingViewerOf(
  request: FastifyRequest,
  organizationDetails: OrganizationDetailsPort,
): Promise<PricingViewer> {
  const audience = productAudienceOf(request);
  // `null` covers three callers whose answers happen to agree: the anonymous
  // visitor, the authenticated caller with no Organization (feature 026's
  // guest-style account, an unbound API key), and the buyer whose Organization
  // row is gone.
  const organization =
    audience.organizationId === null
      ? null
      : await organizationDetails.findById(audience.organizationId);
  return { audience, organization, customerKind: organization ? 'signed_in' : 'guest' };
}

/**
 * Storefront pricing endpoints (T025/T026 / contracts/pricing-resolution).
 *
 *   GET /api/v1/storefront/products/:id/resolved-price
 *   GET /api/v1/storefront/pricing/display-mode/:productId
 *
 * Mounted from `plugin.ts` under the platform's existing
 * `/api/v1/storefront/` prefix. Both routes are reachable without a credential
 * and both **read** one when it is there, through the single
 * {@link pricingViewerOf} above.
 *
 * The header above used to say auth was "intentionally absent", and the handler
 * below passed `organization: null` to the engine behind a comment promising
 * the organisation would be derived "when wired" (issue #265). It never was —
 * so the one endpoint on the platform whose name promises a per-customer answer
 * quoted every caller the channel price, from feature 011 until now. The
 * ruling MR !796 settled for the catalogue applies here unchanged: an anonymous
 * visitor sees the channel price, a signed-in buyer sees their own — and since
 * issue #271 the display mode beside it is resolved for the same viewer, so the
 * two cannot answer "net or gross for this buyer?" differently.
 */
export async function registerStorefrontPricingRoutes(
  app: FastifyInstance,
  deps: StorefrontPricingRoutesDeps,
): Promise<void> {
  const { priceListService, pricingService, catalogProductRead, organizationDetails } = deps;

  app.get<{ Params: { productId: string } }>(
    '/api/v1/storefront/pricing/display-mode/:productId',
    async (request, reply) => {
      const viewer = await pricingViewerOf(request, organizationDetails);
      // Before the read, as the resolved price below does: this answer is
      // derived for the caller once the caller names an Organization, so it must
      // not enter a cache another caller can read. The anonymous answer stays
      // unstamped and is still the representation the storefront's shared
      // window and a crawler hold (Principle VII).
      markPersonalisedPricing(reply, viewer.audience);

      const product = await catalogProductRead.findById(request.params.productId);
      // Issue #227 — this route took a bare product id and answered about it.
      // Whether a price is even displayed for a product an operator restricted
      // to one distributor is that operator's answer, so the row has to pass the
      // audience test before this route says anything about it at all.
      if (!product || !isProductVisibleTo(product, viewer.audience)) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }
      // Feature 053 / FR-002: read the channel resolved once by the canonical
      // middleware (`getResolvedChannel()`) — no header re-parse, no re-query.
      const channel = getResolvedChannel(request);
      // Issue #271 — the viewer's, matching the price. This route used to pass
      // `organizationId: null, customerKind: 'guest'` unconditionally, so the
      // cart that reads it got the `unauthenticated_display_mode` key while the
      // product page's resolved price carried the signed-in one: the same buyer,
      // the same product, two conventions. The chain the resolver walks is
      // unchanged — Product → Category → Organization → Settings, the
      // organisation's say being the `price_display_mode_overrides` row it
      // already consults — and only the viewer handed to it moved.
      const mode = await priceListService.resolveDisplayMode({
        productId: product.id,
        organizationId: viewer.organization?.id ?? null,
        salesChannelId: channel.id,
        customerKind: viewer.customerKind,
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
      const viewer = await pricingViewerOf(request, organizationDetails);
      // Before the read, as `catalog`'s public routes do: this response's price
      // is resolved for the caller, and so is the 404 below, so a response that
      // named an organisation must not enter a shared cache whatever it turned
      // out to be. Anonymous responses are left unstamped and unchanged — still
      // the representation a crawler indexes.
      markPersonalisedPricing(reply, viewer.audience);

      const product = await catalogProductRead.findById(request.params.id);
      // Issue #227 — see the display-mode route above. A resolved price is the
      // most direct disclosure this module has.
      if (!product || !isProductVisibleTo(product, viewer.audience)) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }

      const channel = getResolvedChannel(request);

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase();
      const variantId = request.query.variantId ?? null;

      // The engine reads `customerGroupId` off the record `pricingViewerOf`
      // loaded, so the organisation's group travels with it; a customer's *own*
      // group override (feature 040 R6) is not resolved here, exactly as it is
      // not on the catalogue listing this page's cards come from.
      const out = await pricingService.resolveEngine({
        product,
        variantId,
        context: {
          quantity,
          organization: viewer.organization,
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
