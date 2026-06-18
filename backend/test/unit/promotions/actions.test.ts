import { describe, expect, it } from 'vitest';
import type { CartLine } from '@b2b/contracts';
import { createPromotionActionRegistry } from '../../../src/modules/promotions/services/promotion-action-registry.js';
import type { CartApplyContext } from '../../../src/modules/promotions/actions/types.js';

const registry = createPromotionActionRegistry();

function line(productId: string, unit: number, qty: number): CartLine {
  return {
    productId,
    variantId: null,
    categoryIds: [],
    quantity: qty,
    unitPrice: { amount: unit, currency: 'PLN' },
  };
}

function ctx(lines: CartLine[], deliveryTotal = 20): CartApplyContext {
  const subtotal = lines.reduce((a, l) => a + l.unitPrice.amount * l.quantity, 0);
  return { lines, subtotal, deliveryTotal, currency: 'PLN' };
}

describe('promotion action registry', () => {
  it('registers all 10 built-in actions', () => {
    expect(registry.list()).toHaveLength(10);
    expect(registry.has('percentage_off_cart')).toBe(true);
    expect(registry.get('does_not_exist')).toBeNull();
  });

  it('throws on an unknown action type', () => {
    expect(() => registry.apply({ type: 'nope' } as never, ctx([line('p', 10, 1)]))).toThrow();
  });
});

describe('free_delivery', () => {
  it('zeros delivery', () => {
    const r = registry.apply({ type: 'free_delivery' }, ctx([line('p', 100, 1)], 25));
    expect(r).toEqual({ discountSubtotalDelta: 0, discountDeliveryDelta: 25 });
  });
});

describe('percentage_off_cart', () => {
  it('takes a percentage of subtotal', () => {
    const r = registry.apply({ type: 'percentage_off_cart', percent: 10 }, ctx([line('p', 500, 1)]));
    expect(r.discountSubtotalDelta).toBe(50);
  });
});

describe('amount_off_cart', () => {
  it('caps at subtotal and respects currency', () => {
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 30, currency: 'PLN' }, ctx([line('p', 100, 1)]))
        .discountSubtotalDelta,
    ).toBe(30);
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 999, currency: 'PLN' }, ctx([line('p', 100, 1)]))
        .discountSubtotalDelta,
    ).toBe(100);
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 30, currency: 'EUR' }, ctx([line('p', 100, 1)]))
        .discountSubtotalDelta,
    ).toBe(0);
  });
});

describe('buy_x_get_y_free', () => {
  it('frees the cheapest units when target=cheapest', () => {
    // 3 units priced 10, 20, 30; buy 2 get 1 free → 1 group → free cheapest (10).
    const lines = [line('a', 30, 1), line('b', 20, 1), line('c', 10, 1)];
    const r = registry.apply(
      { type: 'buy_x_get_y_free', buyQuantity: 2, freeQuantity: 1, target: 'cheapest' },
      ctx(lines),
    );
    expect(r.discountSubtotalDelta).toBe(10);
  });

  it('frees the most expensive units when target=most_expensive', () => {
    const lines = [line('a', 30, 1), line('b', 20, 1), line('c', 10, 1)];
    const r = registry.apply(
      { type: 'buy_x_get_y_free', buyQuantity: 2, freeQuantity: 1, target: 'most_expensive' },
      ctx(lines),
    );
    expect(r.discountSubtotalDelta).toBe(30);
  });
});

describe('spend_x_percent_off / spend_x_amount_off', () => {
  it('scales with spend steps and caps percent at 100', () => {
    const r = registry.apply(
      { type: 'spend_x_percent_off', spendStep: 100, percent: 5, currency: 'PLN' },
      ctx([line('p', 250, 1)]),
    );
    // floor(250/100)=2 steps → 10% of 250 = 25
    expect(r.discountSubtotalDelta).toBe(25);
  });

  it('gives a fixed amount per step', () => {
    const r = registry.apply(
      { type: 'spend_x_amount_off', spendStep: 100, amount: 7, currency: 'PLN' },
      ctx([line('p', 250, 1)]),
    );
    expect(r.discountSubtotalDelta).toBe(14);
  });
});

describe('every_nth_product_percent_off', () => {
  it('discounts every nth (cheapest) unit', () => {
    // 4 units 10,10,10,10; nth=2 → 2 discounted units at 50% → 5+5=10
    const r = registry.apply(
      { type: 'every_nth_product_percent_off', nth: 2, percent: 50 },
      ctx([line('p', 10, 4)]),
    );
    expect(r.discountSubtotalDelta).toBe(10);
  });
});

describe('buy_x_units_* (product-scoped)', () => {
  it('frees product units (buy_x_units_y_free)', () => {
    // 3 units of product p at 10; buy 2 get 1 free → free 1 → 10
    const r = registry.apply(
      { type: 'buy_x_units_y_free', productId: 'p', buyUnits: 2, freeUnits: 1 },
      ctx([line('p', 10, 3), line('q', 100, 1)]),
    );
    expect(r.discountSubtotalDelta).toBe(10);
  });

  it('gives percent off the whole cart when threshold met', () => {
    const r = registry.apply(
      { type: 'buy_x_units_percent_off', productId: 'p', buyUnits: 3, percent: 10 },
      ctx([line('p', 10, 3)]),
    );
    expect(r.discountSubtotalDelta).toBe(3);
    const none = registry.apply(
      { type: 'buy_x_units_percent_off', productId: 'p', buyUnits: 5, percent: 10 },
      ctx([line('p', 10, 3)]),
    );
    expect(none.discountSubtotalDelta).toBe(0);
  });

  it('gives amount off when threshold met and currency matches', () => {
    const r = registry.apply(
      { type: 'buy_x_units_amount_off', productId: 'p', buyUnits: 2, amount: 15, currency: 'PLN' },
      ctx([line('p', 10, 3)]),
    );
    expect(r.discountSubtotalDelta).toBe(15);
  });
});
