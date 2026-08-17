import type {
  CatalogProductFilterPort,
  CatalogProductReadPort,
  CatalogProductRecord,
  ProductSelectionRule,
} from '@b2b/contracts';
import {
  collectSelectionCategoryIds,
  compileSelectionRule,
  UnknownSelectionFieldError,
  type CompiledSelection,
  type SelectionCandidate,
  type SelectionCompileContext,
} from './selection-rule-compiler.js';

/**
 * Product selection — feature 067 / FR-024, FR-025, FR-026, FR-027, FR-029.
 *
 * Three rules govern this file and none is negotiable.
 *
 * **1. The eligibility floor is server-side and cannot be widened.** Active,
 * publicly visible, not archived, not soft-deleted, and a member of the feed's
 * channel. An operator's `selectionRule` can only ever narrow that set.
 *
 * Since feature 075's cut the first four of those five live **inside**
 * `catalogProductFilterPort`, where no caller can reach them, and the fifth —
 * the channel's membership — is the id list this service hands the port. That
 * is a stronger arrangement than the conjunction this file used to build: the
 * floor, a category criterion and the keyset cursor all constrain `id`, so one
 * object spread was all that stood between FR-026 and a feed carrying drafts.
 *
 * **2. Channel membership comes from the sanctioned accessor only**
 * (Principle XII). `SalesChannelMembershipService.listEntityIdsForChannel` is
 * injected as a port; this module never queries `sales_channel_products`. The
 * raw-SQL bridge read in `seo/services/sitemap-generator.service.ts:260-288`
 * predates the rule and is explicitly **not** the model here.
 *
 * **3. There is no fail-open branch.** An unresolvable channel throws
 * `ChannelUnavailableError`, which the run records as `channel_unavailable`; a
 * criterion naming a deleted attribute throws `UnknownSelectionFieldError`,
 * which the run records as a configuration error (FR-029). A feed that cannot
 * resolve its configuration must produce nothing, never everything. `catalog`
 * being switched off joins that list: the scan answers 503 `MODULE_DISABLED`
 * and the run stops, where the `em.find(Product, …)` it replaces went on
 * reading rows a deactivation leaves exactly where they are.
 *
 * ## Why some criteria are evaluated in memory
 *
 * Stock availability and price do not live in a column this module may read —
 * they belong to `inventory` and `price_lists`, and are reached through
 * injected ports (Principle I). `selection-rule-compiler.ts` therefore returns
 * a query-stage **superset** plus an exact `evaluate` for those rules; this
 * service runs both stages, page by page, and never the first alone.
 */

/** Ids are resolved in pages so the cursor stays stable while the catalogue moves. */
const ID_PAGE_SIZE = 500;

/** Membership is read in pages too; the bridge accessor is itself paginated. */
const MEMBERSHIP_PAGE_SIZE = 1_000;

export class ChannelUnavailableError extends Error {
  constructor(salesChannelId: string) {
    super(`Sales channel "${salesChannelId}" is unavailable for this feed.`);
    this.name = 'ChannelUnavailableError';
  }
}

export { UnknownSelectionFieldError };

/** The narrow slice of the channel-membership service this module depends on. */
export interface ChannelMembershipPort {
  listEntityIdsForChannel(
    channelId: string,
    entityType: 'product',
    page?: number,
    pageSize?: number,
  ): Promise<{ entityIds: string[]; total: number }>;
}

/**
 * The catalog reads a criteria rule needs and this module must not perform
 * itself: category-subtree expansion over `product_categories` (FR-025
 * "including descendants") and the live definition keys FR-029 validates
 * against. Injected so `product_feeds` keeps no knowledge of catalog internals.
 */
export interface CatalogSelectionPort {
  /** Product ids per requested category, expanded over the whole subtree. */
  expandCategoryProductIds(categoryIds: string[]): Promise<Map<string, Set<string>>>;
  /** Every product-host attribute / custom-field key that currently exists. */
  listProductFieldKeys(): Promise<Set<string>>;
}

/** Availability for a batch of products, as the module already models it. */
export type SelectionAvailabilityPort = (
  productIds: string[],
  salesChannelId: string,
) => Promise<Map<string, { inStock: boolean }>>;

/** Net unit price per product, in the feed's currency and price basis. */
export type SelectionPricePort = (input: {
  productIds: string[];
  salesChannelId: string;
  currencyCode: string;
  priceListId: string | null;
}) => Promise<Map<string, number>>;

export interface SelectionScope {
  salesChannelId: string;
  selectionRule: ProductSelectionRule;
  /**
   * Needed only by a rule with a price criterion. Absent ⇒ such a rule matches
   * nothing rather than everything: an unpriceable criterion is a configuration
   * problem, not a licence to publish the catalogue.
   */
  currencyCode?: string;
  priceListId?: string | null;
}

export interface ProductSelectionServiceDeps {
  membership: ChannelMembershipPort;
  catalog: CatalogSelectionPort;
  /**
   * The scan itself. `catalog` owns the floor, the keyset cursor and the
   * translation of {@link CatalogProductFilter} into a query; this module owns
   * the rule and what the rule means.
   */
  productFilter: CatalogProductFilterPort;
  /** Resolving the sample rows a preview shows, once their ids are known. */
  productReads: CatalogProductReadPort;
  resolveAvailability: SelectionAvailabilityPort;
  resolvePrices: SelectionPricePort;
}

export class ProductSelectionService {
  constructor(private readonly deps: ProductSelectionServiceDeps) {}

  /**
   * Every product id the channel carries. Throws rather than returning an empty
   * set for an unresolvable channel: "no members" and "no such channel" must
   * not look the same to the caller (FR-027).
   */
  private async channelProductIds(salesChannelId: string): Promise<string[]> {
    const ids: string[] = [];
    let page = 0;
    for (;;) {
      let result: { entityIds: string[]; total: number };
      try {
        result = await this.deps.membership.listEntityIdsForChannel(
          salesChannelId,
          'product',
          page,
          MEMBERSHIP_PAGE_SIZE,
        );
      } catch {
        // A membership read that throws means the channel does not resolve.
        // There is no fail-open branch here: an unresolvable channel must
        // produce nothing, never everything (FR-027).
        throw new ChannelUnavailableError(salesChannelId);
      }
      ids.push(...result.entityIds);
      if (ids.length >= result.total || result.entityIds.length === 0) break;
      page += 1;
    }
    return ids;
  }

  /**
   * Compiles the rule onto `catalog`'s published filter grammar and returns the
   * matching ids in keyset order.
   *
   * `AsyncGenerator` rather than an array on purpose: the generation pipeline
   * consumes ids one page at a time, so a 100k-product channel never
   * materialises as one list of ids either.
   */
  async *iterateProductIds(scope: SelectionScope): AsyncGenerator<string[]> {
    // Bound as a local so the channel this query set is scoped by is visible in
    // the same scope as the query itself (`no-unscoped-channel-query`).
    const { salesChannelId } = scope;
    const channelIds = await this.channelProductIds(salesChannelId);
    if (channelIds.length === 0) return;

    const compiled = await this.compile(scope.selectionRule);
    let cursor: string | null = null;
    for (;;) {
      // The floor and the cursor are the port's; what this module supplies is
      // the channel's members and what the operator's rule means. Records come
      // back rather than managed entities, so the identity-map clear this loop
      // used to need has nothing left to clear.
      const rows = await this.deps.productFilter.listSellable({
        productIds: channelIds,
        filter: compiled.filter,
        afterId: cursor,
        limit: ID_PAGE_SIZE,
      });
      if (rows.length === 0) return;
      const matched = await this.refine(compiled, rows, scope);
      const lastId = rows[rows.length - 1]!.id;
      const exhausted = rows.length < ID_PAGE_SIZE;
      if (matched.length > 0) yield matched;
      if (exhausted) return;
      cursor = lastId;
    }
  }

  /**
   * Total matching the selection — the criteria preview count (FR-028).
   *
   * The cheap `count(*)` is used only when the rule is fully expressible in
   * SQL. A rule with a stock or price criterion walks the same two-stage path
   * the run does, so the number the operator sees before saving is the number
   * the next run considers, not an optimistic approximation.
   */
  async countProductIds(scope: SelectionScope): Promise<number> {
    const { salesChannelId } = scope;
    const compiled = await this.compile(scope.selectionRule);
    if (compiled.evaluate === null) {
      const channelIds = await this.channelProductIds(salesChannelId);
      if (channelIds.length === 0) return 0;
      return this.deps.productFilter.countSellable({
        productIds: channelIds,
        filter: compiled.filter,
      });
    }
    let total = 0;
    for await (const page of this.iterateProductIds(scope)) total += page.length;
    return total;
  }

  /**
   * Compiles the rule and discards the result, so a criterion naming a deleted
   * attribute is refused **before** the run opens its artefact stream (FR-029).
   * Without this the same `UnknownSelectionFieldError` surfaces from inside the
   * storage pipeline and is recorded as `storage_unavailable` — the operator
   * would be told the disk is broken when their criteria are.
   */
  async validateRule(rule: ProductSelectionRule): Promise<void> {
    await this.compile(rule);
  }

  /** A handful of matched products, so the operator can sanity-check the rule (FR-028). */
  async sampleProducts(
    scope: SelectionScope,
    limit: number,
  ): Promise<Array<{ id: string; sku: string; name: Record<string, string> }>> {
    if (limit <= 0) return [];
    const ids: string[] = [];
    for await (const page of this.iterateProductIds(scope)) {
      ids.push(...page);
      if (ids.length >= limit) break;
    }
    if (ids.length === 0) return [];
    // `ids` arrives from a keyset walk, so it is already ascending; the read
    // port makes no ordering promise, and re-imposing the caller's order here
    // is what keeps the preview stable between two identical requests.
    const wanted = ids.slice(0, limit);
    const rows = await this.deps.productReads.findByIds(wanted);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return wanted.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [{ id: row.id, sku: row.sku, name: row.name }];
    });
  }

  /**
   * Rule AST → predicate (+ the exact in-memory evaluator when the SQL stage is
   * only a superset). The category expansion and the live definition keys are
   * read once per compile, through the injected catalog port.
   */
  private async compile(rule: ProductSelectionRule): Promise<CompiledSelection> {
    const categoryIds = collectSelectionCategoryIds(rule);
    const context: SelectionCompileContext = {
      knownFieldKeys: await this.deps.catalog.listProductFieldKeys(),
      categoryProductIds:
        categoryIds.length > 0
          ? await this.deps.catalog.expandCategoryProductIds(categoryIds)
          : new Map<string, Set<string>>(),
    };
    return compileSelectionRule(rule, context);
  }

  /**
   * Stage two. Returns the page unchanged when the rule was fully expressible
   * in SQL; otherwise resolves only the ports the rule actually needs and
   * decides each candidate exactly.
   */
  private async refine(
    compiled: CompiledSelection,
    rows: CatalogProductRecord[],
    scope: SelectionScope,
  ): Promise<string[]> {
    if (compiled.evaluate === null) return rows.map((row) => row.id);

    const ids = rows.map((row) => row.id);
    const availability = compiled.needsStock
      ? await this.deps.resolveAvailability(ids, scope.salesChannelId)
      : new Map<string, { inStock: boolean }>();
    // No currency ⇒ no price can be resolved ⇒ the criterion matches nothing.
    // Fail closed, exactly as an unresolvable channel does.
    const prices =
      compiled.needsPrice && scope.currencyCode
        ? await this.deps.resolvePrices({
            productIds: ids,
            salesChannelId: scope.salesChannelId,
            currencyCode: scope.currencyCode,
            priceListId: scope.priceListId ?? null,
          })
        : new Map<string, number>();

    const matched: string[] = [];
    for (const row of rows) {
      const candidate: SelectionCandidate = {
        id: row.id,
        type: row.type,
        status: row.status,
        attributeValues: row.attributeValues,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        inStock: compiled.needsStock ? (availability.get(row.id)?.inStock ?? null) : null,
        price: compiled.needsPrice ? (prices.get(row.id) ?? null) : null,
      };
      if (compiled.evaluate(candidate)) matched.push(row.id);
    }
    return matched;
  }
}
