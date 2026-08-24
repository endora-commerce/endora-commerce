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
});
