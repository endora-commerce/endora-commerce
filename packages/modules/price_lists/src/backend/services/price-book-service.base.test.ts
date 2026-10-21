import { describe, expect, it } from 'vitest';
import { priceBookRowInputSchema } from '@endora-commerce/contracts';
import { baseBookRowIssues, planBasePriceRows, rowOverlaps } from './price-book-rules.js';

/**
 * Feature 160 (FR-009) — what a base-price write may store. Each currency has
 * one base book; it holds product and variant rows only; a product's base rows
 * are fixed amounts with optional quantity tiers; a variant's row is its own
 * fixed tiers, or a percentage or amount adjustment of its product's base price
 * at the same quantity, or nothing (it inherits).
 */

const P5 = '00000000-0000-4000-8000-000000000005';
const P5R = '00000000-0000-4000-8000-0000000005a1';
const P5B = '00000000-0000-4000-8000-0000000005b1';
const OTHER = '00000000-0000-4000-8000-0000000009a9';
const variants = new Set([P5R, P5B]);

const plan = (prices: Parameters<typeof planBasePriceRows>[0]['prices']) =>
  planBasePriceRows({ productId: P5, currencyCode: 'PLN', prices, variantIdsOfProduct: variants });

describe('base prices — the rows one write stores (FR-009)', () => {
  it('stores product tiers as fixed product rows', () => {
    const { rows, issues } = plan({
      product: [
        { minQuantity: 1, maxQuantity: 9, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
      variants: {},
    });
    expect(issues).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({ productId: P5, variantId: null, priceType: 'fixed', amount: '100', minQuantity: 1, maxQuantity: 9 }),
      expect.objectContaining({ productId: P5, variantId: null, priceType: 'fixed', amount: '90', minQuantity: 10, maxQuantity: null }),
    ]);
  });

  it('stores a variant as fixed tiers, a percentage or an amount adjustment; null inherits', () => {
    const { rows, issues } = plan({
      product: [{ minQuantity: 1, maxQuantity: null, amount: '80' }],
      variants: {
        [P5R]: { type: 'percent', percent: '10' },
        [P5B]: { type: 'amount', amount: '7' },
      },
    });
    expect(issues).toEqual([]);
    expect(rows.filter((r) => r.variantId !== null)).toEqual([
      expect.objectContaining({ variantId: P5R, productId: P5, priceType: 'percent', percent: '10', amount: null, minQuantity: 1 }),
      expect.objectContaining({ variantId: P5B, productId: P5, priceType: 'amount', amount: '7', percent: null }),
    ]);
    const inherit = plan({ product: [{ minQuantity: 1, maxQuantity: null, amount: '80' }], variants: { [P5R]: null } });
    expect(inherit.rows.filter((r) => r.variantId !== null)).toEqual([]);
    const own = plan({
      product: [],
      variants: { [P5R]: { type: 'fixed', tiers: [{ minQuantity: 1, maxQuantity: null, amount: '85' }] } },
    });
    expect(own.issues).toEqual([]);
    expect(own.rows).toEqual([expect.objectContaining({ variantId: P5R, priceType: 'fixed', amount: '85' })]);
  });

  it('refuses overlapping tiers', () => {
    const { issues } = plan({
      product: [
        { minQuantity: 1, maxQuantity: 10, amount: '100' },
        { minQuantity: 10, maxQuantity: null, amount: '90' },
      ],
      variants: {},
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toMatch(/overlap/);
  });

  it('refuses a variant of another product', () => {
    const { issues } = plan({ product: [{ minQuantity: 1, maxQuantity: null, amount: '80' }], variants: { [OTHER]: null } });
    expect(issues[0]!.path).toEqual(['byCurrency', 'PLN', 'variants', OTHER]);
  });

  it('refuses an adjustment with no product base to adjust', () => {
    const { issues } = plan({ product: [], variants: { [P5R]: { type: 'percent', percent: '10' } } });
    expect(issues[0]!.message).toMatch(/needs the product's own base price/);
  });
});

describe('base books — only product and variant rows, product rows fixed (FR-009)', () => {
  const row = (r: unknown) => priceBookRowInputSchema.parse(r);

  it('accepts fixed product rows and variant rows of every price kind', () => {
    expect(baseBookRowIssues(row({ selection: { productId: P5 }, minQuantity: 1, price: { type: 'fixed', amount: '80' } }))).toEqual([]);
    expect(
      baseBookRowIssues(row({ selection: { variantId: P5R }, minQuantity: 1, price: { type: 'percent', percent: '10' } })),
    ).toEqual([]);
  });

  it('refuses category, attribute and all-products rows', () => {
    for (const selection of [{ categoryId: OTHER }, { attribute: { key: 'color', value: 'red' } }, {}]) {
      const issues = baseBookRowIssues(row({ selection, minQuantity: 1, price: { type: 'percent', percent: '-5' } }));
      expect(issues).toHaveLength(1);
    }
  });

  it("refuses a product row that is not a fixed amount", () => {
    expect(
      baseBookRowIssues(row({ selection: { productId: P5 }, minQuantity: 1, price: { type: 'percent', percent: '-5' } })),
    ).toHaveLength(1);
  });
});

describe('rows of one book — no overlapping windows on one selection (FR-006)', () => {
  const base = { variantId: null, categoryId: null, attributeKey: null, attributeValue: null, priceType: 'fixed' as const, amount: '1', percent: null };
  it('refuses the same selection with overlapping windows, and only that', () => {
    const rows = [
      { ...base, productId: P5, minQuantity: 1, maxQuantity: 9 },
      { ...base, productId: P5, minQuantity: 5, maxQuantity: null },
      { ...base, productId: P5, minQuantity: 10, maxQuantity: null, variantId: P5R },
      { ...base, productId: OTHER, minQuantity: 1, maxQuantity: null },
    ];
    expect(rowOverlaps(rows)).toEqual([[0, 1]]);
  });
});
