import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { CatalogQueryService } from '../../../src/modules/catalog/services/catalog-query.service.js';
import { CatalogProductReadService } from '../../../src/modules/catalog/services/catalog-product-read.service.js';
import {
  findAttributeExtensionByKey,
  SEED_PRODUCT_101_ID,
  SEED_PRODUCT_102_ID,
  SEED_PRODUCT_103_ID,
} from '../../helpers/seed-catalog.js';
import type { CartSnapshot, CatalogProductReadPort } from '@b2b/contracts';

/**
 * Feature 012 / T056 — Promotion attribute criterion end-to-end (US8).
 *
 * Exercises the algorithm in
 * `contracts/promotions-attribute-criterion.contract.md` § "Evaluator
 * semantics" against the live PromotionService:
 *   - `equals` matches one product, skips the others
 *   - `in`     matches the product whose value is in the set
 *   - `range`  matches numeric values in [min, max]
 *   - FR-039 — flipping `isPromoRule = false` silently skips the rule on
 *     the next resolution; flipping back resumes matching.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CAT_X = '00000000-0000-4000-8000-000000000010';

function snapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    organizationId: ORG_ID,
    customerGroupId: null,
    currency: 'PLN',
    deliveryTotal: 0,
    promotionCode: null,
    lines: [
      // SEED_PRODUCT_101 carries material=steel
      { productId: SEED_PRODUCT_101_ID, variantId: null, categoryIds: [CAT_X], quantity: 1, unitPrice: { amount: 100, currency: 'PLN' } },
      // SEED_PRODUCT_102 carries material=aluminium
      { productId: SEED_PRODUCT_102_ID, variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 100, currency: 'PLN' } },
      // SEED_PRODUCT_103 carries material=plastic
      { productId: SEED_PRODUCT_103_ID, variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 100, currency: 'PLN' } },
    ],
    ...overrides,
  };
}

describe('PromotionService — attribute criterion resolution (T056)', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;
  /**
   * Feature 075, Phase C — the per-line hydration reads `catalog`'s published
   * product port instead of importing its `Product` entity. Recording what it
   * is asked for is what keeps that from silently reverting to a direct query:
   * the criteria below still resolve if the read comes from anywhere, so the
   * only assertion that can see the boundary is who was asked.
   */
  let productIdsAsked: string[][] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const catalog = new CatalogQueryService(
      h.em,
      undefined,
      undefined,
      h.catalogAttributeRead,
      undefined,
      h.assetRead,
      h.salesChannels.membershipService,
    );
    const products = new CatalogProductReadService(h.em);
    const recordingProducts: CatalogProductReadPort = {
      ...products,
      findByIds: async (ids, options) => {
        productIdsAsked = [...productIdsAsked, [...ids]];
        return products.findByIds(ids, options);
      },
    } as CatalogProductReadPort;
    // Issue #164 — the two catalog ports are the second and third arguments and
    // no longer optional, so this suite's recording pair is passed where every
    // composition passes one.
    svc = new PromotionService(h.em, catalog, recordingProducts);
    // Mark `material` as promo-eligible for the duration of the suite.
    const em = h.em();
    const material = await findAttributeExtensionByKey(em, 'material');
    material!.isPromoRule = true;
    await em.flush();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
    productIdsAsked = [];
  });

  it('applies a 10% discount only to the lines whose attribute value matches the `in` set', async () => {
    await svc.upsert({
      name: '10% off steel',
      kind: 'percentage_off',
      value: 10,
      criteria: [
        { type: 'attribute', attributeKey: 'material', op: 'in', values: ['steel'] },
      ],
    });
    const result = await svc.applyToCart(snapshot());
    // Only PROD_101 (material=steel) qualifies — its line total is 100, so 10% = 10.
    expect(result.discountTotal).toBe(10);
    expect(result.subtotal).toBe(300);
    // The attribute values came from `catalog`'s port, not from a query this
    // module wrote against `products`.
    expect(productIdsAsked).toEqual([
      [SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID, SEED_PRODUCT_103_ID],
    ]);
  });

  it('matches scalar via the `equals` operator', async () => {
    await svc.upsert({
      name: '20% off aluminium',
      kind: 'percentage_off',
      value: 20,
      criteria: [
        { type: 'attribute', attributeKey: 'material', op: 'equals', values: ['aluminium'] },
      ],
    });
    const result = await svc.applyToCart(snapshot());
    // Only PROD_102 (material=aluminium) qualifies — 100 * 20% = 20.
    expect(result.discountTotal).toBe(20);
  });

  it('skips the criterion silently after the operator flips isPromoRule = false (FR-039)', async () => {
    await svc.upsert({
      name: '50% off steel',
      kind: 'percentage_off',
      value: 50,
      criteria: [
        { type: 'attribute', attributeKey: 'material', op: 'in', values: ['steel'] },
      ],
    });
    // Sanity check — works while the flag is true.
    const before = await svc.applyToCart(snapshot());
    expect(before.discountTotal).toBe(50);

    // Flip the flag off — the rule must be skipped on the next eval.
    const em = h.em();
    const material = (await findAttributeExtensionByKey(em, 'material'))!;
    material.isPromoRule = false;
    await em.flush();

    const after = await svc.applyToCart(snapshot());
    expect(after.discountTotal).toBe(0);

    // Restore for the next test.
    material.isPromoRule = true;
    await em.flush();
  });
});
