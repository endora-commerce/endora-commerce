import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  isProductVisibleTo,
  productVisibilitySchema,
  type CatalogAttributeReadPort,
  type ProductAudience,
  type ProductVisibility,
} from '@endora-commerce/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { CatalogQuickSearchService } from '../../../../packages/modules/catalog/src/backend/services/catalog-quick-search.service.js';
import { Product } from '../../helpers/package-entities.js';

/**
 * Issue #262 — the parity `catalogQuickSearchPort` had no test for.
 *
 * Product visibility is expressed in three places and two of them have to be
 * SQL: {@link isProductVisibleTo} in `@endora-commerce/contracts`, this port's `@>`
 * containment clause, and `catalog-product-filter.service.ts`'s
 * `sellableFloor`. The owner's ruling is to keep the three and pin the
 * differences, so what makes the duplication safe is a test per SQL site that
 * **derives** its expectation from the predicate instead of writing one out.
 * `product-filter-port.test.ts` is that test for the filter floor; this file is
 * its counterpart for quick-search, and neither SQL site can drift from the
 * predicate without one of them going red.
 *
 * ## Why this is not a copy of the filter port's sweep
 *
 * The filter floor answers for `ANONYMOUS_PRODUCT_AUDIENCE`, where the
 * containment branch can never match — there is no organisation to contain — so
 * its SQL collapses to two equalities and its sweep is
 * `visibility × (empty, non-empty)`. This port answers for a **signed-in
 * buyer**, which is where `@>` does the work, so the allow-list axis has to
 * distinguish four states that the anonymous sweep cannot reach:
 *
 *   - empty;
 *   - naming the viewer's own organisation;
 *   - naming a different organisation;
 *   - naming several, the viewer's among them — membership, not equality with
 *     a one-element array.
 *
 * and it is swept for three viewers, so every non-empty state is read once as
 * "mine" and once as "somebody else's" from the same seeded rows.
 *
 * ## The audience this port answers for
 *
 * `{ organizationId: params.organizationId, authenticated: true }`.
 * `CatalogQuickSearchParams.organizationId` is required and has no anonymous
 * spelling — a surface with no signed-in buyer must not call this port — so
 * `authenticated` is `true` by construction here, which is what makes
 * `logged_in_only` visible in every row of the sweep below.
 */

const SET_ID = 'defa0017-0000-4000-8000-000000000000';
const NEEDLE = 'QSPARITY';

const ORG_A = '44444444-4444-4444-8444-444444444444';
const ORG_B = '55555555-5555-4555-8555-555555555555';
/** A third viewer, on nobody's allow-list, so "several, none of them mine" is swept too. */
const ORG_C = '66666666-6666-4666-8666-666666666666';

/**
 * Not a uuid, and deliberately so: it is `ORG_A` with a suffix, which a
 * substring or `LIKE` reading of the serialised allow-list would match and
 * `@>` containment must not. The column is JSONB, so this is a value an
 * import or a bad write can genuinely put there.
 */
const ORG_A_SUFFIXED = `${ORG_A}-decoy`;

const ALLOW_LIST_STATES: ReadonlyArray<{ label: string; ids: string[] }> = [
  { label: 'empty', ids: [] },
  { label: 'org-a', ids: [ORG_A] },
  { label: 'org-b', ids: [ORG_B] },
  { label: 'org-b-then-org-a', ids: [ORG_B, ORG_A] },
  { label: 'org-a-suffixed', ids: [ORG_A_SUFFIXED] },
];

const VIEWERS: ReadonlyArray<{ label: string; organizationId: string }> = [
  { label: 'ORG_A', organizationId: ORG_A },
  { label: 'ORG_B', organizationId: ORG_B },
  { label: 'ORG_C', organizationId: ORG_C },
];

/** One seeded row of the audience matrix, carrying the two columns it is about. */
interface AudienceMatrixRow {
  id: string;
  sku: string;
  visibility: ProductVisibility;
  allowedOrganizationIds: string[];
  allowListLabel: string;
}

describe('catalogQuickSearchPort — the buyer audience, against the shared predicate [integration]', () => {
  let db: TestDb;
  let em: EntityManager;
  let port: CatalogQuickSearchService;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    port = new CatalogQuickSearchService(() => em, attributeReadStub);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  const audienceOf = (organizationId: string): ProductAudience => ({
    organizationId,
    // See the file header: this port has no anonymous caller.
    authenticated: true,
  });

  const search = async (organizationId: string, limit = 100): Promise<string[]> => {
    const hits = await port.quickSearch({
      q: NEEDLE,
      limit,
      salesChannelId: db.systemDefaultChannelId,
      organizationId,
    });
    return hits.map((hit) => hit.productId);
  };

  it('agrees with `isProductVisibleTo` on every visibility × allow-list × viewer state', async () => {
    const seeded = await seedAudienceMatrix(em, db.systemDefaultChannelId);

    for (const viewer of VIEWERS) {
      const returned = new Set(await search(viewer.organizationId));

      for (const row of seeded) {
        const expected = isProductVisibleTo(row, audienceOf(viewer.organizationId));
        expect(
          returned.has(row.id),
          `${row.sku} — visibility ${row.visibility}, allow-list ${row.allowListLabel}, ` +
            `viewer ${viewer.label}`,
        ).toBe(expected);
      }
    }
  });

  it('never returns a row to every viewer or to none of them by accident', async () => {
    // The guard the sweep above cannot give itself: a port that returned
    // nothing at all, or everything, would satisfy a derived expectation only
    // if the predicate agreed — and this asserts that the seeded matrix really
    // does contain both a row the predicate admits and a row it refuses, so a
    // green sweep is a comparison and not two empty sets.
    const seeded = await seedAudienceMatrix(em, db.systemDefaultChannelId);
    const audience = audienceOf(ORG_A);

    expect(seeded.some((row) => isProductVisibleTo(row, audience))).toBe(true);
    expect(seeded.some((row) => !isProductVisibleTo(row, audience))).toBe(true);

    const returned = await search(ORG_A);
    expect(returned.length).toBeGreaterThan(0);
    expect(returned.length).toBeLessThan(seeded.length);
  });

  it('applies the audience inside the statement, so `limit` pages visible rows only', async () => {
    // Why this port filters in SQL at all. `order by p.sku asc` puts the two
    // restricted rows first, so a post-filter over a page of one would answer
    // an empty page for a buyer who has a visible product waiting behind them.
    const hidden = await seedRow(em, db.systemDefaultChannelId, {
      sku: `AAA-${NEEDLE}-HIDDEN`,
      visibility: 'public',
      allowedOrganizationIds: [ORG_B],
    });
    const alsoHidden = await seedRow(em, db.systemDefaultChannelId, {
      sku: `AAB-${NEEDLE}-HIDDEN`,
      visibility: 'organization_restricted',
      allowedOrganizationIds: [],
    });
    const visible = await seedRow(em, db.systemDefaultChannelId, {
      sku: `ZZZ-${NEEDLE}-VISIBLE`,
      visibility: 'public',
      allowedOrganizationIds: [],
    });

    expect(isProductVisibleTo(hidden, audienceOf(ORG_A))).toBe(false);
    expect(isProductVisibleTo(alsoHidden, audienceOf(ORG_A))).toBe(false);
    expect(isProductVisibleTo(visible, audienceOf(ORG_A))).toBe(true);

    expect(await search(ORG_A, 1)).toEqual([visible.id]);
  });
});

/**
 * The attribute half of the port, stubbed to contribute nothing.
 *
 * Which attributes are `quickSearchable` is a different question from which
 * rows a buyer may see, and a real definition here would only widen the needle
 * — the sweep matches on `sku`, which needs no attribute at all.
 */
const attributeReadStub: CatalogAttributeReadPort = {
  listAll: async () => [],
  getByIdOrKey: async () => null,
  listByFlag: async () => [],
  optionLabelIndex: async () => new Map(),
};

/**
 * Every state the two audience columns can be in, seeded as findable rows.
 *
 * The visibility axis is `productVisibilitySchema.options` rather than a
 * hand-listed set, exactly as the filter port's sweep is: a visibility value
 * added to the enum arrives here without anybody remembering to add it, and
 * the parity assertion then forces both the SQL and the predicate to be
 * decided about it rather than letting one of them keep an accidental default
 * — the predicate falls through to `return true`, this SQL fails closed.
 *
 * Every row is `active`, not soft-deleted and bound to the channel being
 * searched, so nothing but the audience clause can be what excludes it.
 */
async function seedAudienceMatrix(
  em: EntityManager,
  salesChannelId: string,
): Promise<AudienceMatrixRow[]> {
  const combinations = productVisibilitySchema.options.flatMap((visibility) =>
    ALLOW_LIST_STATES.map((state) => ({ visibility, state })),
  );

  const rows: AudienceMatrixRow[] = [];
  for (const [index, combination] of combinations.entries()) {
    const row = await seedRow(em, salesChannelId, {
      sku: `${NEEDLE}-${index.toString().padStart(2, '0')}-${combination.visibility.toUpperCase()}`,
      visibility: combination.visibility,
      allowedOrganizationIds: combination.state.ids,
    });
    rows.push({ ...row, allowListLabel: combination.state.label });
  }
  return rows;
}

/** One findable product, bound to the channel the sweep searches. */
async function seedRow(
  em: EntityManager,
  salesChannelId: string,
  fixture: {
    sku: string;
    visibility: ProductVisibility;
    allowedOrganizationIds: string[];
  },
): Promise<Omit<AudienceMatrixRow, 'allowListLabel'>> {
  const product = em.create(Product, {
    type: 'simple' as const,
    description: {},
    attributeSetId: SET_ID,
    attributeValues: {},
    sku: fixture.sku,
    slug: fixture.sku.toLowerCase(),
    status: 'active',
    visibility: fixture.visibility,
    allowedOrganizationIds: fixture.allowedOrganizationIds,
    name: { 'en-US': `Quick-search parity ${fixture.sku}` },
  });
  await em.persistAndFlush(product);

  // `em.execute`, never `em.getConnection().execute`: the second takes its own
  // pooled connection and would survive this test's rollback (issue #200).
  await em.execute(
    `insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`,
    [salesChannelId, product.id],
  );

  return {
    id: product.id,
    sku: product.sku,
    visibility: product.visibility,
    allowedOrganizationIds: [...product.allowedOrganizationIds],
  };
}
