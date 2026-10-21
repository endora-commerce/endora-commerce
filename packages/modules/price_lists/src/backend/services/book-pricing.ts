import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeReadPort,
  CatalogCategoryReadPort,
  CatalogProductReadPort,
  CatalogProductVariantRecord,
  DisplayMode,
  ListingPrice,
  ListingPriceDetail,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { buildEligibleAttributes, type EligibleAttribute } from './attribute-eligibility.js';
import {
  createBookResolver,
  type BookPriceType,
  type BookResolution,
  type BookRow,
} from './book-resolver.js';
import type { PricingCache, ProfilePricingCacheKey } from './pricing-cache.js';
import {
  PricingProfileResolver,
  type ApplicableBookRow,
  type ApplicableBooksQuery,
  type PricingProfile,
  type ProfileMemoKey,
} from './pricing-profile.js';
import { PrecedenceStore, type ActivePrecedence, type CellCode } from './precedence.js';
import type {
  PricedProductRef,
  PricingEngineResult,
  PricingLineRequest,
  PricingLineResult,
} from './pricing-service.interface.js';
import { compareDecimal } from './matrix-decimal.js';

/** A listing card's answer: the lowest variant's (or the product's) resolution, and the range. */
export interface ListingAnswer {
  answer: BookLineAnswer | null;
  maxAmount: string | null;
  variesByVariant: boolean;
}

/** The product's attribute values overlaid by the line's variant's axis values (FR-016). */
function effectiveAttributes(
  line: PricingLineRequest,
  variants: ReadonlyMap<string, CatalogProductVariantRecord>,
): Record<string, unknown> {
  const own = line.product.attributeValues ?? {};
  const variant = line.variantId ? variants.get(line.variantId) : undefined;
  if (!variant || variant.parentProductId !== line.product.id) return own;
  return { ...own, ...variant.variantAttributeValues };
}

/**
 * The price-book engine behind the batched entry points — feature 160,
 * `specs/160-pricing-model-v2/contracts/pricing-resolution-v2.md`.
 *
 * One batch costs a constant number of statements whatever the number of lines
 * (§3, the P0 budget): the channel's currencies, the applicable books with the
 * members the buyer can meet (one statement — the profile), their rows for the
 * batch's products and variants (one), the category assignments and the
 * eligible attributes through `catalog`'s ports (one call each, only when a row
 * needs them), and the display-mode chain (unchanged). Everything else is the
 * pure {@link createBookResolver}.
 *
 * **Tenancy (Principle XI).** No book id comes from a caller: the applicable
 * books are only those whose audience is everyone, a member of the buyer's own
 * organization chain or the buyer's effective group, and that is the `where`
 * clause of the one statement that reads them.
 *
 * **Channels (Principle XII).** A book applies on a channel of its set only
 * while that channel offers the book's currency; the set is read through the
 * registered bridge's sanctioned subquery
 * (`SalesChannelMembershipService.entityIdsInChannelSubquery`), never by naming
 * the table. A currency the channel does not offer prices nothing — base
 * included (K3.2): the guard fails closed.
 *
 * **Dates (FR-047).** A book applies while `status ∈ {active, scheduled}` and
 * `starts_at ≤ now < ends_at`, evaluated in the statement, so a start or an end
 * takes effect at its instant rather than at the next status sweep.
 */

export interface ChannelBridgeSubquery {
  entityIdsInChannelSubquery(channelId: string, entityType: 'price-list'): { sql: string; params: string[] };
}

/** What one resolved line is, as the engine caches it. */
export interface BookLineAnswer {
  resolution: BookResolution;
  displayMode: DisplayMode;
  currencyCode: string;
}

export interface BookPricingViewer {
  organizationId: string | null;
  customerGroupId: string | null;
  signedIn: boolean;
  salesChannelId: string;
  currencyCode: string;
}

export interface BookPricingDeps {
  emFactory: () => EntityManager;
  channelBridge: ChannelBridgeSubquery;
  resolveOrgChain?: (orgId: string) => Promise<readonly string[]>;
  categoryRead: () => CatalogCategoryReadPort;
  attributeRead: () => CatalogAttributeReadPort;
  /** `catalog`'s variants, for a variant's axis values (FR-016) and a listing's variant range (FR-024). */
  variantRead: () => Pick<CatalogProductReadPort, 'listVariantsByProductIds'>;
  displayModes: (input: {
    productIds: readonly string[];
    organizationId: string | null;
    salesChannelId: string;
    customerKind: 'guest' | 'signed_in';
    categoryIdsByProduct: ReadonlyMap<string, ReadonlySet<string>>;
  }) => Promise<Map<string, DisplayMode>>;
  cache?: PricingCache<BookLineAnswer, ProfilePricingCacheKey>;
  profileMemo?: PricingCache<PricingProfile, ProfileMemoKey>;
}

const uuidArray = (ids: readonly string[]): string => `{${ids.join(',')}}`;

interface MatrixRowRecord {
  id: string;
  price_list_id: string;
  variant_id: string | null;
  product_id: string | null;
  category_id: string | null;
  attribute_key: string | null;
  attribute_value: string | null;
  min_quantity: number;
  max_quantity: number | null;
  price_type: BookPriceType;
  amount: string | null;
  percent: string | null;
}

export class BookPricing {
  readonly precedence: PrecedenceStore;
  readonly profiles: PricingProfileResolver;

  constructor(private readonly deps: BookPricingDeps) {
    const cache = deps.cache;
    // The precedence memo follows the price cache: on while the cache is on,
    // dropped with it by the pricing generation.
    this.precedence = new PrecedenceStore(
      () => this.#loadPrecedence(),
      () => (cache?.enabled ? cache.generation : Number.NaN),
    );
    this.profiles = new PricingProfileResolver((query) => this.#loadApplicableBooks(query), deps.profileMemo);
  }

  /** Drop every in-process layer this engine holds. */
  invalidateAll(): void {
    this.precedence.invalidateAll();
  }

  /** The answer for every line, keyed by the line's key; `null` when nothing prices it. */
  async resolve(
    lines: readonly PricingLineRequest[],
    viewer: BookPricingViewer,
    prefetchedVariants?: ReadonlyMap<string, CatalogProductVariantRecord>,
  ): Promise<Map<string, BookLineAnswer | null>> {
    const out = new Map<string, BookLineAnswer | null>();
    if (lines.length === 0) return out;
    const currencyCode = viewer.currencyCode.toUpperCase();
    const em = this.deps.emFactory();

    // K3.2 — a currency the channel does not offer prices nothing. A channel
    // that does not exist offers nothing either.
    const channel = await em.findOne(SalesChannel, { id: viewer.salesChannelId }, { fields: ['currencies'] });
    const offered = (channel?.currencies ?? []).map((c) => c.toUpperCase());
    if (!offered.includes(currencyCode)) {
      for (const line of lines) out.set(line.key, null);
      return out;
    }

    const precedence = await this.precedence.active();
    const organizationChain =
      viewer.organizationId === null
        ? []
        : this.deps.resolveOrgChain
          ? await this.deps.resolveOrgChain(viewer.organizationId)
          : [viewer.organizationId];
    const profile = await this.profiles.profileFor({
      channelId: viewer.salesChannelId,
      currencyCode,
      precedenceVersion: precedence.version,
      organizationChain,
      effectiveGroupId: viewer.customerGroupId,
    });

    const cache = this.deps.cache;
    const generation = cache?.generation;
    const keyOf = (line: PricingLineRequest): ProfilePricingCacheKey => ({
      profileKey: profile.key,
      productId: line.product.id,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
    });

    // One resolution per distinct (product, variant, quantity).
    const items = new Map<string, { line: PricingLineRequest; keys: string[] }>();
    for (const line of lines) {
      const id = `${line.product.id}|${line.variantId ?? ''}|${line.quantity}`;
      const item = items.get(id);
      if (item) item.keys.push(line.key);
      else items.set(id, { line, keys: [line.key] });
    }
    const pending: Array<{ line: PricingLineRequest; keys: string[] }> = [];
    for (const item of items.values()) {
      const cached = cache?.get(keyOf(item.line));
      if (cached) for (const key of item.keys) out.set(key, cached);
      else pending.push(item);
    }
    if (pending.length === 0) return out;

    const productIds = [...new Set(pending.map((p) => p.line.product.id))];
    const variantIds = [
      ...new Set(pending.map((p) => p.line.variantId).filter((v): v is string => typeof v === 'string')),
    ];
    const rows = await this.#loadRows(
      em,
      profile.books.map((b) => b.id),
      productIds,
      variantIds,
    );
    const categoryIdsByProduct = await this.#categoryMemberships(productIds);
    // FR-016 — a variant line matches attribute rows on the product's values
    // overlaid by the variant's axis values: one read of the batch's variants.
    let variants = prefetchedVariants ?? new Map<string, CatalogProductVariantRecord>();
    if (!prefetchedVariants && variantIds.length > 0) {
      const withVariant = [...new Set(pending.filter((p) => p.line.variantId).map((p) => p.line.product.id))];
      variants = new Map(
        (await this.deps.variantRead().listVariantsByProductIds(withVariant)).map((v) => [v.id, v]),
      );
    }
    let eligibleAttributes: ReadonlyMap<string, EligibleAttribute> = new Map();
    if (rows.some((r) => r.attributeKey !== null)) {
      eligibleAttributes = buildEligibleAttributes(await this.deps.attributeRead().listByFlag('isPriceRule'));
    }
    const resolver = createBookResolver({ books: profile.books, rows, precedence, eligibleAttributes });
    const displayModes = await this.deps.displayModes({
      productIds,
      organizationId: viewer.organizationId,
      salesChannelId: viewer.salesChannelId,
      customerKind: viewer.signedIn ? 'signed_in' : 'guest',
      categoryIdsByProduct,
    });

    for (const { line, keys } of pending) {
      const resolution = resolver.resolve({
        productId: line.product.id,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
        categoryIds: categoryIdsByProduct.get(line.product.id) ?? new Set<string>(),
        attributes: effectiveAttributes(line, variants),
      });
      const answer: BookLineAnswer = {
        resolution,
        displayMode: displayModes.get(line.product.id) ?? 'gross_only',
        currencyCode,
      };
      cache?.set(keyOf(line), answer, generation);
      for (const key of keys) out.set(key, answer);
    }
    return out;
  }

  /**
   * A listing at quantity 1 (FR-024): a product with variants is priced by
   * resolving every variant — the card shows the lowest ("from"), with the
   * highest beside it — and a product without variants by itself. One read of
   * the page's variants, then one batch.
   */
  async resolveListing(
    products: readonly PricedProductRef[],
    viewer: BookPricingViewer,
  ): Promise<Map<string, ListingAnswer>> {
    const out = new Map<string, ListingAnswer>();
    if (products.length === 0) return out;
    const variantsByProduct = new Map<string, CatalogProductVariantRecord[]>();
    const records = await this.deps.variantRead().listVariantsByProductIds(products.map((p) => p.id));
    for (const v of records) {
      const list = variantsByProduct.get(v.parentProductId);
      if (list) list.push(v);
      else variantsByProduct.set(v.parentProductId, [v]);
    }
    const lines: PricingLineRequest[] = [];
    for (const product of products) {
      const variants = variantsByProduct.get(product.id) ?? [];
      if (variants.length === 0) lines.push({ key: product.id, product, quantity: 1 });
      for (const v of variants) lines.push({ key: `${product.id}|${v.id}`, product, variantId: v.id, quantity: 1 });
    }
    const answers = await this.resolve(lines, viewer, new Map(records.map((v) => [v.id, v])));
    for (const product of products) {
      const variants = variantsByProduct.get(product.id) ?? [];
      if (variants.length === 0) {
        out.set(product.id, { answer: answers.get(product.id) ?? null, maxAmount: null, variesByVariant: false });
        continue;
      }
      let lowest: BookLineAnswer | null = null;
      let highest: string | null = null;
      const distinct = new Set<string>();
      for (const v of variants) {
        const answer = answers.get(`${product.id}|${v.id}`) ?? null;
        const amount = answer?.resolution.price?.amount;
        if (!answer || amount === undefined) continue;
        distinct.add(amount);
        if (!lowest || compareDecimal(amount, lowest.resolution.price!.amount) < 0) lowest = answer;
        if (highest === null || compareDecimal(amount, highest) > 0) highest = amount;
      }
      out.set(product.id, { answer: lowest, maxAmount: highest, variesByVariant: distinct.size > 1 });
    }
    return out;
  }

  async #loadPrecedence(): Promise<ActivePrecedence | null> {
    const em = this.deps.emFactory();
    const rows = await em.execute<
      Array<{ version: number; cells: CellCode[]; category_before_attribute: boolean; depth_mode: string }>
    >(
      `select "version", "cells", "category_before_attribute", "depth_mode"
         from "price_list_precedence" where "state" = 'active' limit 1`,
    );
    const row = rows[0];
    if (!row) return null;
    return {
      version: Number(row.version),
      config: {
        cells: row.cells,
        categoryBeforeAttribute: row.category_before_attribute,
        depthMode: row.depth_mode === 'nearest_organization_first' ? 'nearest_organization_first' : 'within_cell',
      },
    };
  }

  /**
   * The applicable books of a (channel, currency) for one buyer, with the
   * members of the buyer's chain or group that matched — one statement. The
   * base book of the currency is always among them (channel-independent by
   * D-287 §5.1).
   */
  async #loadApplicableBooks(query: ApplicableBooksQuery): Promise<ApplicableBookRow[]> {
    const em = this.deps.emFactory();
    const bridge = this.deps.channelBridge.entityIdsInChannelSubquery(query.channelId, 'price-list');
    const rows = await em.execute<
      Array<{
        id: string;
        name: string;
        type: 'base' | 'regular' | 'sale';
        audience_kind: ApplicableBookRow['audienceKind'];
        priority: number;
        is_system: boolean;
        member_organization_id: string | null;
        member_customer_group_id: string | null;
      }>
    >(
      `select l."id", l."name", l."type", l."audience_kind", l."priority", l."is_system",
              m."organization_id" as "member_organization_id",
              m."customer_group_id" as "member_customer_group_id"
         from "price_lists" l
         left join "price_list_audience_members" m
           on m."price_list_id" = l."id"
          and (m."organization_id" = any(?::uuid[]) or m."customer_group_id" = ?::uuid)
        where l."currency_code" = ?
          and (
            l."is_system" = true
            or (
              l."application_rule" is null
              and l."status" in ('active', 'scheduled')
              and (l."starts_at" is null or l."starts_at" <= now())
              and (l."ends_at" is null or l."ends_at" > now())
              and l."id" in (${bridge.sql})
              and (l."audience_kind" = 'everyone' or m."id" is not null)
            )
          )`,
      [uuidArray(query.organizationIds), query.customerGroupId, query.currencyCode, ...bridge.params],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      audienceKind: r.audience_kind,
      priority: Number(r.priority),
      isSystem: r.is_system,
      memberOrganizationId: r.member_organization_id,
      memberCustomerGroupId: r.member_customer_group_id,
    }));
  }

  /** The rows of the applicable books a batch can meet — one statement. */
  async #loadRows(
    em: EntityManager,
    bookIds: readonly string[],
    productIds: readonly string[],
    variantIds: readonly string[],
  ): Promise<BookRow[]> {
    if (bookIds.length === 0) return [];
    const rows = await em.execute<MatrixRowRecord[]>(
      `select "id", "price_list_id", "variant_id", "product_id", "category_id", "attribute_key",
              "attribute_value", "min_quantity", "max_quantity", "price_type", "amount", "percent"
         from "price_list_matrix_entries"
        where "price_list_id" = any(?::uuid[])
          and "price_type" in ('fixed', 'percent', 'amount')
          and ("product_id" is null or "product_id" = any(?::uuid[]))
          and ("variant_id" is null or "variant_id" = any(?::uuid[]))`,
      [uuidArray(bookIds), uuidArray(productIds), uuidArray(variantIds)],
    );
    return rows.map((r) => ({
      id: r.id,
      bookId: r.price_list_id,
      variantId: r.variant_id,
      productId: r.product_id,
      categoryId: r.category_id,
      attributeKey: r.attribute_key,
      attributeValue: r.attribute_value,
      minQuantity: Number(r.min_quantity),
      maxQuantity: r.max_quantity === null ? null : Number(r.max_quantity),
      priceType: r.price_type,
      amount: r.amount === null ? null : String(r.amount),
      percent: r.percent === null ? null : String(r.percent),
    }));
  }

  /** `(product, category)` memberships for the batch, through `catalog`'s port — one call. */
  async #categoryMemberships(productIds: readonly string[]): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    for (const id of productIds) out.set(id, new Set<string>());
    if (productIds.length === 0) return out;
    for (const assignment of await this.deps.categoryRead().listAssignmentsForProducts(productIds)) {
      out.get(assignment.productId)?.add(assignment.categoryId);
    }
    return out;
  }
}

// ---- Mapping onto the published result shapes --------------------------------

/** The charged line, as `resolveLinePrice(s)` answers it. */
export function lineFromBook(answer: BookLineAnswer | null): PricingLineResult | null {
  const price = answer?.resolution.price ?? null;
  if (!answer || !price) return null;
  return {
    amount: price.amount,
    currency: answer.currencyCode,
    priceListId: price.bookId,
    isSale: price.source === 'sale',
    bracketStartQuantity: price.startQuantity,
    displayMode: answer.displayMode,
    matrixEntryId: price.rowId,
    source: price.source,
    compareAt: price.compareAt,
    explanation: answer.resolution.explanation,
  };
}

/**
 * The listing chain on price books: the resolved price, or `none` (FR-018).
 * There is no "product's own price" arm any more — a product no tier prices is
 * unpriced, and follows the quote-only path.
 */
export function listingPriceFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
): ListingPrice {
  const price = answer?.resolution.price ?? null;
  if (!answer || !price) return { source: 'none' };
  return {
    ...(range?.variesByVariant ? { variesByVariant: true } : {}),
    ...(range?.maxAmount ? { maxAmount: range.maxAmount } : {}),
    source: 'price_list',
    amount: price.amount,
    currency: answer.currencyCode,
    priceListId: price.bookId,
    isSale: price.source === 'sale',
    priceSource: price.source,
    ...(price.compareAt !== null && price.source === 'sale' ? { compareAtAmount: price.compareAt } : {}),
  };
}

/** The base / sale / tier split from the same resolution. */
export function listingDetailFromBook(
  answer: BookLineAnswer | null,
  range?: { maxAmount: string | null; variesByVariant: boolean },
): ListingPriceDetail {
  const price = listingPriceFromBook(answer, range);
  const currency = answer?.currencyCode ?? '';
  const money = (amount: string | null | undefined) => (amount ? { amount, currency } : null);
  const r = answer?.resolution ?? null;
  const regular = r ? (r.buyer?.amount ?? r.catalogue?.amount ?? r.base?.amount ?? null) : null;
  const saleCharged = r?.price?.source === 'sale';
  return {
    price,
    basePrice: money(regular),
    salePrice: saleCharged ? money(r!.price!.amount) : null,
    displayMode: answer?.displayMode ?? 'gross_only',
    tiers: {
      base: money(r?.base?.amount),
      catalogue: money(r?.catalogue?.amount),
      buyer: money(r?.buyer?.amount),
      sale: money(r?.sale?.amount),
    },
  };
}

/** The legacy engine shape, for `resolveEngine` callers: the regular price, and the sale when charged. */
export function engineFromBook(answer: BookLineAnswer | null, productId: string, currencyCode: string): PricingEngineResult {
  const r = answer?.resolution ?? null;
  const regular = r ? (r.buyer ?? r.catalogue ?? r.base) : null;
  const charged = r?.price ?? null;
  return {
    base: {
      listId: regular?.bookId ?? '',
      listName: regular?.bookName ?? '',
      bracket: regular
        ? {
            priceListId: regular.bookId,
            productId,
            currencyCode: answer!.currencyCode,
            minQuantity: regular.startQuantity,
            maxQuantity: regular.endQuantity,
            amount: regular.amount,
            matrixEntryId: regular.rowId,
          }
        : null,
    },
    sale:
      charged && charged.source === 'sale' && r?.sale
        ? {
            listId: r.sale.bookId,
            listName: r.sale.bookName,
            bracket: {
              priceListId: r.sale.bookId,
              productId,
              currencyCode: answer!.currencyCode,
              minQuantity: r.sale.startQuantity,
              maxQuantity: r.sale.endQuantity,
              amount: r.sale.amount,
              matrixEntryId: r.sale.rowId,
            },
          }
        : null,
    displayMode: answer?.displayMode ?? 'gross_only',
    currencyCode: answer?.currencyCode ?? currencyCode,
    source: charged?.source ?? null,
    compareAt: charged?.compareAt ?? null,
  };
}
