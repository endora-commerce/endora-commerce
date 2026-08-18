import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogAttributeReadPort,
  CatalogQuickSearchField,
  CatalogQuickSearchHit,
  CatalogQuickSearchParams,
  CatalogQuickSearchPort,
} from '@b2b/contracts';

/**
 * The buyer-facing quick-search read model (issue #174).
 *
 * `quick_order` asked this question with its own knex `select` against
 * `products`. Three things were wrong with that, and only the second is about
 * module boundaries:
 *
 *  1. it read another module's table with no import specifier, so
 *     `check:module-boundary` could not see the edge (plan.md trap 6);
 *  2. it encoded this module's `attribute_values` JSONB layout in a second
 *     module, so a column rename here breaks a file over there with nothing to
 *     warn either side;
 *  3. **it filtered on `status = 'active'` and nothing else.** No channel
 *     membership, so a signed-in buyer shopping one channel got type-ahead
 *     hits for products bound only to another — Constitution XII.
 *
 * The channel filter below is the same `sales_channel_products` membership
 * `CatalogQueryService.filterByChannel` applies to the public listing and the
 * product detail, and it fails closed the same way: no membership row, no hit.
 *
 * ## What is deliberately *not* filtered
 *
 * `visibility` and `allowed_organization_ids` are not applied here, and that is
 * not an oversight. Neither is enforced on any read path in this module today —
 * the public listing, the product detail and the external namespace all ignore
 * both — so enforcing them in this one port would give the platform two
 * different answers to "can this buyer see this product" depending on which
 * surface asked. That gap is platform-wide and belongs to its own change;
 * closing it here would hide it. `deleted_at is null` *is* applied, because
 * every other customer-facing read in this module applies it and the knex query
 * not doing so was a plain defect: a soft-deleted product whose `status` was
 * still `active` came back.
 */
export class CatalogQuickSearchService implements CatalogQuickSearchPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly attributeRead: CatalogAttributeReadPort,
  ) {}

  async quickSearch(params: CatalogQuickSearchParams): Promise<CatalogQuickSearchHit[]> {
    const needle = params.q.trim();
    if (needle === '' || params.limit <= 0) return [];

    // The `quickSearchable` flag is this module's, and so is the JSONB the
    // values live in — which is the whole reason the predicate belongs here.
    const quickKeys = (await this.attributeRead.listByFlag('quickSearchable')).map((a) => a.key);

    const em = this.emFactory();
    const like = `%${needle}%`;

    // One statement, joined to the channel bridge, so the scope cannot be
    // forgotten by a later caller and the limit is applied *after* scoping —
    // narrowing a page that was already cut would silently shorten results.
    const attributeClause = quickKeys
      .map(() => `p.attribute_values->>? ILIKE ?`)
      .join(' or ');
    const attributeBindings = quickKeys.flatMap((key) => [key, like]);

    const rows = await em.execute<
      Array<{
        id: string;
        sku: string;
        slug: string;
        name: Record<string, string>;
        status: string;
        attribute_values: Record<string, unknown>;
      }>
    >(
      `select p.id::text as id, p.sku, p.slug, p.name, p.status, p.attribute_values
         from products p
         join sales_channel_products scp on scp.product_id = p.id
        where scp.sales_channel_id = ?
          and p.status = 'active'
          and p.deleted_at is null
          and (
            p.sku ILIKE ?
            or p.slug ILIKE ?
            or p.name::text ILIKE ?
            ${attributeClause === '' ? '' : `or ${attributeClause}`}
          )
        order by p.sku asc
        limit ?`,
      [params.salesChannelId, like, like, like, ...attributeBindings, params.limit],
    );

    const lowered = needle.toLowerCase();
    return rows.map((row) => ({
      productId: row.id,
      sku: row.sku,
      slug: row.slug,
      name: row.name,
      status: row.status as CatalogQuickSearchHit['status'],
      matchedOn: matchedOnFor(row, lowered, quickKeys),
    }));
  }
}

/**
 * Which predicate a row satisfied, recomputed in TypeScript rather than
 * returned by the query.
 *
 * The caller used to do this over `CatalogProductRecord`, and it belongs on
 * this side for the same reason the predicate does: `attribute` means "one of
 * *this module's* `quickSearchable` attributes matched", and only this module
 * knows which those are. `slug` deliberately reports nothing — it is a match
 * surface, not a labelled one, and it was not labelled before either.
 */
function matchedOnFor(
  row: { sku: string; name: Record<string, string>; attribute_values: Record<string, unknown> },
  lowered: string,
  quickKeys: readonly string[],
): CatalogQuickSearchField[] {
  const matched: CatalogQuickSearchField[] = [];
  if (row.sku.toLowerCase().includes(lowered)) matched.push('sku');
  if (Object.values(row.name).some((n) => String(n).toLowerCase().includes(lowered))) {
    matched.push('name');
  }
  if (
    quickKeys.some((k) =>
      String(row.attribute_values[k] ?? '')
        .toLowerCase()
        .includes(lowered),
    )
  ) {
    matched.push('attribute');
  }
  return matched;
}
