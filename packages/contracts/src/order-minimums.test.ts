import { describe, expect, it } from 'vitest';
import {
  ORDER_MINIMUM_MAX,
  evaluateOrderMinimums,
  isOrderMinimumEligibleType,
  isValidOrderMinimum,
  minimumRefusal,
  type OrderMinimumLine,
  type OrderMinimumRules,
  type OrderMinimumViolation,
} from './order-minimums.js';

// This package's tests are typed against no runtime, so the high-resolution
// clock is reached through `globalThis` rather than named.
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();

/**
 * Issue #612: the cost is compared across sizes, not against a clock — a
 * wall-clock budget measures the host as much as the code. `run` is timed once
 * on an input of `length` against {@link GROWTH} calls on inputs
 * {@link GROWTH} times shorter, each side the fastest of five timings after a
 * warm-up, every call on an input of its own built outside the timed region.
 * Linear code does the same work on both sides, so the ratio is about 1 however
 * busy the host is; a quadratic path makes it about {@link GROWTH}.
 */
const GROWTH = 16;
/** Four times above linear, four times below what a quadratic path gives. */
const LINEAR_BOUND = 4;
function growthRatio<T>(run: (input: T) => unknown, input: (length: number) => T, length: number): number {
  const fastest = (inputs: () => T[]): number => {
    let best = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample <= 5; sample += 1) {
      const batch = inputs();
      const start = now();
      for (const value of batch) run(value);
      const elapsed = now() - start;
      if (sample > 0) best = Math.min(best, elapsed);
    }
    return best;
  };
  const once = fastest(() => [input(length)]);
  const many = fastest(() => Array.from({ length: GROWTH }, () => input(Math.ceil(length / GROWTH))));
  return once / many;
}

/**
 * Feature 155 (FR-006a, FR-028, FR-037; research R6.1) — the one implementation of the
 * minimum-order rule. Every row of `data-model.md` §6 is a case here.
 */

const A = 'product-a';
const B = 'product-b';
const C = 'product-c';
const X = 'product-x';
const PALLET_B = 'unit-pallet-b';
const PALLET_C = 'unit-pallet-c';

function line(
  key: string,
  productId: string,
  quantity: number,
  extra: Partial<Omit<OrderMinimumLine, 'key' | 'productId' | 'quantity'>> = {},
): OrderMinimumLine {
  return {
    key,
    productId,
    quantity,
    packagingUnitId: null,
    packagingUnitBaseQuantity: null,
    exempt: false,
    ...extra,
  };
}

function product(
  id: string,
  minOrderQuantity: number | null,
  type = 'simple',
): OrderMinimumRules['products'][number] {
  return { id, type, minOrderQuantity };
}

function unit(
  id: string,
  productId: string,
  baseQuantity: number,
  minOrderUnits: number | null,
  name = 'Pallet',
): OrderMinimumRules['packagingUnits'][number] {
  return { id, productId, name, baseQuantity, minOrderUnits };
}

function rules(
  products: OrderMinimumRules['products'],
  packagingUnits: OrderMinimumRules['packagingUnits'] = [],
): OrderMinimumRules {
  return { products, packagingUnits };
}

describe('evaluateOrderMinimums — data-model §6 worked examples', () => {
  it('A × 5 with A min 10 → pieces 5 < 10 (US1 #3)', () => {
    expect(evaluateOrderMinimums([line('l1', A, 5)], rules([product(A, 10)]))).toEqual([
      { key: 'l1', productId: A, kind: 'pieces', minimum: 10, total: 5 },
    ]);
  });

  it('A edited from 10 to 4 with A min 10 → pieces 4 < 10 (US1 #4)', () => {
    expect(evaluateOrderMinimums([line('l1', A, 10)], rules([product(A, 10)]))).toEqual([]);
    expect(evaluateOrderMinimums([line('l1', A, 4)], rules([product(A, 10)]))).toEqual([
      { key: 'l1', productId: A, kind: 'pieces', minimum: 10, total: 4 },
    ]);
  });

  it('B 64 on a 64-piece pallet with Pallet min 2 → unit 1 < 2 (US2 #3)', () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 64, { packagingUnitId: PALLET_B })],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([
      {
        key: 'l1',
        productId: B,
        kind: 'packaging_unit',
        packagingUnitId: PALLET_B,
        packagingUnitName: 'Pallet',
        minimum: 2,
        units: 1,
      },
    ]);
  });

  it('B 5 in pieces with Pallet min 2 and no pieces minimum → none (US2 #5)', () => {
    expect(
      evaluateOrderMinimums([line('l1', B, 5)], rules([product(B, null)], [unit(PALLET_B, B, 64, 2)])),
    ).toEqual([]);
  });

  it('two variants of B, one pallet each, Pallet min 2 → none (US2 #6)', () => {
    expect(
      evaluateOrderMinimums(
        [
          line('red', B, 64, { packagingUnitId: PALLET_B }),
          line('blue', B, 64, { packagingUnitId: PALLET_B }),
        ],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([]);
  });

  it('C 128 on pallets plus C 3 in pieces, C min 10 and Pallet min 2 → none (US3 #3)', () => {
    expect(
      evaluateOrderMinimums(
        [line('pallets', C, 128, { packagingUnitId: PALLET_C }), line('pieces', C, 3)],
        rules([product(C, 10)], [unit(PALLET_C, C, 64, 2)]),
      ),
    ).toEqual([]);
  });

  it('C 64 on one pallet, C min 10 and Pallet min 2 → the unit violation only (US3 #4)', () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', C, 64, { packagingUnitId: PALLET_C })],
        rules([product(C, 10)], [unit(PALLET_C, C, 64, 2)]),
      ),
    ).toEqual([
      {
        key: 'l1',
        productId: C,
        kind: 'packaging_unit',
        packagingUnitId: PALLET_C,
        packagingUnitName: 'Pallet',
        minimum: 2,
        units: 1,
      },
    ]);
  });

  it('A 5 exempt plus a variant line of 3, A min 10 → only the non-exempt line, total 8 (US4 #7c)', () => {
    expect(
      evaluateOrderMinimums(
        [line('seeded', A, 5, { exempt: true }), line('v2', A, 3)],
        rules([product(A, 10)]),
      ),
    ).toEqual([{ key: 'v2', productId: A, kind: 'pieces', minimum: 10, total: 8 }]);
  });

  it('A 5 exempt plus a variant line of 5, A min 10 → none (US4 #7c)', () => {
    expect(
      evaluateOrderMinimums(
        [line('seeded', A, 5, { exempt: true }), line('v2', A, 5)],
        rules([product(A, 10)]),
      ),
    ).toEqual([]);
  });

  it('a seeded line whose exemption the caller withdrew is judged like any other (US4 #7e, FR-036)', () => {
    expect(
      evaluateOrderMinimums([line('seeded', A, 5, { exempt: false })], rules([product(A, 10)])),
    ).toEqual([{ key: 'seeded', productId: A, kind: 'pieces', minimum: 10, total: 5 }]);
  });

  it('B 96 on a 64-piece pallet, Pallet min 2 → unit 1.5 < 2 (real-number count)', () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 96, { packagingUnitId: PALLET_B })],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([
      {
        key: 'l1',
        productId: B,
        kind: 'packaging_unit',
        packagingUnitId: PALLET_B,
        packagingUnitName: 'Pallet',
        minimum: 2,
        units: 1.5,
      },
    ]);
  });

  it('B 64 on a deleted unit, B min 10 → none: pieces 64 ≥ 10 and no unit rule', () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 64, { packagingUnitId: 'unit-gone', packagingUnitBaseQuantity: 64 })],
        rules([product(B, 10)]),
      ),
    ).toEqual([]);
  });

  it('X 5 with no record for X → product_unavailable (FR-037)', () => {
    expect(evaluateOrderMinimums([line('l1', X, 5)], rules([]))).toEqual([
      { key: 'l1', productId: X, kind: 'product_unavailable' },
    ]);
  });

  it('file rows of two variants, 4 + 6, A min 10 → none: the file total is 10 (US4 #1c)', () => {
    expect(
      evaluateOrderMinimums([line('row1', A, 4), line('row2', A, 6)], rules([product(A, 10)])),
    ).toEqual([]);
  });

  it('file rows of two variants, 4 + 3, A min 10 → both rows below, total 7 (US4 #1c)', () => {
    expect(
      evaluateOrderMinimums([line('row1', A, 4), line('row2', A, 3)], rules([product(A, 10)])),
    ).toEqual([
      { key: 'row1', productId: A, kind: 'pieces', minimum: 10, total: 7 },
      { key: 'row2', productId: A, kind: 'pieces', minimum: 10, total: 7 },
    ]);
  });

  it('batch: one pallet of C plus C 3 on an empty cart → pass 1 rejects the pallet, pass 2 the pieces line', () => {
    const r = rules([product(C, 10)], [unit(PALLET_C, C, 64, 2)]);
    const batch = [line('pallet', C, 64, { packagingUnitId: PALLET_C }), line('pieces', C, 3)];

    const pass1 = evaluateOrderMinimums(batch, r);
    const rejectedInPass1 = new Set(
      pass1.filter((v) => v.kind === 'packaging_unit').map((v) => v.key),
    );
    expect([...rejectedInPass1]).toEqual(['pallet']);

    const survivors = batch.filter((l) => !rejectedInPass1.has(l.key));
    expect(evaluateOrderMinimums(survivors, r)).toEqual([
      { key: 'pieces', productId: C, kind: 'pieces', minimum: 10, total: 3 },
    ]);
  });
});

describe('evaluateOrderMinimums — rules of R6.1', () => {
  it('a line with no product record is counted toward no total', () => {
    // The unknown line is X's, but it shares nothing with A: A's total stays 4.
    expect(
      evaluateOrderMinimums([line('x', X, 100), line('a', A, 4)], rules([product(A, 10)])),
    ).toEqual([
      { key: 'x', productId: X, kind: 'product_unavailable' },
      { key: 'a', productId: A, kind: 'pieces', minimum: 10, total: 4 },
    ]);
  });

  it('a line with no product record carries only product_unavailable, even naming a unit with a minimum', () => {
    expect(
      evaluateOrderMinimums(
        [line('x', X, 1, { packagingUnitId: 'unit-x' })],
        rules([], [unit('unit-x', X, 10, 5)]),
      ),
    ).toEqual([{ key: 'x', productId: X, kind: 'product_unavailable' }]);
  });

  it.each(['grouped', 'bundle', 'virtual'])(
    'ignores both minimums on an ineligible %s product, which is still present',
    (type) => {
      expect(
        evaluateOrderMinimums(
          [line('l1', A, 1), line('l2', A, 1, { packagingUnitId: 'unit-a' })],
          rules([product(A, 10, type)], [unit('unit-a', A, 1, 5)]),
        ),
      ).toEqual([]);
    },
  );

  it.each(['simple', 'configurable'])('applies the minimums to a %s product', (type) => {
    expect(evaluateOrderMinimums([line('l1', A, 1)], rules([product(A, 10, type)]))).toEqual([
      { key: 'l1', productId: A, kind: 'pieces', minimum: 10, total: 1 },
    ]);
  });

  it('treats minOrderQuantity 1 (and null) as no rule', () => {
    expect(evaluateOrderMinimums([line('l1', A, 1)], rules([product(A, 1)]))).toEqual([]);
    expect(evaluateOrderMinimums([line('l1', A, 1)], rules([product(A, null)]))).toEqual([]);
  });

  it('treats minOrderUnits null as no unit rule', () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 1, { packagingUnitId: PALLET_B })],
        rules([product(B, null)], [unit(PALLET_B, B, 64, null)]),
      ),
    ).toEqual([]);
  });

  it('a vanished unit gives no unit rule, but its pieces still count toward the product total', () => {
    expect(
      evaluateOrderMinimums(
        [line('gone', B, 64, { packagingUnitId: 'unit-gone', packagingUnitBaseQuantity: 64 }), line('p', B, 1)],
        rules([product(B, 100)]),
      ),
    ).toEqual([
      { key: 'gone', productId: B, kind: 'pieces', minimum: 100, total: 65 },
      { key: 'p', productId: B, kind: 'pieces', minimum: 100, total: 65 },
    ]);
  });

  it("a unit of another product is no rule for this line (it is not one of the product's units)", () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', A, 64, { packagingUnitId: PALLET_B })],
        rules([product(A, null), product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([]);
  });

  it("uses the line's base-quantity snapshot over the unit's current value", () => {
    // Snapshot 32: 64 pieces = 2 units ≥ 2. The current value (64) would say 1 < 2.
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 64, { packagingUnitId: PALLET_B, packagingUnitBaseQuantity: 32 })],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([]);
  });

  it("uses the unit's current base quantity when the line has no snapshot", () => {
    expect(
      evaluateOrderMinimums(
        [line('l1', B, 64, { packagingUnitId: PALLET_B, packagingUnitBaseQuantity: null })],
        rules([product(B, null)], [unit(PALLET_B, B, 32, 2)]),
      ),
    ).toEqual([]);
  });

  it('counts unit lines with differing snapshots each by its own snapshot', () => {
    // 32 / 32 = 1 unit, 64 / 64 = 1 unit → 2 ≥ 2.
    expect(
      evaluateOrderMinimums(
        [
          line('old', B, 32, { packagingUnitId: PALLET_B, packagingUnitBaseQuantity: 32 }),
          line('new', B, 64, { packagingUnitId: PALLET_B }),
        ],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([]);
  });

  it('counts exempt lines toward the unit total and never flags them', () => {
    expect(
      evaluateOrderMinimums(
        [
          line('seeded', B, 64, { packagingUnitId: PALLET_B, exempt: true }),
          line('added', B, 32, { packagingUnitId: PALLET_B }),
        ],
        rules([product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([
      {
        key: 'added',
        productId: B,
        kind: 'packaging_unit',
        packagingUnitId: PALLET_B,
        packagingUnitName: 'Pallet',
        minimum: 2,
        units: 1.5,
      },
    ]);
  });

  it('never flags an exempt line, however far below it is', () => {
    expect(
      evaluateOrderMinimums(
        [line('seeded', B, 1, { packagingUnitId: PALLET_B, exempt: true })],
        rules([product(B, 100)], [unit(PALLET_B, B, 64, 5)]),
      ),
    ).toEqual([]);
  });

  it('reports pieces before the unit for one line, and keeps input order across lines', () => {
    const violations = evaluateOrderMinimums(
      [line('a', A, 1), line('c', C, 64, { packagingUnitId: PALLET_C }), line('a2', A, 2)],
      rules([product(A, 10), product(C, 100)], [unit(PALLET_C, C, 64, 2)]),
    );
    expect(violations.map((v) => [v.key, v.kind])).toEqual([
      ['a', 'pieces'],
      ['c', 'pieces'],
      ['c', 'packaging_unit'],
      ['a2', 'pieces'],
    ]);
  });

  it('counts unit totals per product and unit, not per unit alone', () => {
    // A unit row is per product; two products whose lines name the same unit id cannot
    // pool. Here only B owns PALLET_B, so the A line is not counted toward it.
    expect(
      evaluateOrderMinimums(
        [line('a', A, 64, { packagingUnitId: PALLET_B }), line('b', B, 64, { packagingUnitId: PALLET_B })],
        rules([product(A, null), product(B, null)], [unit(PALLET_B, B, 64, 2)]),
      ),
    ).toEqual([
      {
        key: 'b',
        productId: B,
        kind: 'packaging_unit',
        packagingUnitId: PALLET_B,
        packagingUnitName: 'Pallet',
        minimum: 2,
        units: 1,
      },
    ]);
  });

  it('returns nothing for no lines', () => {
    expect(evaluateOrderMinimums([], rules([product(A, 10)]))).toEqual([]);
  });

  it('evaluates 10 000 lines over 10 000 products in time proportional to them (linear, F4)', () => {
    const cart = (n: number) => {
      const products: OrderMinimumRules['products'][number][] = [];
      const units: OrderMinimumRules['packagingUnits'][number][] = [];
      const lines: OrderMinimumLine[] = [];
      for (let i = 0; i < n; i++) {
        const id = `p${i}`;
        products.push(product(id, 10));
        units.push(unit(`u${i}`, id, 4, 3));
        lines.push(line(`l${i}`, id, 4, i % 2 === 0 ? { packagingUnitId: `u${i}` } : {}));
      }
      return { lines, rules: rules(products, units) };
    };
    const n = 10_000;
    const { lines, rules: all } = cart(n);
    // Every line is below 10 pieces; even lines are also below 3 pallets.
    expect(evaluateOrderMinimums(lines, all)).toHaveLength(n + n / 2);
    const ratio = growthRatio((given: ReturnType<typeof cart>) => evaluateOrderMinimums(given.lines, given.rules), cart, n);
    expect(ratio, `${GROWTH}× the lines, ${ratio.toFixed(2)}× the time`).toBeLessThan(LINEAR_BOUND);
  });
});

describe('isValidOrderMinimum', () => {
  it('exposes the bound', () => {
    expect(ORDER_MINIMUM_MAX).toBe(1_000_000);
  });

  it.each([1, 2, 1_000_000])('accepts %s', (n) => {
    expect(isValidOrderMinimum(n)).toBe(true);
  });

  it.each([0, -1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (n) => {
    expect(isValidOrderMinimum(n)).toBe(false);
  });
});

describe('isOrderMinimumEligibleType (D5)', () => {
  it.each(['simple', 'configurable'])('accepts %s', (type) => {
    expect(isOrderMinimumEligibleType(type)).toBe(true);
  });

  it.each(['grouped', 'bundle', 'virtual', ''])('refuses %s', (type) => {
    expect(isOrderMinimumEligibleType(type)).toBe(false);
  });
});

describe('minimumRefusal (R10, SC-004, analyze F11)', () => {
  type MinimumViolation = Exclude<OrderMinimumViolation, { kind: 'product_unavailable' }>;
  const names = new Map([
    [A, 'Anchor bolt M8'],
    [B, 'Cable tray'],
  ]);

  const piecesA: MinimumViolation = { key: 'item-1', productId: A, kind: 'pieces', minimum: 10, total: 5 };
  const unitB: MinimumViolation = {
    key: 'item-2',
    productId: B,
    kind: 'packaging_unit',
    packagingUnitId: PALLET_B,
    packagingUnitName: 'Pallet',
    minimum: 2,
    units: 1.5,
  };

  it('returns null when nothing is below a minimum', () => {
    expect(minimumRefusal([], names, 'cartItemId')).toBeNull();
  });

  it('a pieces refusal names the product and the minimum at the top level', () => {
    const refusal = minimumRefusal([piecesA], names, 'cartItemId');
    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('PRODUCT_BELOW_MINIMUM_QUANTITY');
    expect(refusal!.message).toContain('Anchor bolt M8');
    expect(refusal!.message).toContain('10');
    expect(refusal!.details).toMatchObject({
      productId: A,
      productName: 'Anchor bolt M8',
      minimum: 10,
      total: 5,
    });
    expect(refusal!.details.lines).toEqual([
      { cartItemId: 'item-1', productId: A, productName: 'Anchor bolt M8', kind: 'pieces', minimum: 10 },
    ]);
  });

  it('a unit refusal names the product, the minimum and the unit at the top level', () => {
    const refusal = minimumRefusal([unitB], names, 'cartItemId');
    expect(refusal!.code).toBe('PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY');
    expect(refusal!.message).toContain('Cable tray');
    expect(refusal!.message).toContain('Pallet');
    expect(refusal!.details).toMatchObject({
      productId: B,
      productName: 'Cable tray',
      packagingUnitId: PALLET_B,
      packagingUnitName: 'Pallet',
      minimum: 2,
      units: 1.5,
    });
    expect(refusal!.details.lines).toEqual([
      {
        cartItemId: 'item-2',
        productId: B,
        productName: 'Cable tray',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
    ]);
  });

  it("takes the first violation's code and top-level fields, and lists every violation", () => {
    const refusal = minimumRefusal([unitB, piecesA], names, 'cartItemId');
    expect(refusal!.code).toBe('PACKAGING_UNIT_BELOW_MINIMUM_QUANTITY');
    expect(refusal!.details).toMatchObject({ productName: 'Cable tray', minimum: 2, packagingUnitName: 'Pallet' });
    expect(refusal!.details.lines).toEqual([
      {
        cartItemId: 'item-2',
        productId: B,
        productName: 'Cable tray',
        kind: 'packaging_unit',
        minimum: 2,
        packagingUnitName: 'Pallet',
      },
      { cartItemId: 'item-1', productId: A, productName: 'Anchor bolt M8', kind: 'pieces', minimum: 10 },
    ]);
  });

  it("puts the caller's key under `index` as a number for request-indexed callers", () => {
    const refusal = minimumRefusal([{ ...piecesA, key: '3' }], names, 'index');
    expect(refusal!.details.lines).toEqual([
      { index: 3, productId: A, productName: 'Anchor bolt M8', kind: 'pieces', minimum: 10 },
    ]);
  });
});
