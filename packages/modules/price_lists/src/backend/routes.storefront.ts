import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { PriceListService } from './services/price-list-service.js';
import type { PricingServiceContract } from './services/pricing-service.interface.js';
import {
  requestScopeLanguage,
  type CatalogProductAvailabilityPort,
  type CatalogProductReadPort,
  type CatalogProductRecord,
  type OrganizationDetailsPort,
  type OrganizationRecord,
  type ProductAudience,
} from '@endora-commerce/contracts';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { markPersonalisedPricing, pricedAudienceOf } from '@endora-commerce/platform/http';

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
  /**
   * Feature 163 — `catalog`'s availability answer at the request's (channel,
   * language) for this viewer (`contracts/consumers.md` row 21). A price or a
   * display mode is a disclosure about the product, so it is answered only for
   * a product the caller could reach in the catalogue: not a draft, not one
   * outside its window, not one another channel sells.
   */
  catalogAvailability: CatalogProductAvailabilityPort;
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
  /**
   * `specs/182-related-payers/` RP-14 — whose display mode applies: the viewer's own
   * Organization, also when `organization` (the priced one) is a payer on its terms.
   */
  readonly displayOrganizationId: string | null;
}

async function pricingViewerOf(
  request: FastifyRequest,
  organizationDetails: OrganizationDetailsPort,
): Promise<PricingViewer> {
  // `specs/182-related-payers/` FR-115 — priced for the payer on its terms (research R-4).
  const audience = await pricedAudienceOf(request);
  // `null` covers three callers whose answers happen to agree: the anonymous
  // visitor, the authenticated caller with no Organization (feature 026's
  // guest-style account, an unbound API key), and the buyer whose Organization
  // row is gone.
  const organization =
    audience.organizationId === null
      ? null
      : await organizationDetails.findById(audience.pricingOrganizationId ?? audience.organizationId);
  return {
    audience,
    organization,
    customerKind: organization ? 'signed_in' : 'guest',
    displayOrganizationId: organization ? audience.organizationId : null,
  };
}

/**
 * The product a probe answers about, or `null` for every product this viewer
 * may not have — absent, or not available at the request's (channel, language)
 * to this audience now (feature 163, FR-004). One `null` for every reason, so
 * the route's single 404 is the only answer a refusal has.
 */
async function availableProduct(
  request: FastifyRequest,
  productId: string,
  audience: ProductAudience,
  catalogProductRead: CatalogProductReadPort,
  catalogAvailability: CatalogProductAvailabilityPort,
): Promise<CatalogProductRecord | null> {
  const product = await catalogProductRead.findById(productId);
  if (!product) return null;
  // Feature 053 / FR-002: the channel the canonical middleware resolved.
  const channel = getResolvedChannel(request);
  const available = await catalogAvailability.filterAvailable([product.id], {
    channelId: channel.id,
    // Issue #1011 — the channel language the whole `Accept-Language` asks for: q-weighted,
    // matched exactly then by base language, else the channel's default (as #397's catalogue).
    languageCode: requestScopeLanguage(channel, request.headers['accept-language']),
    audience,
  });
  return available.has(product.id) ? product : null;
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
  const { priceListService, pricingService, catalogProductRead, organizationDetails, catalogAvailability } =
    deps;

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

      // Issue #227 — this route took a bare product id and answered about it.
      // Whether a price is even displayed for a product an operator restricted
      // to one distributor is that operator's answer, so the product has to be
      // available to this viewer before this route says anything about it at
      // all — since feature 163, at the request's (channel, language), now.
      const product = await availableProduct(
        request,
        request.params.productId,
        viewer.audience,
        catalogProductRead,
        catalogAvailability,
      );
      if (!product) {
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
        organizationId: viewer.displayOrganizationId,
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

      // Issue #227 / feature 163 — see the display-mode route above. A resolved
      // price is the most direct disclosure this module has.
      const product = await availableProduct(
        request,
        request.params.id,
        viewer.audience,
        catalogProductRead,
        catalogAvailability,
      );
      if (!product) {
        reply.status(404);
        return { error: { code: 'NOT_FOUND', message: 'Product not found.' } };
      }

      const channel = getResolvedChannel(request);

      const quantity = Math.max(1, Number(request.query.quantity ?? '1') || 1);
      const currency = request.query.currency?.toUpperCase();
      const variantId = request.query.variantId ?? null;

      // D-287 P0 — the customer's own group (feature 040 R6) overrides the
      // organisation's here exactly as on the catalogue listing: the engine
      // resolves it from the account, which belongs to `viewer.organization`.
      const out = await pricingService.resolveEngine({
        product,
        variantId,
        context: {
          quantity,
          organization: viewer.organization,
          ...(viewer.audience.pricingOrganizationId && viewer.displayOrganizationId
            ? { displayModeOrganization: { id: viewer.displayOrganizationId } }
            : viewer.organization && viewer.audience.customerAccountId
            ? { customerAccountId: viewer.audience.customerAccountId }
            : {}),
          salesChannel: channel,
          ...(currency ? { currencyCode: currency } : {}),
        },
      });

      return {
        data: {
          // `resolvedPriceEngineSchema`: a product no book prices (FR-018) is
          // unpriced — no book, no price, no bracket — not an empty-string id.
          resolvedPrice: {
            baseListId: out.base.bracket ? out.base.listId : null,
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
            // Feature 160 (FR-031) — the tier that priced the charged line for
            // the selected variant, and the buyer price a charged sale undercut.
            ...(out.source !== undefined ? { source: out.source } : {}),
            ...(out.compareAt !== undefined ? { compareAt: out.compareAt } : {}),
            // G9 — the catalogue price beside a lower buyer price, when the shop shows it.
            ...(out.listPrice ? { listPrice: out.listPrice } : {}),
          },
        },
      };
    },
  );
}
