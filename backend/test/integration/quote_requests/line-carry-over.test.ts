import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedBaseTiersSql } from '../../helpers/price-book-sql.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequestItem } from '../../helpers/package-entities.js';
import { createMinimumPackagingUnit, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';

/**
 * Feature 146, Phase 6 (T035, T036) — a rewrite keeps what nobody changed
 * (FR-034, FR-035, FR-036; research R5; data-model §2; threat model T5).
 *
 * Both rewrites delete and recreate the request's lines, so everything a line
 * carries that the body does not restate — the variant, the line note, the
 * packaging unit, the customer's proposal and the stored reference — survives
 * only because the line is paired with the row it replaces.
 *
 * Pricing: product 101 costs 130.00 below ten pieces and 110.00 from ten on the
 * default list, so a quantity change can move the bracket (spec Assumption).
 */
describe('146 — line data carried across rewrites [integration]', () => {
  let h: BackendServerHandle;
  const customer = { b2b_session: 'stub-customer-session' };
  const admin = { b2b_session: 'stub-admin-session' };
  const VARIANT_V = '00000000-0000-4000-8000-0000001460a1';
  const VARIANT_W = '00000000-0000-4000-8000-0000001460a2';
  // Feature 155 (FR-026) — a buyer's line may only name a unit the product
  // has, so the units these lines name are real catalogue units, per run.
  const RUN = minimumFixtureRun();
  const PALETA = `Paleta ${RUN}`;
  const KARTON = `Karton ${RUN}`;
  const PALETA_10 = `Paleta10 ${RUN}`;

  const setPrices = (below10: string, from10: string) =>
    seedBaseTiersSql(h.em(), SEED_PRODUCT_101_ID, [
      { minQuantity: 1, maxQuantity: 9, amount: below10 },
      { minQuantity: 10, maxQuantity: null, amount: from10 },
    ]);

  const create = async (items: Array<Record<string, unknown>>) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: customer,
      payload: { items },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  };

  const adminModify = async (id: string, version: number, payload: Record<string, unknown>) => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/quote-requests/${id}`,
      cookies: admin,
      headers: { 'if-match': `"${version}"` },
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { version: number } }).data;
  };

  const customerPatch = async (id: string, payload: Record<string, unknown>) => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/quote-requests/${id}`,
      cookies: customer,
      payload,
    });
    expect(res.statusCode, res.body).toBe(200);
  };

  const linesOf = async (quoteRequestId: string) => {
    const em = h.em();
    em.clear();
    return em.find(QuoteRequestItem, { quoteRequestId }, { orderBy: { createdAt: 'asc', id: 'asc' } });
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    // `setupBackendServer` has already emptied the price tables (`price_lists`
    // is a seeded table, truncated with cascade); this file only adds its own
    // base-price tiers, and wipes nothing (`check-shared-table-wipes`).
    await setPrices('130.0000', '110.0000');
    const em = h.em();
    await createMinimumPackagingUnit(em, { productId: SEED_PRODUCT_101_ID, name: PALETA, baseQuantity: 2 });
    await createMinimumPackagingUnit(em, { productId: SEED_PRODUCT_101_ID, name: KARTON, baseQuantity: 6 });
    await createMinimumPackagingUnit(em, { productId: SEED_PRODUCT_101_ID, name: PALETA_10, baseQuantity: 10 });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('admin modify (T035, FR-034)', () => {
    it('changing only the agreed price keeps variant, note, packaging, proposal and reference (US1 #9)', async () => {
      const created = await create([
        {
          productId: SEED_PRODUCT_101_ID,
          variantId: VARIANT_V,
          quantity: 4,
          desiredUnitPrice: 100,
          lineNote: 'note A',
          packagingUnitName: PALETA,
          packagingUnitBaseQuantity: 2,
        },
        { productId: SEED_PRODUCT_101_ID, quantity: 3, desiredUnitPrice: 90 },
      ]);
      const before = await linesOf(created.id);
      const withVariant = before.find((l) => l.variantId === VARIANT_V)!;
      const plain = before.find((l) => l.variantId == null)!;
      expect(plain.referenceUnitPrice).toBe('130.00');

      await adminModify(created.id, created.version, {
        items: [
          { id: withVariant.id, productId: SEED_PRODUCT_101_ID, quantity: 4, agreedUnitPrice: 95 },
          { id: plain.id, productId: SEED_PRODUCT_101_ID, quantity: 3, agreedUnitPrice: 85 },
        ],
      });

      const after = await linesOf(created.id);
      expect(after).toHaveLength(2);
      const keptVariant = after.find((l) => l.agreedUnitPrice === '95.00')!;
      expect(keptVariant.variantId).toBe(VARIANT_V);
      expect(keptVariant.lineNote).toBe('note A');
      expect(keptVariant.packagingUnitName).toBe(PALETA);
      expect(keptVariant.packagingUnitBaseQuantity).toBe(2);
      expect(keptVariant.productName).toBe(withVariant.productName);
      expect(keptVariant.productName.endsWith(`(${PALETA})`)).toBe(true);
      expect(keptVariant.desiredUnitPrice).toBe('100.00');
      expect(keptVariant.referenceUnitPrice ?? null).toBe(withVariant.referenceUnitPrice ?? null);
      expect(keptVariant.referenceCurrency ?? null).toBe(withVariant.referenceCurrency ?? null);

      const keptPlain = after.find((l) => l.agreedUnitPrice === '85.00')!;
      expect(keptPlain.desiredUnitPrice).toBe('90.00');
      expect(keptPlain.referenceUnitPrice).toBe('130.00');
      expect(keptPlain.referenceCurrency).toBe('PLN');
      expect(keptPlain.referenceCapturedAt?.getTime()).toBe(plain.referenceCapturedAt?.getTime());
    });

    it('an absent lineNote keeps the note and lineNote: null clears it', async () => {
      const created = await create([
        { productId: SEED_PRODUCT_101_ID, quantity: 2, lineNote: 'keep me' },
      ]);
      const [line] = await linesOf(created.id);

      const first = await adminModify(created.id, created.version, {
        items: [{ id: line!.id, productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 120 }],
      });
      const [kept] = await linesOf(created.id);
      expect(kept!.lineNote).toBe('keep me');

      await adminModify(created.id, first.version, {
        items: [
          { id: kept!.id, productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 120, lineNote: null },
        ],
      });
      const [cleared] = await linesOf(created.id);
      expect(cleared!.lineNote ?? null).toBeNull();
    });

    it('a line the rep adds carries the rep’s variant and note, no packaging unit and no reference', async () => {
      const created = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      const [line] = await linesOf(created.id);

      await adminModify(created.id, created.version, {
        items: [
          { id: line!.id, productId: SEED_PRODUCT_101_ID, quantity: 2, agreedUnitPrice: 120 },
          {
            productId: SEED_PRODUCT_102_ID,
            variantId: VARIANT_W,
            quantity: 5,
            agreedUnitPrice: 30,
            lineNote: 'added by the rep',
          },
        ],
      });

      const after = await linesOf(created.id);
      const added = after.find((l) => l.productId === SEED_PRODUCT_102_ID)!;
      expect(added.variantId).toBe(VARIANT_W);
      expect(added.lineNote).toBe('added by the rep');
      expect(added.packagingUnitName ?? null).toBeNull();
      expect(added.packagingUnitBaseQuantity ?? null).toBeNull();
      expect(added.referenceUnitPrice ?? null).toBeNull();
      expect(added.referenceCurrency ?? null).toBeNull();
      expect(added.referenceCapturedAt ?? null).toBeNull();
      expect(added.desiredUnitPrice ?? null).toBeNull();
      // The kept line still has its reference.
      expect(after.find((l) => l.productId === SEED_PRODUCT_101_ID)!.referenceUnitPrice).toBe('130.00');
    });
  });

  describe('customer patchDraft (T036, FR-035)', () => {
    it('stores packaging as sent, keeps an unchanged line’s reference and proposal, re-resolves a changed one (US1 #10, T5)', async () => {
      const created = await create([
        { productId: SEED_PRODUCT_101_ID, quantity: 2, desiredUnitPrice: 100 },
        {
          productId: SEED_PRODUCT_101_ID,
          quantity: 12,
          desiredUnitPrice: 90,
          packagingUnitName: KARTON,
          packagingUnitBaseQuantity: 6,
        },
      ]);
      const before = await linesOf(created.id);
      const unchanged = before.find((l) => l.packagingUnitName == null)!;
      const changing = before.find((l) => l.packagingUnitName === KARTON)!;
      expect(unchanged.referenceUnitPrice).toBe('130.00');
      expect(changing.referenceUnitPrice).toBe('110.00');

      // The price moves after submission: only a line whose inputs changed may
      // see the new price.
      await setPrices('140.0000', '115.0000');
      try {
        await customerPatch(created.id, {
          items: [
            // Same product, variant, quantity, packaging; proposal omitted (T5).
            { productId: SEED_PRODUCT_101_ID, quantity: 2 },
            {
              productId: SEED_PRODUCT_101_ID,
              quantity: 18,
              desiredUnitPrice: 88,
              packagingUnitName: KARTON,
              packagingUnitBaseQuantity: 6,
            },
          ],
        });
      } finally {
        await setPrices('130.0000', '110.0000');
      }

      const after = await linesOf(created.id);
      expect(after).toHaveLength(2);
      const kept = after.find((l) => l.packagingUnitName == null)!;
      expect(kept.quantity).toBe(2);
      expect(kept.referenceUnitPrice).toBe('130.00');
      expect(kept.referenceCapturedAt?.getTime()).toBe(unchanged.referenceCapturedAt?.getTime());
      expect(kept.desiredUnitPrice).toBe('100.00');

      const reResolved = after.find((l) => l.packagingUnitName === KARTON)!;
      expect(reResolved.quantity).toBe(18);
      expect(reResolved.packagingUnitBaseQuantity).toBe(6);
      expect(reResolved.productName.endsWith(`(${KARTON})`)).toBe(true);
      expect(reResolved.referenceUnitPrice).toBe('115.00');
      expect(reResolved.referenceCurrency).toBe('PLN');
      expect(reResolved.desiredUnitPrice).toBe('88.00');
    });

    it('a line the customer adds in the edit gets a reference of its own', async () => {
      const created = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 2 }]);
      await customerPatch(created.id, {
        items: [
          { productId: SEED_PRODUCT_101_ID, quantity: 2 },
          { productId: SEED_PRODUCT_101_ID, quantity: 20, packagingUnitName: PALETA_10, packagingUnitBaseQuantity: 10 },
        ],
      });
      const after = await linesOf(created.id);
      const added = after.find((l) => l.packagingUnitName === PALETA_10)!;
      expect(added.referenceUnitPrice).toBe('110.00');
      expect(added.desiredUnitPrice ?? null).toBeNull();
    });
  });

  describe('customer draft edit keeps the grouping (feature 159, T027, R-13)', () => {
    it('a paired line keeps its group and the body’s order within it; a new line is ungrouped; no group changes', async () => {
      const created = await create([
        { productId: SEED_PRODUCT_101_ID, quantity: 1 },
        { productId: SEED_PRODUCT_102_ID, quantity: 1 },
      ]);
      // No representative's save can have happened on a draft the customer may
      // still edit, so the group is laid in directly: defence in depth.
      const conn = h.em().getConnection();
      const groupId = '00000000-0000-4000-8000-000000159c01';
      await conn.execute(
        `insert into "quote_request_item_groups" ("id", "quote_request_id", "name", "position", "created_at", "updated_at")
         values (?, ?, 'Hall', 0, now(), now())`,
        [groupId, created.id],
      );
      await conn.execute(`update "quote_request_items" set "group_id" = ? where "quote_request_id" = ?`, [groupId, created.id]);

      await customerPatch(created.id, {
        items: [
          { productId: SEED_PRODUCT_103_ID, quantity: 1 },
          { productId: SEED_PRODUCT_102_ID, quantity: 1 },
          { productId: SEED_PRODUCT_101_ID, quantity: 1 },
        ],
      });
      const after = await linesOf(created.id);
      const of = (productId: string) => after.find((l) => l.productId === productId)!;
      expect([of(SEED_PRODUCT_102_ID).groupId, of(SEED_PRODUCT_102_ID).position]).toEqual([groupId, 0]);
      expect([of(SEED_PRODUCT_101_ID).groupId, of(SEED_PRODUCT_101_ID).position]).toEqual([groupId, 1]);
      expect([of(SEED_PRODUCT_103_ID).groupId ?? null, of(SEED_PRODUCT_103_ID).position]).toEqual([null, 0]);
      const groups = await conn.execute<Array<{ id: string; name: string; position: number }>>(
        `select "id", "name", "position" from "quote_request_item_groups" where "quote_request_id" = ?`,
        [created.id],
      );
      expect(groups).toEqual([{ id: groupId, name: 'Hall', position: 0 }]);
    });

    it('a customer body carrying groups is refused (400) and a groupKey on a line is ignored (FR-025)', async () => {
      const created = await create([{ productId: SEED_PRODUCT_101_ID, quantity: 1 }]);
      const refused = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/quote-requests/${created.id}`,
        cookies: customer,
        payload: { groups: [{ key: 'g', name: 'Mine' }], items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1, groupKey: 'g' }] },
      });
      expect(refused.statusCode, refused.body).toBe(400);
      await customerPatch(created.id, { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 2, groupKey: 'g' }] });
      const after = await linesOf(created.id);
      expect(after.map((l) => l.groupId ?? null)).toEqual([null]);
    });
  });
});
