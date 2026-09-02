import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import type {
  CatalogProductFilter,
  CatalogProductFilterCondition,
  CatalogProductFilterPort,
  CatalogProductRecord,
  CatalogSellableProductQuery,
} from '@endora-commerce/contracts';
import { Product } from '../entities/product.entity.js';
import { toCatalogProductRecord } from './catalog-product-read.service.js';

/**
 * The sellable-product filter `catalog` publishes (feature 075).
 *
 * `product_feeds` compiles an operator's selection rule into a predicate and
 * walks the catalogue with it. Until this port existed it did that by holding
 * `Product` and handing MikroORM a `where` object of its own construction —
 * the one demand Phase P declined to guess at, because a query object is the
 * ORM rather than a contract.
 *
 * Three things move across the boundary with the translation, and each of them
 * is why the port is worth more than the import it replaces:
 *
 *  1. **The floor is applied here.** Feature 067's FR-026 says an operator's
 *     rule may only ever narrow "active, visible to the feed's reader, not
 *     archived, not soft-deleted, in the feed's channel". On the caller's side
 *     that was a conjunction a future edit could spread into one object and
 *     lose; here it is one `$and` clause the caller cannot reach. Who "the
 *     feed's reader" is has one answer and it is not this file's to invent —
 *     see {@link ANONYMOUS_AUDIENCE_CLAUSE}.
 *  2. **The cursor is applied here.** A keyset walk and the floor both
 *     constrain `id`, and so does a category criterion. Composing all three
 *     was the caller's problem and is now nobody's.
 *  3. **Rows leave as records.** The caller reads six fields off each row and
 *     yields ids; it never needed a managed entity, and holding one made the
 *     identity map grow with the catalogue rather than with the page.
 *
 * ## What the translation may and may not do
 *
 * The filter grammar is deliberately narrower than MikroORM: six columns, the
 * JSONB attribute bag, twelve operators, `and` / `or`, and the two constants.
 * There is no node this function could translate into a join, a relation walk
 * or a raw fragment, which is what stops the port becoming the general query
 * surface publishing the DSL would have made it.
 *
 * `contains` and `startsWith` build their own patterns, so the caller never
 * writes `LIKE` syntax and the escaping rule has exactly one home — this file.
 * See {@link escapeLikeLiteral} for what that rule is and why the value has to
 * go through it.
 */

/**
 * The one place a `contains` / `startsWith` value becomes part of a pattern.
 *
 * Both operators name a **literal**: `contains "50%"` means the three
 * characters `5`, `0`, `%`. `LIKE` reads `%` as "anything", `_` as "any one
 * character" and — in PostgreSQL, absent an explicit `ESCAPE` clause — `\` as
 * the escape character, so a value carrying any of the three used to mean
 * something other than what the operator promises. Issue #181: an unescaped
 * `contains "50%"` selected every product with "50" followed by anything.
 *
 * `\` is the escape character used here rather than an explicit `ESCAPE`
 * clause, because there is nowhere to put one: MikroORM renders `$ilike` as
 * `column ilike ?` with the pattern bound as a parameter, and reaching for a
 * raw fragment to append `ESCAPE` would put SQL text back into a translation
 * whose whole point is that it has no node for one. PostgreSQL's default escape
 * character already *is* `\`, so escaping with it needs no clause — and it has
 * to be escaped first in its own right, or a value ending in a backslash would
 * escape the wildcard this function's callers append.
 *
 * Note the failure was not only over-matching: PostgreSQL degrades an escape
 * sequence it does not recognise to the plain character, so the unescaped
 * pattern for `C\D` also *missed* the row that actually holds the backslash.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** The page size the feed pipeline already walks in. */
const DEFAULT_PAGE_SIZE = 500;

/**
 * A predicate that can never be satisfied — `id` is the primary key, so no row
 * has a null one.
 */
const NEVER: Record<string, unknown> = { id: null };

/**
 * An explicit tautology, for the one place emptiness is not neutral: a branch
 * of `$or`, where an empty object collapses the branch instead of matching
 * every row.
 */
const ALWAYS: Record<string, unknown> = { id: { $ne: null } };

export class CatalogProductFilterService implements CatalogProductFilterPort {
  constructor(private readonly emFactory: () => EntityManager) {}

  async listSellable(query: CatalogSellableProductQuery): Promise<CatalogProductRecord[]> {
    if (query.productIds.length === 0) return [];
    const em = this.emFactory();
    const rows = await em.find(Product, this.where(query) as FilterQuery<Product>, {
      orderBy: { id: 'asc' },
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
    });
    const records = rows.map(toCatalogProductRecord);
    // This manager is ours — `emFactory()` forks — and clearing it is what keeps
    // a long walk O(page) rather than O(catalogue). Nothing survives the call
    // but the records above, which are plain objects.
    em.clear();
    return records;
  }

  async countSellable(
    query: Omit<CatalogSellableProductQuery, 'afterId' | 'limit'>,
  ): Promise<number> {
    if (query.productIds.length === 0) return 0;
    return this.emFactory().count(
      Product,
      this.where({ ...query, afterId: null }) as FilterQuery<Product>,
    );
  }

  /**
   * Floor AND filter AND cursor, as an explicit `$and`.
   *
   * Never an object spread: all three constrain `id`, and spreading them keeps
   * only the last one — which for a category criterion would drop the channel
   * scoping altogether.
   */
  private where(query: CatalogSellableProductQuery): Record<string, unknown> {
    const clauses: Array<Record<string, unknown>> = [sellableFloor(query.productIds)];
    const predicate = translateFilter(query.filter);
    if (predicate !== null) clauses.push(predicate);
    if (query.afterId) clauses.push({ id: { $gt: query.afterId } });
    return { $and: clauses };
  }
}

/**
 * `isProductVisibleTo(row, ANONYMOUS_PRODUCT_AUDIENCE)`, written as SQL.
 *
 * The only consumer of this port is a **product feed**, and a feed is read by
 * Google: an anonymous, unauthenticated consumer with no organisation and no
 * session. That is the same audience the sitemap answers for, and it is now
 * answered with the same words — the platform has one predicate for "may this
 * caller see this product" and this clause is its SQL half, not a second
 * opinion (issue #259).
 *
 * The floor used to say `visibility: 'public'` and stop, which is not the whole
 * answer: an operator can save `public` **with** a non-empty
 * `allowed_organization_ids`, and the allow-list restricts whatever the
 * visibility column says. A feed carrying such a row advertises a URL an
 * anonymous visitor gets a 404 from, and advertises the existence of an
 * assortment reserved for one distributor to everybody else's crawler.
 *
 * ## Why it collapses to two equalities
 *
 * The general SQL form of the predicate is the containment `catalog`'s
 * quick-search applies — `allowed_organization_ids @> '[<buyer org>]'`, so the
 * buyer's id is an *element* of the array rather than a substring of the
 * serialised bag. For the **anonymous** audience there is no organisation to
 * contain, so that branch can never match, and what is left is the predicate's
 * second branch: an empty allow-list, decided by `visibility` alone, which for
 * an unauthenticated caller means `public`.
 *
 * That difference is the point, not an omission (issue #262). The other SQL
 * statement of this rule is in `catalog-quick-search.service.ts`, it answers
 * for a **signed-in buyer** — `{ organizationId, authenticated: true }`, an
 * audience that surface's port requires — and it therefore keeps the
 * containment branch and admits `logged_in_only`. Neither clause may be
 * aligned with the other: the containment branch would be dead weight here,
 * and these two equalities over there would hide from a buyer every row his own
 * organisation is named on. Each site has its own parity test instead, and both
 * derive their expectations from `isProductVisibleTo`.
 *
 * ## Why the empty test is spelled `{ $eq: [] }`
 *
 * It renders `allowed_organization_ids = '[]'`, and `jsonb` equality is
 * structural, so it matches the empty array and nothing else. Do **not**
 * "simplify" it to a bare `allowedOrganizationIds: []`: MikroORM reads a bare
 * array as an `$in` list, and an empty one matches no row at all — every
 * product would silently leave every feed.
 *
 * A raw `jsonb_array_length(...) = 0` fragment was the other candidate and is
 * refused for a sharper reason: as a `raw()` key it survives `em.find` and
 * breaks in `em.count`, which re-quotes the fragment as an identifier. That is
 * precisely the half this port must never differ on — `countSellable` is the
 * number an operator is shown before saving and `listSellable` is what the run
 * emits.
 *
 * ## How this stays in step with the TypeScript predicate
 *
 * `backend/test/integration/catalog/product-filter-port.test.ts` seeds every
 * `productVisibilitySchema.options` × (empty, non-empty) state and derives its
 * expectation from `isProductVisibleTo` itself, for `listSellable` and
 * `countSellable` both. Neither side can drift without that file going red, and
 * a fourth visibility value enters the sweep as soon as the enum grows.
 *
 * `backend/test/integration/catalog/quick-search-audience-parity.test.ts` is
 * the same mechanism for the buyer-facing statement — the states this sweep
 * cannot reach, an allow-list naming the viewer's own organisation among
 * others, being exactly what an anonymous audience has no way to express.
 */
const ANONYMOUS_AUDIENCE_CLAUSE: Record<string, unknown> = {
  visibility: 'public',
  allowedOrganizationIds: { $eq: [] },
};

/**
 * The non-overridable floor. One function so there is exactly one place a
 * reviewer has to read to know what this port can return.
 *
 * The audience half of it — the two clauses over `visibility` and
 * `allowed_organization_ids` — is {@link ANONYMOUS_AUDIENCE_CLAUSE}.
 */
function sellableFloor(productIds: readonly string[]): Record<string, unknown> {
  return {
    id: { $in: [...productIds] },
    status: 'active',
    // Two keys nothing else in this object names, so the spread cannot lose a
    // clause the way `where()`'s comment warns an `id` spread would.
    ...ANONYMOUS_AUDIENCE_CLAUSE,
    archivedAt: null,
    deletedAt: null,
  };
}

/** `null` when the node constrains nothing, so the caller can omit the clause. */
export function translateFilter(filter: CatalogProductFilter): Record<string, unknown> | null {
  if (filter.kind === 'all') return null;
  if (filter.kind === 'none') return NEVER;
  if (filter.kind === 'group') {
    const children = filter.children.map((child) => translateFilter(child) ?? ALWAYS);
    if (children.length === 0) return null;
    return { [filter.op === 'or' ? '$or' : '$and']: children };
  }
  return translateCondition(filter);
}

function translateCondition(condition: CatalogProductFilterCondition): Record<string, unknown> {
  const comparison = comparisonFor(condition);
  if (comparison === null) return NEVER;
  if (condition.field.kind === 'column') {
    return { [condition.field.column]: comparison.value };
  }
  return { attributeValues: { [condition.field.key]: comparison.value } };
}

/**
 * One operator, as the ORM spells it. `null` means the condition cannot be
 * satisfied — an operator that needs a value and was given none, which is a
 * half-filled criterion and must select nothing rather than everything.
 */
function comparisonFor(condition: CatalogProductFilterCondition): { value: unknown } | null {
  const { op, values } = condition;
  if (op === 'isNull') return { value: null };
  if (op === 'isNotNull') return { value: { $ne: null } };
  if (values.length === 0) return null;
  const first = values[0];

  switch (op) {
    case 'eq':
      return { value: first };
    case 'ne':
      return { value: { $ne: first } };
    case 'in':
      return { value: { $in: [...values] } };
    case 'nin':
      return { value: { $nin: [...values] } };
    case 'gt':
      return { value: { $gt: first } };
    case 'gte':
      return { value: { $gte: first } };
    case 'lt':
      return { value: { $lt: first } };
    case 'lte':
      return { value: { $lte: first } };
    case 'contains':
      return { value: { $ilike: `%${escapeLikeLiteral(String(first))}%` } };
    case 'startsWith':
      return { value: { $ilike: `${escapeLikeLiteral(String(first))}%` } };
    /* c8 ignore next 4 -- unreachable while the contract union and this switch
       agree; a future operator with no branch selects nothing rather than
       everything. */
    default:
      return null;
  }
}
