import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import { Promotion } from '../../../src/modules/promotions/entities/promotion.entity.js';
import type { CartSnapshot } from '@b2b/contracts';

/**
 * T132 — PromotionService:
 *   - automatic percentage_off / amount_off / free_delivery apply
 *   - coupon code gates application
 *   - minCartSubtotal filter
 *   - org / customer-group scope
 *   - product / category line scope
 *   - validity window
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const PROD_A = '00000000-0000-4000-8000-000000000001';
const PROD_B = '00000000-0000-4000-8000-000000000002';
const CAT_X = '00000000-0000-4000-8000-000000000010';

function snapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    organizationId: ORG_ID,
    customerGroupId: null,
    currency: 'PLN',
    deliveryTotal: 20,
    promotionCode: null,
    lines: [
      { productId: PROD_A, variantId: null, categoryIds: [CAT_X], quantity: 2, unitPrice: { amount: 50, currency: 'PLN' } },
      { productId: PROD_B, variantId: null, categoryIds: [], quantity: 1, unitPrice: { amount: 30, currency: 'PLN' } },
    ],
    ...overrides,
  };
}

describe('PromotionService.applyToCart', () => {
  let h: BackendServerHandle;
  let svc: PromotionService;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = promotionServiceFor(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h.em().getConnection().execute('truncate table promotions cascade');
  });

  it('returns subtotal + delivery and no discount when no promotions exist', async () => {
    const result = await svc.applyToCart(snapshot());
    expect(result.subtotal).toBe(130); // 2*50 + 1*30
    expect(result.discountTotal).toBe(0);
    expect(result.deliveryTotal).toBe(20);
    expect(result.total).toBe(150);
    expect(result.appliedPromotions).toEqual([]);
  });

  it('applies an automatic percentage_off across the whole cart', async () => {
    await svc.upsert({ name: '10% off', kind: 'percentage_off', value: 10 });
    const result = await svc.applyToCart(snapshot());
    expect(result.discountTotal).toBe(13);
    expect(result.total).toBe(137);
  });

  it('caps amount_off at the relevant line total', async () => {
    await svc.upsert({ name: '500 PLN off', kind: 'amount_off', value: 500, currency: 'PLN' });
    const result = await svc.applyToCart(snapshot());
    // amount_off applies to lines (no scope = entire cart subtotal = 130);
    // capped at 130 so subtotal goes to 0 + delivery 20 = 20.
    expect(result.discountTotal).toBe(130);
    expect(result.total).toBe(20);
  });

  it('free_delivery zeroes the delivery cost', async () => {
    await svc.upsert({ name: 'Free delivery', kind: 'free_delivery', value: 0 });
    const result = await svc.applyToCart(snapshot());
    expect(result.deliveryTotal).toBe(0);
    expect(result.discountTotal).toBe(20);
    expect(result.total).toBe(130);
  });

  it('only applies a coupon-coded promotion when the code is presented', async () => {
    await svc.upsert({ name: 'WELCOME25', code: 'WELCOME25', kind: 'percentage_off', value: 25 });
    const noCode = await svc.applyToCart(snapshot());
    expect(noCode.discountTotal).toBe(0);
    const withCode = await svc.applyToCart(snapshot({ promotionCode: 'WELCOME25' }));
    expect(withCode.discountTotal).toBe(round2(130 * 0.25));
  });

  it('honours minCartSubtotal', async () => {
    await svc.upsert({ name: 'Big basket only', kind: 'percentage_off', value: 5, minCartSubtotal: 200 });
    expect((await svc.applyToCart(snapshot())).discountTotal).toBe(0);
    const big = await svc.applyToCart(
      snapshot({
        lines: [
          { productId: PROD_A, variantId: null, categoryIds: [CAT_X], quantity: 5, unitPrice: { amount: 50, currency: 'PLN' } },
        ],
      }),
    );
    expect(big.discountTotal).toBe(round2(250 * 0.05));
  });

  it('scopes percentage_off to a single category', async () => {
    await svc.upsert({
      name: 'CAT_X 50%',
      kind: 'percentage_off',
      value: 50,
      categoryId: CAT_X,
    });
    const result = await svc.applyToCart(snapshot());
    // Category X line total is 100; 50% off = 50 discount.
    expect(result.discountTotal).toBe(50);
    expect(result.total).toBe(80 + 20); // 130-50 + 20 delivery
  });

  it('skips org-scoped promotions for the wrong organization', async () => {
    await svc.upsert({
      name: 'Other org only',
      kind: 'percentage_off',
      value: 10,
      organizationId: '00000000-0000-4000-8000-0000000000ff',
    });
    const result = await svc.applyToCart(snapshot());
    expect(result.discountTotal).toBe(0);
  });

  it('drops expired promotions', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await svc.upsert({
      name: 'Expired',
      kind: 'percentage_off',
      value: 50,
      validUntil: yesterday,
    });
    const result = await svc.applyToCart(snapshot());
    expect(result.discountTotal).toBe(0);
  });

  it('skips inactive promotions without deleting them', async () => {
    const promo = await svc.upsert({
      name: 'Paused',
      kind: 'percentage_off',
      value: 25,
      isActive: false,
    });
    const result = await svc.applyToCart(snapshot());
    expect(result.discountTotal).toBe(0);
    const stored = await h.em().findOneOrFail(Promotion, { id: promo.id });
    expect(stored.isActive).toBe(false);
  });

  /**
   * Issue #164 — the write validation an optional port used to switch off.
   *
   * `catalogPort` was optional, so `validateCriteria` opened with "no port, no
   * semantic validation" and returned. Every service in this file was built
   * that way, which is precisely the shape the issue names: an optional
   * dependency production always supplies leaves its absent branch untested by
   * construction, and here that branch **accepted a promotion naming an
   * attribute that does not exist** — saved, then silently matching nothing
   * forever. The port is required now, so there is one behaviour to test and
   * this is it.
   */
  it('refuses an attribute criterion naming an attribute that does not exist', async () => {
    await expect(
      svc.upsert({
        name: 'Ten percent off nothing at all',
        kind: 'percentage_off',
        value: 10,
        criteria: [
          {
            type: 'attribute',
            attributeKey: 'no_such_attribute',
            op: 'equals',
            values: ['whatever'],
          },
        ],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await h.em().count(Promotion, { name: 'Ten percent off nothing at all' })).toBe(0);
  });
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
