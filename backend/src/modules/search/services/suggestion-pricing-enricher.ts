import type { EntityManager } from '@mikro-orm/postgresql';
import type { DisplayMode, ProductSummary, SearchSuggestItem } from '@b2b/contracts';
import { Product } from '../../catalog/entities/product.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import type { SuggestionPricingEnricher } from '../routes.public.js';

/**
 * Builds the {@link SuggestionPricingEnricher} the suggest route uses to
 * attach the per-customer price-list resolution to each typeahead hit.
 *
 * The search module stays isolated from the price-lists module's concrete
 * service: it depends only on the narrow {@link SuggestionPriceResolverPort}
 * structural port below, which the composition root satisfies with the
 * price-lists `PricingService`. (Constitution I — modules talk through ports.)
 *
 * Pricing is resolved per hit in parallel, capped by the suggest `limit`
 * (default 8), and the resolver caches per-tuple for 60s, so the popup adds
 * at most one bounded fan-out. Any resolver error degrades that hit to the
 * plain summary — the popup never fails over a pricing hiccup.
 */

export interface SuggestionPriceResolverPort {
  resolveEngine(input: {
    product: Product;
    variantId?: string | null;
    context: {
      quantity: number;
      organization?: Organization | null;
      salesChannel: { id: string; defaultCurrency: string };
      currencyCode?: string;
    };
  }): Promise<{
    base: { bracket: { amount: string } | null };
    sale: { bracket: { amount: string } } | null;
    displayMode: DisplayMode;
    currencyCode: string;
  }>;
}

export function createSuggestionPricingEnricher(deps: {
  emFactory: () => EntityManager;
  pricingService: SuggestionPriceResolverPort;
}): SuggestionPricingEnricher {
  const { emFactory, pricingService } = deps;

  return async (items: ProductSummary[], ctx): Promise<SearchSuggestItem[]> => {
    if (items.length === 0) return [];
    const em = emFactory();

    // Feature 053 / FR-002: the channel is resolved once upstream and handed in.
    const channel = ctx.resolvedChannel;

    const organization = ctx.organizationId
      ? await em.findOne(Organization, { id: ctx.organizationId })
      : null;

    const products = await em.find(Product, {
      id: { $in: items.map((i) => i.id) },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return Promise.all(
      items.map(async (item): Promise<SearchSuggestItem> => {
        const product = byId.get(item.id);
        if (!product) return { ...item };
        try {
          const out = await pricingService.resolveEngine({
            product,
            context: { quantity: 1, organization, salesChannel: channel },
          });
          return {
            ...item,
            basePrice: out.base.bracket
              ? { amount: out.base.bracket.amount, currency: out.currencyCode }
              : null,
            salePrice: out.sale
              ? { amount: out.sale.bracket.amount, currency: out.currencyCode }
              : null,
            priceDisplayMode: out.displayMode,
          };
        } catch {
          return { ...item };
        }
      }),
    );
  };
}
