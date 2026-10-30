import type { EntityManager } from '@mikro-orm/postgresql';
import {
  resolveScopeLanguage,
  type CatalogAttributeReadPort,
  type CatalogQuickSearchField,
  type CatalogQuickSearchHit,
  type CatalogQuickSearchParams,
  type CatalogQuickSearchPort,
} from '@endora-commerce/contracts';
import type {
  SalesChannelMembershipPort,
  SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';

import { availabilityCondition } from './product-availability.sql.js';
import { effectiveTextSql } from './effective-value.sql.js';
import { toScopeChannel } from './product-availability.service.js';
import { loadEffectiveKeys } from './url-key-resolution.service.js';

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
 * ## Why `visibility` and `allowed_organization_ids` are filtered here
 *
 * The first pass at this port left both columns unfiltered, on the ground that
 * no read path in this module enforces either and that enforcing them in one
 * port would give the platform two answers to "can this buyer see this
 * product". The gap is real and is still platform-wide, but it does not make
 * this the surface to leave open: the endpoint requires a signed-in buyer,
 * discloses SKU, slug and name for every hit, and returns an id that
 * `POST /quick-order/build` accepts, so a restriction the operator set on the
 * product was bypassed by typing three characters into the type-ahead.
 *
 * The reading is the restrictive one, spelled out on
 * {@link CatalogQuickSearchPort}: the buyer's organisation on the allow-list,
 * or an empty allow-list on a row that is not `organization_restricted`. The
 * two rows a looser reading would disclose are a non-empty allow-list under a
 * `public` visibility, and `organization_restricted` with an empty allow-list.
 *
 * `deleted_at is null` is applied for a plainer reason: every other
 * customer-facing read in this module applies it, and the knex query not doing
 * so returned soft-deleted products whose `status` was still `active`.
 *
 * ## The other SQL statement of the same rule, and why it looks different
 *
 * `isProductVisibleTo` in `@endora-commerce/contracts` is the platform's one answer, and
 * this module restates it in SQL **twice** because a predicate over a record
 * cannot be pushed into a query. The other restatement is
 * `ANONYMOUS_AUDIENCE_CLAUSE` in `catalog-product-filter.service.ts`, and it is
 * deliberately not this clause (issue #262):
 *
 *  - **this one answers for a signed-in buyer.** `organizationId` is required
 *    on {@link CatalogQuickSearchParams} and has no anonymous spelling, so the
 *    audience is `{ organizationId, authenticated: true }` and `logged_in_only`
 *    is always satisfied here. That is why the `@>` containment branch exists
 *    at all;
 *  - **the filter floor answers for `ANONYMOUS_PRODUCT_AUDIENCE`**, because its
 *    only consumer is a product feed read by Google. With no organisation to
 *    contain, containment can never match, and the predicate collapses to
 *    `visibility = 'public'` with an empty allow-list.
 *
 * So the two are meant to differ, and neither may be "aligned" with the other:
 * copying the two equalities here would hide from a buyer every row his own
 * organisation is named on. What stops either from drifting away from the
 * predicate is a parity test per site that derives its expectation from
 * `isProductVisibleTo` — this one's is
 * `backend/test/integration/catalog/quick-search-audience-parity.test.ts`,
 * which sweeps `productVisibilitySchema.options` × five allow-list states ×
 * three viewers, so a fourth visibility value or a substring reading of the
 * allow-list turns it red.
 */
export class CatalogQuickSearchService implements CatalogQuickSearchPort {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly attributeRead: CatalogAttributeReadPort,
    /**
     * Feature 163 — the kernel's membership accessor (Constitution XII) and
     * the channel record whose languages the scope language L is resolved
     * against. Availability is `availabilityCondition`, the same condition
     * the listing is cut by.
     */
    private readonly membership: Pick<SalesChannelMembershipPort, 'entityIdsInChannelSubquery'>,
    private readonly channels: Pick<SalesChannelResolutionPort, 'getById'>,
  ) {}

  async quickSearch(params: CatalogQuickSearchParams): Promise<CatalogQuickSearchHit[]> {
    const needle = params.q.trim();
    if (needle === '' || params.limit <= 0) return [];

    // The `quickSearchable` flag is this module's, and so is the JSONB the
    // values live in — which is the whole reason the predicate belongs here.
    // FR-007 — an id no channel has matches nothing.
    const record = await this.channels.getById(params.salesChannelId);
    if (!record) return [];
    const channel = toScopeChannel(record);

    const quickKeys = (await this.attributeRead.listByFlag('quickSearchable')).map((a) => a.key);

    const em = this.emFactory();
    const like = `%${needle}%`;

    // One statement, scoped by the kernel's membership subquery, so the scope cannot be
    // forgotten by a later caller and the limit is applied *after* scoping —
    // narrowing a page that was already cut would silently shorten results.
    const attributeClause = quickKeys
      .map(() => `p.attribute_values->>? ILIKE ?`)
      .join(' or ');
    const attributeBindings = quickKeys.flatMap((key) => [key, like]);

    // Feature 163 — membership (the kernel's subquery), effective status at
    // (C, L), the window and the effective audience in one condition. The
    // audience is the signed-in buyer's (see the file header):
    // `{ organizationId, authenticated: true }`.
    const languageCode = resolveScopeLanguage(channel, params.languageCode);
    // FR-017 a — the Name the storefront shows at (C, L), matched and returned.
    const effectiveName = effectiveTextSql('name', { channelId: channel.id, languageCode });
    const available = availabilityCondition(
      {
        channelId: channel.id,
        languageCode,
        channelLanguages: channel.languages,
        audience: { organizationId: params.organizationId, authenticated: true },
        now: new Date(),
      },
      this.membership,
    );

    const rows = await em.execute<
      Array<{
        id: string;
        sku: string;
        slug: string;
        name: string;
        effective_name: string;
        status: string;
        attribute_values: Record<string, unknown>;
      }>
    >(
      `select p.id::text as id, p.sku, p.slug, p.name, ${effectiveName.sql('p')} as effective_name,
              p.status, p.attribute_values
         from products p
        where ${available.sql('p')}
          and (
            p.sku ILIKE ?
            or p.slug ILIKE ?
            or p.name::text ILIKE ?
            or ${effectiveName.sql('p')} ILIKE ?
            ${attributeClause === '' ? '' : `or ${attributeClause}`}
          )
        order by p.sku asc
        limit ?`,
      [
        ...effectiveName.params,
        ...available.params,
        like,
        like,
        like,
        ...effectiveName.params,
        like,
        ...attributeBindings,
        params.limit,
      ],
    );

    // Feature 163 (T113a, R28) — a hit links to its effective URL key at (C, L),
    // the key the product page resolves there; the global key where it has none.
    const keys = await loadEffectiveKeys(em, rows, { id: channel.id, languages: [languageCode] });
    const lowered = needle.toLowerCase();
    return rows.map((row) => ({
      productId: row.id,
      sku: row.sku,
      slug: keys.get(row.id)?.get(languageCode) ?? row.slug,
      // Feature 168 — the name effective at (C, L) (`contracts/readers.md` §2).
      name: row.effective_name,
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
  row: {
    sku: string;
    name: string;
    effective_name: string;
    attribute_values: Record<string, unknown>;
  },
  lowered: string,
  quickKeys: readonly string[],
): CatalogQuickSearchField[] {
  const matched: CatalogQuickSearchField[] = [];
  if (row.sku.toLowerCase().includes(lowered)) matched.push('sku');
  if (
    row.effective_name.toLowerCase().includes(lowered) ||
    row.name.toLowerCase().includes(lowered)
  ) {
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
