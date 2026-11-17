import { describe, expect, it } from 'vitest';
import type { CartLine } from '@endora-commerce/contracts';
import { createPromotionActionRegistry } from '../services/promotion-action-registry.js';
import type { CartApplyContext } from './types.js';
import { linesGross } from './util.js';

const registry = createPromotionActionRegistry();

function line(productId: string, unit: number, qty: number, taxRate?: number): CartLine {
  return {
    productId,
    variantId: null,
    categoryIds: [],
    quantity: qty,
    unitPrice: { amount: unit, currency: 'PLN' },
    ...(taxRate !== undefined ? { taxRate } : {}),
  };
}

function ctx(lines: CartLine[], deliveryTotal = 20): CartApplyContext {
  const subtotal = lines.reduce((a, l) => a + l.unitPrice.amount * l.quantity, 0);
  return { lines, subtotal, grossSubtotal: linesGross(lines), deliveryTotal, currency: 'PLN' };
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

/**
 * Issue #417 — a discount is computed in exact decimal arithmetic: a
 * percentage half-up on the exact product, and "for every X spent" on the
 * exact quotient. On doubles, 10 % of 1.45 was 0.14 and 0.30 held two 0.10
 * steps.
 */
describe('exact decimal discounts (#417)', () => {
  it('takes 10 % of 1.45 as 0.15, not the binary 0.14', () => {
    const r = registry.apply({ type: 'percentage_off_cart', percent: 10 }, ctx([line('p', 1.45, 1)]));
    expect(r.discountSubtotalDelta).toBe(0.15);
  });

  it('half-ups every percentage action on the exact product', () => {
    expect(
      registry.apply({ type: 'buy_x_units_percent_off', productId: 'p', buyUnits: 1, percent: 10 }, ctx([line('p', 1.45, 1)]))
        .discountSubtotalDelta,
    ).toBe(0.15);
    expect(
      registry.apply({ type: 'every_nth_product_percent_off', nth: 1, percent: 10 }, ctx([line('p', 1.45, 1)]))
        .discountSubtotalDelta,
    ).toBe(0.15);
  });

  it('counts three 0.10 steps in 0.30, not the binary two', () => {
    const lines = [line('p', 0.3, 1)];
    expect(
      registry.apply({ type: 'spend_x_amount_off', spendStep: 0.1, amount: 0.05, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(0.15);
    expect(
      registry.apply({ type: 'spend_x_percent_off', spendStep: 0.1, percent: 10, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(0.09);
  });
});

describe('exact step percentages (#417 review)', () => {
  it('takes 3 × 0.15 % of 10.00 as 0.05, not the binary 0.04', () => {
    // 3 * 0.15 is the double 0.44999999999999996.
    expect(3 * 0.15).toBe(0.44999999999999996);
    const r = registry.apply(
      { type: 'spend_x_percent_off', spendStep: 3, percent: 0.15, currency: 'PLN' },
      ctx([line('p', 10, 1)]),
    );
    expect(r.discountSubtotalDelta).toBe(0.05);
  });
});

/**
 * Issue #1350 (owner ruling 2026-11-16) — percent-off and free-unit actions
 * compute on the gross the buyer pays: "10 % off" is 10 % of what the buyer
 * pays, and a free unit is free VAT included. The gross is VAT per rate on the
 * sum of the nets (`vatByRate`). Fixed amounts and "spend X" thresholds are
 * unchanged: the amounts are what the buyer does not pay, the steps count the
 * net subtotal as before.
 */
describe('gross-based percent-off and free-unit actions (#1350)', () => {
  it('reads the goods gross per rate on the sum of the nets', () => {
    // 2 × 29.50 at 23 %: net 59.00, VAT round(13.57) → 72.57 (two line grosses would be 72.58).
    expect(linesGross([line('p', 29.5, 2, 0.23)])).toBe(72.57);
    // No rate is no VAT.
    expect(linesGross([line('p', 29.5, 2)])).toBe(59);
    // Two rates, each on its own net sum: 100.00 → 123.00, 10.00 at 8 % → 10.80.
    expect(linesGross([line('a', 100, 1, 0.23), line('b', 10, 1, 0.08)])).toBe(133.8);
  });

  it('takes percentage_off_cart of the gross', () => {
    const r = registry.apply({ type: 'percentage_off_cart', percent: 10 }, ctx([line('p', 100, 1, 0.23)]));
    expect(r.discountSubtotalDelta).toBe(12.3);
  });

  it('takes buy_x_units_percent_off of the gross', () => {
    const r = registry.apply(
      { type: 'buy_x_units_percent_off', productId: 'p', buyUnits: 1, percent: 10 },
      ctx([line('p', 100, 1, 0.23)]),
    );
    expect(r.discountSubtotalDelta).toBe(12.3);
  });

  it('takes the spend_x_percent_off percentage of the gross', () => {
    // Gross 307.50 → 3 steps of 100 (#1396) → 15 % of 307.50 = 46.125 → 46.13.
    const r = registry.apply(
      { type: 'spend_x_percent_off', spendStep: 100, percent: 5, currency: 'PLN' },
      ctx([line('p', 250, 1, 0.23)]),
    );
    expect(r.discountSubtotalDelta).toBe(46.13);
  });

  it('frees a unit VAT included (buy_x_get_y_free)', () => {
    const lines = [line('a', 30, 1, 0.23), line('b', 20, 1, 0.23), line('c', 10, 1, 0.23)];
    const r = registry.apply(
      { type: 'buy_x_get_y_free', buyQuantity: 2, freeQuantity: 1, target: 'cheapest' },
      ctx(lines),
    );
    expect(r.discountSubtotalDelta).toBe(12.3);
  });

  it('frees units VAT included, on the free units net sum per rate (buy_x_units_y_free)', () => {
    // 4 × 29.50 at 23 %, buy 1 get 1 → 2 free: net 59.00 → gross 72.57.
    const r = registry.apply(
      { type: 'buy_x_units_y_free', productId: 'p', buyUnits: 1, freeUnits: 1 },
      ctx([line('p', 29.5, 4, 0.23)]),
    );
    expect(r.discountSubtotalDelta).toBe(72.57);
  });

  it('picks the cheapest unit by what the buyer pays', () => {
    // 10.00 at 23 % is 12.30 gross; 11.00 at 8 % is 11.88 — the cheaper one.
    const lines = [line('a', 10, 1, 0.23), line('b', 11, 1, 0.08)];
    const r = registry.apply(
      { type: 'buy_x_get_y_free', buyQuantity: 1, freeQuantity: 1, target: 'cheapest' },
      ctx(lines),
    );
    expect(r.discountSubtotalDelta).toBe(11.88);
  });

  it('takes every_nth_product_percent_off of the discounted units gross', () => {
    // 4 × 10.00 at 23 %, nth 2 → 2 units: net 20.00 → gross 24.60 → 50 % = 12.30.
    const r = registry.apply(
      { type: 'every_nth_product_percent_off', nth: 2, percent: 50 },
      ctx([line('p', 10, 4, 0.23)]),
    );
    expect(r.discountSubtotalDelta).toBe(12.3);
  });

  it('leaves the fixed amounts themselves unchanged', () => {
    const lines = [line('p', 100, 1, 0.23)];
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 30, currency: 'PLN' }, ctx(lines)).discountSubtotalDelta,
    ).toBe(30);
    expect(
      registry.apply({ type: 'buy_x_units_amount_off', productId: 'p', buyUnits: 1, amount: 15, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(15);
  });
});

/**
 * Issue #1396 (owner ruling 2026-11-17) — a "spend X" step counts the gross the
 * buyer pays, and a fixed amount is capped at the gross: it can make the goods
 * free, VAT included. 100.00 net at 23 % is 123.00 gross.
 */
describe('gross thresholds and fixed-amount caps (#1396)', () => {
  const lines = [line('p', 100, 1, 0.23)];

  it('caps amount_off_cart at the gross', () => {
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 150, currency: 'PLN' }, ctx(lines)).discountSubtotalDelta,
    ).toBe(123);
    expect(
      registry.apply({ type: 'amount_off_cart', amount: 110, currency: 'PLN' }, ctx(lines)).discountSubtotalDelta,
    ).toBe(110);
  });

  it('caps buy_x_units_amount_off at the gross', () => {
    expect(
      registry.apply(
        { type: 'buy_x_units_amount_off', productId: 'p', buyUnits: 1, amount: 150, currency: 'PLN' },
        ctx(lines),
      ).discountSubtotalDelta,
    ).toBe(123);
  });

  it('counts spend_x_amount_off steps on the gross and caps at the gross', () => {
    // Net 100.00 is one step of 60; the gross 123.00 is two → 2 × 7.
    expect(
      registry.apply({ type: 'spend_x_amount_off', spendStep: 60, amount: 7, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(14);
    // Net 100.00 is no step of 110; the gross 123.00 is one.
    expect(
      registry.apply({ type: 'spend_x_amount_off', spendStep: 110, amount: 7, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(7);
    // One step of 120 worth 200 → capped at the gross 123.00.
    expect(
      registry.apply({ type: 'spend_x_amount_off', spendStep: 120, amount: 200, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(123);
  });

  it('counts spend_x_percent_off steps on the gross', () => {
    // Net 100.00 is no step of 110; the gross 123.00 is one → 5 % of 123.00.
    expect(
      registry.apply({ type: 'spend_x_percent_off', spendStep: 110, percent: 5, currency: 'PLN' }, ctx(lines))
        .discountSubtotalDelta,
    ).toBe(6.15);
  });
});
