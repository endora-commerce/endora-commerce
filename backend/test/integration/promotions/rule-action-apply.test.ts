import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import type { PromotionService } from '../../../../packages/modules/promotions/src/backend/services/promotion-service.js';
import { promotionServiceFor } from '../../helpers/promotion-service.js';
import type { CartSnapshot } from '@endora-commerce/contracts';

/**
 * Feature 045 / US1 + US2 — action-based promotions driven by the typed rule
 * builder, plus priority ordering and stop-further stacking.
 */

const PROD_A = '00000000-0000-4000-8000-000000000001';
const CAT_X = '00000000-0000-4000-8000-000000000010';

function snapshot(overrides: Partial<CartSnapshot> = {}): CartSnapshot {
  return {
    organizationId: null,
    customerGroupId: null,
    currency: 'PLN',
    deliveryTotal: 20,
    promotionCode: null,
    lines: [
      { productId: PROD_A, variantId: null, categoryIds: [CAT_X], quantity: 2, unitPrice: { amount: 300, currency: 'PLN' } },
    ],
    ...overrides,
  };
}

describe('PromotionService — action + rule engine (feature 045)', () => {
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

  it('applies a percentage_off_cart action when the rule matches (cartTotal >= 500)', async () => {
    await svc.upsert({
      name: '10% over 500',
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: {
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [500],
      },
    });
    const result = await svc.applyToCart(snapshot()); // subtotal 600
    expect(result.discountTotal).toBe(60);
    expect(result.appliedPromotions).toHaveLength(1);
    expect(result.appliedPromotions[0]).toMatchObject({ actionType: 'percentage_off_cart', kind: null, amount: 60 });
  });

  it('does not apply when the rule does not match', async () => {
    await svc.upsert({
      name: '10% over 5000',
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: {
        kind: 'condition',
        field: { kind: 'builtin', key: 'cartTotal' },
        op: 'gte',
        values: [5000],
      },
    });
    const result = await svc.applyToCart(snapshot());
    expect(result.discountTotal).toBe(0);
    expect(result.appliedPromotions).toEqual([]);
  });

  it('applies free_delivery action', async () => {
    await svc.upsert({
      name: 'free shipping',
      action: { type: 'free_delivery' },
      rule: { kind: 'all' },
    });
    const result = await svc.applyToCart(snapshot());
    expect(result.deliveryTotal).toBe(0);
    expect(result.discountTotal).toBe(20);
  });

  it('honours priority and stop-further stacking', async () => {
    await svc.upsert({
      name: 'high prio exclusive',
      priority: 20,
      stopFurther: true,
      action: { type: 'amount_off_cart', amount: 50, currency: 'PLN' },
      rule: { kind: 'all' },
    });
    await svc.upsert({
      name: 'low prio',
      priority: 10,
      action: { type: 'percentage_off_cart', percent: 50 },
      rule: { kind: 'all' },
    });
    const result = await svc.applyToCart(snapshot()); // subtotal 600
    // Only the higher-priority stop-further promotion applies.
    expect(result.appliedPromotions).toHaveLength(1);
    expect(result.discountTotal).toBe(50);
  });

  it('stacks multiple promotions in priority order when stop-further is off', async () => {
    await svc.upsert({
      name: 'first',
      priority: 20,
      action: { type: 'amount_off_cart', amount: 100, currency: 'PLN' },
      rule: { kind: 'all' },
    });
    await svc.upsert({
      name: 'second',
      priority: 10,
      action: { type: 'percentage_off_cart', percent: 10 },
      rule: { kind: 'all' },
    });
    const result = await svc.applyToCart(snapshot()); // subtotal 600
    // 100 off → working 500; then 10% of 500 = 50 → total discount 150.
    expect(result.appliedPromotions).toHaveLength(2);
    expect(result.discountTotal).toBe(150);
  });
  /**
   * Issue #1350 (owner ruling 2026-11-16) — percent-off and free-unit actions
   * compute on the gross the buyer pays; fixed amounts and thresholds read the
   * net as before. 2 × 300.00 at 23 %: net 600.00, gross 738.00.
   */
  describe('gross-based discounts (#1350)', () => {
    const taxed = (): CartSnapshot =>
      snapshot({
        lines: [
          {
            productId: PROD_A,
            variantId: null,
            categoryIds: [CAT_X],
            quantity: 2,
            unitPrice: { amount: 300, currency: 'PLN' },
            taxRate: 0.23,
          },
        ],
      });

    it('takes 10 % of the gross, and answers the gross the buyer pays as the total', async () => {
      await svc.upsert({ name: '10%', action: { type: 'percentage_off_cart', percent: 10 }, rule: { kind: 'all' } });
      const result = await svc.applyToCart(taxed());
      expect(result.subtotal).toBe(600);
      expect(result.discountTotal).toBe(73.8);
      expect(result.appliedPromotions[0]).toMatchObject({ amount: 73.8 });
      // 738.00 − 73.80 + 20.00 delivery.
      expect(result.total).toBe(684.2);
    });

    it('takes 100 % of the gross, not only of the net', async () => {
      await svc.upsert({ name: 'all', action: { type: 'percentage_off_cart', percent: 100 }, rule: { kind: 'all' } });
      const result = await svc.applyToCart(taxed());
      expect(result.discountTotal).toBe(738);
      expect(result.total).toBe(20);
    });

    it('frees a unit VAT included', async () => {
      await svc.upsert({
        name: 'b1g1',
        action: { type: 'buy_x_get_y_free', buyQuantity: 1, freeQuantity: 1, target: 'cheapest' },
        rule: { kind: 'all' },
      });
      const result = await svc.applyToCart(taxed());
      expect(result.discountTotal).toBe(369);
    });

    it('stacks on the gross left after the earlier promotion; fixed amounts are unchanged', async () => {
      await svc.upsert({
        name: 'first',
        priority: 20,
        action: { type: 'amount_off_cart', amount: 100, currency: 'PLN' },
        rule: { kind: 'all' },
      });
      await svc.upsert({ name: 'second', priority: 10, action: { type: 'percentage_off_cart', percent: 10 }, rule: { kind: 'all' } });
      const result = await svc.applyToCart(taxed());
      // 100.00 off → 638.00 gross left; 10 % of it is 63.80.
      expect(result.appliedPromotions.map((a) => a.amount)).toEqual([100, 63.8]);
      expect(result.discountTotal).toBe(163.8);
    });

  });

  /**
   * Issue #1396 (owner ruling 2026-11-17) — a cart-total threshold, a minimum
   * spend and a "spend X" step compare the gross the buyer pays, and a fixed
   * amount is capped at the gross. 2 × 300.00 at 23 %: net 600.00, gross 738.00.
   */
  describe('gross thresholds and fixed-amount caps (#1396)', () => {
    const taxed = (): CartSnapshot =>
      snapshot({
        lines: [
          {
            productId: PROD_A,
            variantId: null,
            categoryIds: [CAT_X],
            quantity: 2,
            unitPrice: { amount: 300, currency: 'PLN' },
            taxRate: 0.23,
          },
        ],
      });

    it('compares a cart-total threshold with the gross', async () => {
      await svc.upsert({
        name: '10% over 700',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [700] },
      });
      // The net 600.00 would miss 700; the gross 738.00 meets it.
      const result = await svc.applyToCart(taxed());
      expect(result.discountTotal).toBe(73.8);
    });

    it('refuses a cart-total threshold above the gross', async () => {
      await svc.upsert({
        name: '10% over 740',
        action: { type: 'percentage_off_cart', percent: 10 },
        rule: { kind: 'condition', field: { kind: 'builtin', key: 'cartTotal' }, op: 'gte', values: [740] },
      });
      expect((await svc.applyToCart(taxed())).discountTotal).toBe(0);
    });

    it('compares minCartSubtotal with the gross', async () => {
      await svc.upsert({
        name: '50 off over 700',
        minCartSubtotal: 700,
        action: { type: 'amount_off_cart', amount: 50, currency: 'PLN' },
        rule: { kind: 'all' },
      });
      expect((await svc.applyToCart(taxed())).discountTotal).toBe(50);
    });

    it('caps a fixed amount at the gross: the goods are free, VAT included', async () => {
      await svc.upsert({
        name: '1000 off',
        action: { type: 'amount_off_cart', amount: 1000, currency: 'PLN' },
        rule: { kind: 'all' },
      });
      const result = await svc.applyToCart(taxed());
      expect(result.discountTotal).toBe(738);
      // Only the delivery is left to pay.
      expect(result.total).toBe(20);
    });

    it('counts "spend X" steps on the gross', async () => {
      await svc.upsert({
        name: '25 per 350',
        action: { type: 'spend_x_amount_off', spendStep: 350, amount: 25, currency: 'PLN' },
        rule: { kind: 'all' },
      });
      // The net 600.00 is one step of 350; the gross 738.00 is two.
      expect((await svc.applyToCart(taxed())).discountTotal).toBe(50);
    });
  });
});
