import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogBulkPriceLine,
  OrgLinePricePort,
  OrganizationDetailsPort,
  OrganizationRecord,
  ProductAvailability,
  ProductDetail,
  ProductPriceTier,
  ProductSummary,
} from '@b2b/contracts';
import { Product } from '../entities/product.entity.js';


/**
 * Feature 062 (research §R7) — pricing/availability decoration for the
 * external catalog namespace (`/api/v1/external/catalog/*`).
 *
 * Thin decoration ONLY: query logic stays in `CatalogQueryService`, price
 * resolution stays in `PricingService` (the exact resolver cart pricing
 * uses — SC-001 parity by construction). This service:
 *
 *  - for BOUND keys, replaces the summary/detail `price` with the bound
 *    Organization's effective unit price at quantity 1, sets the
 *    `priceUnavailable` marker, and (detail only) derives the org's
 *    quantity-bracket `priceTiers` ladder by probing the resolver at each
 *    bracket start quantity;
 *  - for ANY key, attaches the channel-public `availability` indication via
 *    the injected inventory port;
 *  - answers the bound-only bulk `(sku, quantity)` pricing request with
 *    per-line results (misses are data, not errors).
 */

/** The request's resolved sales channel — only `id` + `defaultCurrency` are read. */
export interface ExternalPricingChannel {
  id: string;
  defaultCurrency: string;
}

export type ResolveAvailabilityPort = (
  productIds: string[],
  salesChannelId: string,
) => Promise<Map<string, ProductAvailability>>;

export interface CatalogOrgPriceDecoratorDeps {
  emFactory: () => EntityManager;
  /**
   * Feature 075 — the published line-pricing port, where
   * `price_lists`' `PricingServiceContract` used to be. This decorator calls
   * two of its methods. `OrgLinePricePort` — `LinePricePort` plus the bracket
   * ladder — was published in this cut, because `PricingServiceContract` is
   * deliberately not in `@b2b/contracts` (it is the overlay decoration's
   * contract gate) and was `listBracketMinQuantities`' only declaration.
   */
  pricingService: OrgLinePricePort;
  /**
   * Feature 075 — the buying organisation, read through `organizations`' port
   * instead of `em.findOne(Organization, …)` against its table. The engine
   * reads two fields off it (the id, and the customer group a rule keys on),
   * and `OrganizationRecord` carries both.
   */
  organizations: OrganizationDetailsPort;
  /** Optional inventory port — when absent, `availability` is omitted. */
  resolveAvailability?: ResolveAvailabilityPort;
}

export class CatalogOrgPriceDecorator {
  constructor(private readonly deps: CatalogOrgPriceDecoratorDeps) {}

  /**
   * Decorates list summaries in place-order: availability for every caller,
   * org-effective qty-1 price + `priceUnavailable` for bound callers.
   */
  async decorateSummaries(
    summaries: ProductSummary[],
    context: { organizationId: string | null; salesChannel: ExternalPricingChannel },
  ): Promise<ProductSummary[]> {
    if (summaries.length === 0) return summaries;
    const availabilityByProduct = await this.#resolveAvailability(
      summaries.map((s) => s.id),
      context.salesChannel.id,
    );

    if (context.organizationId === null) {
      return summaries.map((summary) => this.#withAvailability(summary, availabilityByProduct));
    }

    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);
    const products = await em.find(Product, { id: { $in: summaries.map((s) => s.id) } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const out: ProductSummary[] = [];
    for (const summary of summaries) {
      const decorated = this.#withAvailability(summary, availabilityByProduct);
      const product = productById.get(summary.id);
      if (!product) {
        out.push({ ...decorated, price: null, priceUnavailable: true });
        continue;
      }
      const resolved = await this.deps.pricingService.resolveLinePrice({
        product,
        context: {
          quantity: 1,
          organization,
          salesChannel: context.salesChannel,
        },
      });
      out.push(
        resolved
          ? {
              ...decorated,
              price: { amount: Number(resolved.amount), currency: resolved.currency },
            }
          : { ...decorated, price: null, priceUnavailable: true },
      );
    }
    return out;
  }

  /**
   * Detail decoration = summary decoration + (bound only) the org's resolved
   * bracket ladder.
   */
  async decorateDetail(
    detail: ProductDetail,
    context: { organizationId: string | null; salesChannel: ExternalPricingChannel },
  ): Promise<ProductDetail> {
    const [decorated] = await this.decorateSummaries([detail], context);
    const merged = { ...detail, ...decorated } as ProductDetail;
    if (context.organizationId === null) return merged;

    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);
    const product = await em.findOne(Product, { id: detail.id });
    if (!product) return merged;
    const priceTiers = await this.#resolvePriceTiers(product, organization, context.salesChannel);
    return { ...merged, priceTiers };
  }

  /**
   * Bound-only bulk pricing: per-line, order-preserving. A SKU outside the
   * bound channel's published assortment (or unknown / inactive / deleted)
   * is indistinguishable from non-existence (`sku_not_in_assortment`); an
   * in-assortment SKU with no resolvable bracket is `price_unavailable`.
   */
  async resolveBulkPrices(
    lines: Array<{ sku: string; quantity: number }>,
    context: { organizationId: string; salesChannel: ExternalPricingChannel },
  ): Promise<CatalogBulkPriceLine[]> {
    const em = this.deps.emFactory();
    const organization = await this.deps.organizations.findById(context.organizationId);

    const skus = Array.from(new Set(lines.map((l) => l.sku)));
    const products = await em.find(Product, {
      sku: { $in: skus },
      deletedAt: null,
      status: 'active',
    });
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const assortment = await this.#filterByChannel(
      em,
      products.map((p) => p.id),
      context.salesChannel.id,
    );

    const out: CatalogBulkPriceLine[] = [];
    for (const line of lines) {
      const product = productBySku.get(line.sku);
      if (!product || !assortment.has(product.id)) {
        out.push({
          sku: line.sku,
          quantity: line.quantity,
          price: null,
          reason: 'sku_not_in_assortment',
        });
        continue;
      }
      const resolved = await this.deps.pricingService.resolveLinePrice({
        product,
        context: {
          quantity: line.quantity,
          organization,
          salesChannel: context.salesChannel,
        },
      });
      if (!resolved) {
        out.push({
          sku: line.sku,
          quantity: line.quantity,
          price: null,
          reason: 'price_unavailable',
        });
        continue;
      }
      out.push({
        sku: line.sku,
        quantity: line.quantity,
        price: {
          amount: resolved.amount,
          currency: resolved.currency,
          isSale: resolved.isSale,
          bracketStartQuantity: resolved.bracketStartQuantity,
          priceListId: resolved.priceListId,
        },
      });
    }
    return out;
  }

  /**
   * The org's effective ladder: probe the resolver at every bracket start
   * quantity known for the (product, currency) across active lists, then
   * drop consecutive rungs that resolve identically (a non-matching list's
   * boundary changes nothing for this org — no cross-org leak).
   */
  async #resolvePriceTiers(
    product: Product,
    organization: OrganizationRecord | null,
    salesChannel: ExternalPricingChannel,
  ): Promise<ProductPriceTier[]> {
    const currencyCode = salesChannel.defaultCurrency.toUpperCase();
    const minQuantities = await this.deps.pricingService.listBracketMinQuantities(
      product.id,
      currencyCode,
    );
    const probeQuantities = Array.from(new Set([1, ...minQuantities])).sort((a, b) => a - b);

    const tiers: ProductPriceTier[] = [];
    for (const quantity of probeQuantities) {
      const resolved = await this.deps.pricingService.resolveLinePrice({
        product,
        context: { quantity, organization, salesChannel },
      });
      if (!resolved) continue;
      const tier: ProductPriceTier = {
        minQuantity: quantity,
        amount: Number(resolved.amount),
        currency: resolved.currency,
        isSale: resolved.isSale,
      };
      const previous = tiers[tiers.length - 1];
      if (previous && previous.amount === tier.amount && previous.isSale === tier.isSale) {
        continue;
      }
      tiers.push(tier);
    }
    return tiers;
  }

  async #resolveAvailability(
    productIds: string[],
    salesChannelId: string,
  ): Promise<Map<string, ProductAvailability>> {
    // D-61 — no `catch` here. `inventory` being absent is *decided* by the
    // contribution, in front of the gate, and arrives as the empty map this
    // method already returns when nothing is wired; the manifest declares that
    // degrade as `degrades-without`. What a `catch` would add is the ability to
    // turn a genuine inventory failure into a silently unpriced band.
    if (!this.deps.resolveAvailability) return new Map();
    return this.deps.resolveAvailability(productIds, salesChannelId);
  }

  #withAvailability(
    summary: ProductSummary,
    availabilityByProduct: Map<string, ProductAvailability>,
  ): ProductSummary {
    const availability = availabilityByProduct.get(summary.id);
    return availability ? { ...summary, availability } : summary;
  }

  /**
   * Published-assortment check — the same `sales_channel_products` bridge
   * read `CatalogQueryService.filterByChannel` performs (catalog owns this
   * bridge's read side; Principle XII fail-closed to the empty set).
   */
  async #filterByChannel(
    em: EntityManager,
    productIds: string[],
    salesChannelId: string,
  ): Promise<Set<string>> {
    if (productIds.length === 0) return new Set();
    const rows = await em
      .getConnection()
      .execute<Array<{ product_id: string }>>(
        `select product_id from sales_channel_products where sales_channel_id = ? and product_id in (${productIds.map(() => '?').join(',')})`,
        [salesChannelId, ...productIds],
      );
    return new Set(rows.map((r) => r.product_id));
  }
}
