import type {
  CatalogProductReadPort,
  ListingPriceDetailPort,
  OrganizationDetailsPort,
  ProductSummary,
  SearchSuggestItem,
} from '@endora-commerce/contracts';
import { rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import type { SuggestionPricingEnricher } from '../routes.public.js';

/**
 * Builds the {@link SuggestionPricingEnricher} the suggest route uses to
 * attach the per-customer price-list resolution to each typeahead hit.
 *
 * The search module stays isolated from the price-lists module's concrete
 * service: it depends only on the published `ListingPriceDetailPort` slice,
 * which the container's `pricingService` satisfies with the price-lists
 * `PricingService`. (Constitution I — modules talk through ports.)
 *
 * D-287 P0 — the hits are priced in **one** batched call. This used to be one
 * `resolveEngine` per hit in parallel — about seven statements each on a cache
 * miss, the popup's whole limit at once (`specs/pricing/read-paths-and-performance.md`
 * §4). The batch is the catalogue listing's own resolution, so a suggestion
 * and the card it leads to quote one figure: the base price is the base
 * partition's, else the Product's own price exactly as the card's, and the
 * customer's own group applies. A resolver *refusal* degrades the popup to the
 * plain summaries — the popup never fails over a pricing hiccup — but the
 * module-presence answer is not a hiccup and is re-thrown (issue #84): a
 * suggest popup with every price missing reads to a buyer as a catalogue
 * without prices, not as `price_lists` being switched off.
 */

/** The slice of `pricingService` the popup resolves. */
export type SuggestionPriceResolverPort = ListingPriceDetailPort;

export function createSuggestionPricingEnricher(deps: {
  /**
   * Feature 075, Phase C — the two rows a priced suggestion needs, each read
   * from the module that owns it instead of out of its table. `em.find(Product,
   * …)` and `em.findOne(Organization, …)` from inside this module went on
   * answering after an operator had switched either owner off, because
   * deactivation drops no tables; the ports fail closed instead.
   */
  catalogProducts: CatalogProductReadPort;
  organizations: OrganizationDetailsPort;
  pricingService: SuggestionPriceResolverPort;
}): SuggestionPricingEnricher {
  const { catalogProducts, organizations, pricingService } = deps;

  return async (items: ProductSummary[], ctx): Promise<SearchSuggestItem[]> => {
    if (items.length === 0) return [];

    // Feature 053 / FR-002: the channel is resolved once upstream and handed in.
    const channel = ctx.resolvedChannel;

    const organization = ctx.organizationId
      ? await organizations.findById(ctx.organizationId)
      : null;

    const products = await catalogProducts.findByIds(items.map((i) => i.id));
    if (products.length === 0) return items.map((item) => ({ ...item }));

    let details: Awaited<ReturnType<SuggestionPriceResolverPort['resolveListingPriceDetails']>>;
    try {
      details = await pricingService.resolveListingPriceDetails({
        products,
        context: {
          organization: organization ? { id: organization.id, customerGroupId: organization.customerGroupId } : null,
          ...(organization && ctx.customerAccountId ? { customerAccountId: ctx.customerAccountId } : {}),
          salesChannel: channel,
          // Feature 160 — the request's currency, as the result cards are priced.
          ...(ctx.currencyCode ? { currencyCode: ctx.currencyCode } : {}),
        },
      });
    } catch (error) {
      rethrowIfModuleDisabled(error);
      return items.map((item) => ({ ...item }));
    }

    return items.map((item): SearchSuggestItem => {
      const detail = details.get(item.id);
      if (!detail) return { ...item };
      return {
        ...item,
        basePrice: detail.basePrice,
        salePrice: detail.salePrice,
        priceDisplayMode: detail.displayMode,
        // Feature 161 (G19) — the list price beside a lower buyer price, as on the result cards.
        ...(detail.listPrice ? { listPrice: { amount: detail.listPrice.amount, currency: detail.listPrice.currency } } : {}),
      };
    });
  };
}
