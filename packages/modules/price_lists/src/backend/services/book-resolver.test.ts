import { describe, expect, it } from 'vitest';
import {
  createBookResolver,
  type BookAudience,
  type BookRow,
  type ResolverBook,
  type ResolverLine,
} from './book-resolver.js';
import {
  PRECEDENCE_PRESETS,
  presetConfig,
  validatePrecedence,
  type CellCode,
  type PrecedenceConfig,
  type SelectionKind,
} from './precedence.js';
import type { EligibleAttribute } from './attribute-eligibility.js';

/**
 * Feature 160 (D-287 §5.2) — the pure three-tier resolver: base → catalogue →
 * buyer, then sale when strictly lower (FR-008, FR-013–FR-015, FR-019, FR-022).
 *
 * The order key is lexicographic and total: cell rank → chain depth →
 * priority desc → starting quantity desc → resulting amount asc → book id →
 * row id. The property tests at the end run it over every one of the 266 valid
 * precedence configurations.
 */

const P1 = 'p1';
const P5 = 'p5';
const P5R = 'p5r';
const SCREWS = 'cat-screws';
const BOLTS = 'cat-bolts';

const ELIGIBLE: ReadonlyMap<string, EligibleAttribute> = new Map([
  ['color', { key: 'color', valueType: 'select' }],
]);

let seq = 0;
const id = (prefix: string) => `${prefix}-${String((seq += 1)).padStart(4, '0')}`;

function book(
  audience: BookAudience,
  overrides: Partial<Omit<ResolverBook, 'audience'>> = {},
): ResolverBook {
  return {
    id: overrides.id ?? id('book'),
    name: overrides.name ?? 'Book',
    type: overrides.type ?? 'regular',
    isSystem: overrides.isSystem ?? false,
    priority: overrides.priority ?? 0,
    audience,
  };
}

const BASE = book({ kind: 'everyone' }, { id: 'base-pln', name: 'Base PLN', isSystem: true });
const EVERYONE = { kind: 'everyone' } as const;
const org = (depth: number): BookAudience => ({ kind: 'organizations', depth });
const GROUP: BookAudience = { kind: 'customer_groups' };

type RowSpec = Partial<Omit<BookRow, 'bookId'>> & { book: ResolverBook };

function row(spec: RowSpec): BookRow {
  return {
    id: spec.id ?? id('row'),
    bookId: spec.book.id,
    variantId: spec.variantId ?? null,
    productId: spec.productId ?? null,
    categoryId: spec.categoryId ?? null,
    attributeKey: spec.attributeKey ?? null,
    attributeValue: spec.attributeValue ?? null,
    minQuantity: spec.minQuantity ?? 1,
    maxQuantity: spec.maxQuantity ?? null,
    priceType: spec.priceType ?? 'fixed',
    amount: spec.amount ?? null,
    percent: spec.percent ?? null,
  };
}

const fixed = (b: ResolverBook, amount: string, sel: Partial<BookRow> = {}) =>
  row({ book: b, priceType: 'fixed', amount, ...sel });
const percent = (b: ResolverBook, p: string, sel: Partial<BookRow> = {}) =>
  row({ book: b, priceType: 'percent', percent: p, ...sel });
const adjust = (b: ResolverBook, delta: string, sel: Partial<BookRow> = {}) =>
  row({ book: b, priceType: 'amount', amount: delta, ...sel });

function line(overrides: Partial<ResolverLine> = {}): ResolverLine {
  return {
    productId: P1,
    variantId: null,
    quantity: 1,
    categoryIds: new Set([SCREWS]),
    attributes: { color: 'red' },
    ...overrides,
  };
}

function resolve(
  books: ResolverBook[],
  rows: BookRow[],
  l: ResolverLine = line(),
  config: PrecedenceConfig = PRECEDENCE_PRESETS.HY,
) {
  return createBookResolver({
    books: [BASE, ...books],
    rows,
    precedence: { version: 1, config },
    eligibleAttributes: ELIGIBLE,
  }).resolve(l);
}

const base100 = fixed(BASE, '100.0000', { productId: P1 });

describe('book resolver — base tier', () => {
  it('a buyer to whom no book applies pays the base price', () => {
    const r = resolve([], [base100]);
    expect(r.price).toMatchObject({ amount: '100.0000', source: 'base', compareAt: null, bookId: BASE.id });
    expect(r.explanation).toMatchObject({ tier: 'base', bookId: BASE.id, precedenceVersion: 1 });
  });

  it('takes the tier covering the quantity', () => {
    const rows = [
      fixed(BASE, '100', { productId: P1, minQuantity: 1, maxQuantity: 9 }),
      fixed(BASE, '90', { productId: P1, minQuantity: 10 }),
    ];
    expect(resolve([], rows, line({ quantity: 9 })).price?.amount).toBe('100.0000');
    expect(resolve([], rows, line({ quantity: 10 })).price?.amount).toBe('90.0000');
    expect(resolve([], rows, line({ quantity: 10 })).price?.startQuantity).toBe(10);
  });

  it('a variant inherits its product’s base, or states its own as fixed, percent or amount', () => {
    const p5 = fixed(BASE, '80', { productId: P5 });
    const v = (variantId: string) => line({ productId: P5, variantId });
    expect(resolve([], [p5], v('p5b')).price?.amount).toBe('80.0000');
    expect(
      resolve([], [p5, percent(BASE, '10', { productId: P5, variantId: P5R })], v(P5R)).price?.amount,
    ).toBe('88.0000');
    expect(
      resolve([], [p5, adjust(BASE, '7', { productId: P5, variantId: 'p5b' })], v('p5b')).price?.amount,
    ).toBe('87.0000');
    expect(
      resolve([], [p5, fixed(BASE, '85', { productId: P5, variantId: P5R })], v(P5R)).price?.amount,
    ).toBe('85.0000');
  });

  it('a variant row of another variant does not apply', () => {
    const rows = [fixed(BASE, '80', { productId: P5 }), percent(BASE, '10', { productId: P5, variantId: P5R })];
    expect(resolve([], rows, line({ productId: P5, variantId: 'p5b' })).price?.amount).toBe('80.0000');
  });

  it('no base row, no book → unpriced', () => {
    const r = resolve([], []);
    expect(r.price).toBeNull();
    expect(r.explanation.tier).toBeNull();
  });
});

describe('book resolver — catalogue tier', () => {
  it('an everyone book overrides the base for the selection it prices (E1.1)', () => {
    const l1 = book(EVERYONE);
    const e1 = fixed(l1, '120', { categoryId: SCREWS, attributeKey: 'color', attributeValue: 'red' });
    const r = resolve([l1], [base100, e1]);
    expect(r.price).toMatchObject({ amount: '120.0000', source: 'catalogue', bookId: l1.id, rowId: e1.id });
  });

  it('a selection that does not match leaves the base (E1.2, E1.3)', () => {
    const l1 = book(EVERYONE);
    const e1 = fixed(l1, '120', { categoryId: SCREWS, attributeKey: 'color', attributeValue: 'red' });
    const blue = resolve([l1], [fixed(BASE, '50', { productId: P1 }), e1], line({ attributes: { color: 'blue' } }));
    expect(blue.price).toMatchObject({ amount: '50.0000', source: 'base' });
    const bolt = resolve([l1], [fixed(BASE, '30', { productId: P1 }), e1], line({ categoryIds: new Set([BOLTS]) }));
    expect(bolt.price).toMatchObject({ amount: '30.0000', source: 'base' });
  });

  it('ranks everyone rows by selection kind, category before attribute by default (C2)', () => {
    const l = book(EVERYONE);
    const rows = [
      base100,
      fixed(l, '110', { categoryId: SCREWS }),
      fixed(l, '125', { attributeKey: 'color', attributeValue: 'red' }),
    ];
    expect(resolve([l], rows).price?.amount).toBe('110.0000');
    expect(resolve([l], rows, line(), presetConfig('HY', false)).price?.amount).toBe('125.0000');
  });

  it('a percentage is off the base, and a surcharge is allowed (U1.1)', () => {
    const l = book(EVERYONE);
    const r = resolve([l], [base100, percent(l, '20', { attributeKey: 'color', attributeValue: 'red' })]);
    expect(r.price).toMatchObject({ amount: '120.0000', source: 'catalogue' });
  });

  it('a row whose result is negative is skipped, zero is a price (U3.2, U4)', () => {
    const l = book(EVERYONE);
    expect(resolve([l], [base100, adjust(l, '-160', { productId: P1 })]).price).toMatchObject({
      amount: '100.0000',
      source: 'base',
    });
    expect(resolve([l], [base100, adjust(l, '-100', { productId: P1 })]).price).toMatchObject({
      amount: '0.0000',
      source: 'catalogue',
    });
  });

  it('an attribute row on an attribute that is not eligible is inert', () => {
    const l = book(EVERYONE);
    const r = resolve([l], [base100, fixed(l, '1', { attributeKey: 'material', attributeValue: 'steel' })], line({
      attributes: { color: 'red', material: 'steel' },
    }));
    expect(r.price?.amount).toBe('100.0000');
  });

  it('sale and system books never price the catalogue tier', () => {
    const sale = book(EVERYONE, { type: 'sale' });
    const r = resolve([sale], [base100, fixed(sale, '120', { productId: P1 })]);
    expect(r.catalogue).toBeNull();
  });
});

describe('book resolver — buyer tier', () => {
  it('a buyer percentage is off the catalogue price (E2.5)', () => {
    const l1 = book(EVERYONE);
    const l2 = book(org(0));
    const r = resolve(
      [l1, l2],
      [
        base100,
        fixed(l1, '120', { categoryId: SCREWS, attributeKey: 'color', attributeValue: 'red' }),
        percent(l2, '-20', { productId: P1 }),
        percent(l2, '-10', { categoryId: SCREWS }),
      ],
    );
    expect(r.price).toMatchObject({ amount: '96.0000', source: 'buyer', bookId: l2.id });
    expect(r.explanation).toMatchObject({ tier: 'buyer', cell: 'org.product', reference: '120.0000' });
  });

  it('the cell order decides between audiences — F1 under HY and under AF', () => {
    const acme = book(org(0));
    const vip = book(GROUP);
    const rows = [base100, percent(acme, '-2'), percent(vip, '-30', { productId: P1 })];
    expect(resolve([acme, vip], rows).price?.amount).toBe('70.0000');
    expect(resolve([acme, vip], rows, line(), PRECEDENCE_PRESETS.AF).price?.amount).toBe('98.0000');
  });

  it('chain depth sits inside the cell, except under AF-N (H1, H2)', () => {
    const acmeW = book(org(0));
    const acme = book(org(1));
    const h1 = [base100, percent(acmeW, '-7', { categoryId: SCREWS }), percent(acme, '-5', { productId: P1 })];
    expect(resolve([acmeW, acme], h1).price?.amount).toBe('95.0000');
    expect(resolve([acmeW, acme], h1, line(), PRECEDENCE_PRESETS['AF-N']).price?.amount).toBe('93.0000');
    const h2 = [base100, percent(acmeW, '-7', { productId: P1 }), percent(acme, '-5', { productId: P1 })];
    expect(resolve([acmeW, acme], h2).price?.amount).toBe('93.0000');
  });

  it('priority decides between books defining the same cell, after rank and depth (T1–T3)', () => {
    const l4 = book(org(0), { id: 'book-l4' });
    const e4a = percent(l4, '-5', { productId: P1 });
    const high = book(org(0), { id: 'book-l6', priority: 10 });
    expect(resolve([l4, high], [base100, e4a, fixed(high, '97', { productId: P1 })]).price?.amount).toBe(
      '97.0000',
    );
    const equal = book(org(0), { id: 'book-l6b', priority: 0 });
    expect(resolve([l4, equal], [base100, e4a, fixed(equal, '97', { productId: P1 })]).price?.amount).toBe(
      '95.0000',
    );
    expect(
      resolve([l4, high], [base100, e4a, fixed(high, '97', { categoryId: SCREWS })]).price?.amount,
    ).toBe('95.0000');
  });

  it('a higher starting quantity wins before a lower amount', () => {
    const a = book(org(0));
    const b = book(org(0));
    const rows = [base100, percent(a, '-10', { productId: P1 }), percent(b, '-5', { productId: P1, minQuantity: 10 })];
    expect(resolve([a, b], rows, line({ quantity: 10 })).price?.amount).toBe('95.0000');
    expect(resolve([a, b], rows, line({ quantity: 9 })).price?.amount).toBe('90.0000');
  });

  it('a row that does not cover the quantity falls through to the next candidate (Q3)', () => {
    const l4 = book(org(0));
    const rows = [
      fixed(BASE, '100', { productId: P1, maxQuantity: 9 }),
      fixed(BASE, '90', { productId: P1, minQuantity: 10 }),
      fixed(l4, '70', { productId: P1, minQuantity: 100 }),
      percent(l4, '-15', { categoryId: SCREWS }),
    ];
    expect(resolve([l4], rows, line({ quantity: 50 })).price?.amount).toBe('76.5000');
    expect(resolve([l4], rows, line({ quantity: 100 })).price?.amount).toBe('70.0000');
  });

  it('equal rank, priority and quantity: the lower amount, then the book id, then the row id', () => {
    const a = book(org(0), { id: 'book-b' });
    const b = book(org(0), { id: 'book-a' });
    const cheap = resolve([a, b], [base100, fixed(a, '91', { productId: P1 }), fixed(b, '92', { productId: P1 })]);
    expect(cheap.price?.amount).toBe('91.0000');
    const tie = resolve([a, b], [base100, fixed(a, '91', { productId: P1 }), fixed(b, '91', { productId: P1 })]);
    expect(tie.price?.bookId).toBe('book-a');
  });

  it('rounds a percentage half-up to four decimals', () => {
    const l = book(org(0));
    const r = resolve([l], [fixed(BASE, '1.0001', { productId: P1 }), percent(l, '-50', { productId: P1 })]);
    expect(r.price?.amount).toBe('0.5001');
    const r2 = resolve([l], [fixed(BASE, '33.3333', { productId: P1 }), percent(l, '-15', { productId: P1 })]);
    expect(r2.price?.amount).toBe('28.3333');
  });

  it('a percentage whose reference is missing is skipped, and the line is unpriced (Q4)', () => {
    const l4 = book(org(0));
    const r = resolve([l4], [percent(l4, '-15', { categoryId: SCREWS })]);
    expect(r.price).toBeNull();
  });

  it('a 100 % discount is a free line (U4)', () => {
    const acme = book(org(0));
    expect(resolve([acme], [base100, percent(acme, '-100', { productId: P1 })]).price).toMatchObject({
      amount: '0.0000',
      source: 'buyer',
    });
  });

  it('lists the ranked candidates, at most ten', () => {
    const books = Array.from({ length: 12 }, () => book(org(0)));
    const rows = [base100, ...books.map((b, i) => fixed(b, String(50 + i), { productId: P1 }))];
    const r = resolve(books, rows);
    expect(r.price?.amount).toBe('50.0000');
    expect(r.explanation.candidates).toHaveLength(10);
    expect(r.explanation.candidates[0]).toMatchObject({ cell: 'org.product', amount: '50.0000' });
  });
});

describe('book resolver — sale tier', () => {
  it('a sale is charged only when strictly lower, with the buyer price as compare-at (S1.1–S2)', () => {
    const l4 = book(org(0));
    const vip = book(GROUP);
    const sale = book(EVERYONE, { type: 'sale' });
    const rows = [base100, percent(l4, '-5', { productId: P1 }), percent(vip, '-10', { productId: P1 }), percent(sale, '-10')];
    const acme = resolve([l4, vip, sale], rows);
    expect(acme.price).toMatchObject({ amount: '90.0000', source: 'sale', compareAt: '95.0000' });
    const beta = resolve([vip, sale], rows.filter((r) => r.bookId !== l4.id));
    expect(beta.price).toMatchObject({ amount: '90.0000', source: 'buyer', compareAt: null });
    const higher = resolve([l4, sale], [base100, percent(l4, '-5', { productId: P1 }), fixed(sale, '98', { productId: P1 })]);
    expect(higher.price).toMatchObject({ amount: '95.0000', source: 'buyer', compareAt: null });
  });

  it('a sale percentage is off the catalogue price, not the buyer price (U2.2)', () => {
    const acme = book(org(0));
    const sale = book(EVERYONE, { type: 'sale' });
    const r = resolve([acme, sale], [base100, percent(acme, '10', { productId: P1 }), percent(sale, '-10')]);
    expect(r.price).toMatchObject({ amount: '90.0000', source: 'sale', compareAt: '110.0000' });
  });

  it('a buyer sale cell outranks an everyone sale row', () => {
    const everyoneSale = book(EVERYONE, { type: 'sale' });
    const acmeSale = book(org(0), { type: 'sale' });
    const r = resolve(
      [everyoneSale, acmeSale],
      [base100, fixed(everyoneSale, '80', { productId: P1 }), fixed(acmeSale, '85', { categoryId: SCREWS })],
    );
    expect(r.price).toMatchObject({ amount: '85.0000', source: 'sale', compareAt: '100.0000' });
  });
});

// ---------------------------------------------------------------------------
// Properties over every valid configuration
// ---------------------------------------------------------------------------

const KINDS_CAT_FIRST: SelectionKind[] = ['variant', 'product', 'category_attribute', 'category', 'attribute', 'all'];

function validConfigurations(): PrecedenceConfig[] {
  const out: PrecedenceConfig[] = [];
  for (const categoryBeforeAttribute of [true, false]) {
    const kinds = categoryBeforeAttribute
      ? KINDS_CAT_FIRST
      : ['variant', 'product', 'category_attribute', 'attribute', 'category', 'all'];
    const walk = (o: number, g: number, acc: CellCode[]) => {
      if (o === 6 && g === 6) {
        for (const depthMode of ['within_cell', 'nearest_organization_first'] as const) {
          const config: PrecedenceConfig = { cells: [...acc], categoryBeforeAttribute, depthMode };
          if (validatePrecedence(config).valid) out.push(config);
        }
        return;
      }
      if (o < 6) walk(o + 1, g, [...acc, `org.${kinds[o]!}` as CellCode]);
      if (g < 6) walk(o, g + 1, [...acc, `group.${kinds[g]!}` as CellCode]);
    };
    walk(0, 0, []);
  }
  return out;
}

const SELECTIONS: Record<SelectionKind, Partial<BookRow>> = {
  variant: { productId: P5, variantId: P5R },
  product: { productId: P5 },
  category_attribute: { categoryId: SCREWS, attributeKey: 'color', attributeValue: 'red' },
  category: { categoryId: SCREWS },
  attribute: { attributeKey: 'color', attributeValue: 'red' },
  all: {},
};

describe('book resolver — properties over all 266 configurations', () => {
  const configs = validConfigurations();
  // Every buyer cell populated, organization cells at depth 0 and 1.
  const own = book(org(0), { id: 'book-own' });
  const parent = book(org(1), { id: 'book-parent' });
  const group = book(GROUP, { id: 'book-group' });
  const cellRows: Array<{ row: BookRow; cell: CellCode; depth: number }> = [];
  let p = 1;
  for (const kind of KINDS_CAT_FIRST) {
    for (const [b, depth] of [[own, 0], [parent, 1]] as const) {
      cellRows.push({ row: percent(b, `-${p++}`, SELECTIONS[kind]), cell: `org.${kind}`, depth });
    }
    cellRows.push({ row: percent(group, `-${p++}`, SELECTIONS[kind]), cell: `group.${kind}`, depth: 0 });
  }
  const baseRow = fixed(BASE, '80', { productId: P5 });
  const l = line({ productId: P5, variantId: P5R });

  function expectedWinner(config: PrecedenceConfig, candidates: typeof cellRows): string {
    const rank = (cell: CellCode) => config.cells.indexOf(cell);
    const key = (c: (typeof cellRows)[number]): [number, number] =>
      config.depthMode === 'nearest_organization_first'
        ? c.cell.startsWith('org.')
          ? [c.depth, rank(c.cell)]
          : [Number.MAX_SAFE_INTEGER, rank(c.cell)]
        : [rank(c.cell), c.depth];
    return [...candidates].sort((a, b) => {
      const [a1, a2] = key(a);
      const [b1, b2] = key(b);
      return a1 - b1 || a2 - b2;
    })[0]!.row.id;
  }

  it('enumerates exactly the 266 valid configurations', () => {
    expect(configs).toHaveLength(266);
  });

  it('the populated cell with the smallest rank wins (depth-adjusted under AF-N)', () => {
    for (const config of configs) {
      const r = resolve([own, parent, group], [baseRow, ...cellRows.map((c) => c.row)], l, config);
      expect(r.buyer?.rowId).toBe(expectedWinner(config, cellRows));
    }
  });

  it('removing a row that does not win never changes the answer, and the answer is deterministic', () => {
    for (const config of configs) {
      const all = [baseRow, ...cellRows.map((c) => c.row)];
      const full = resolve([own, parent, group], all, l, config);
      expect(resolve([own, parent, group], [...all].reverse(), l, config)).toEqual(full);
      for (const loser of cellRows.filter((c) => c.row.id !== full.buyer?.rowId)) {
        const without = resolve([own, parent, group], all.filter((r) => r.id !== loser.row.id), l, config);
        expect(without.price).toEqual(full.price);
      }
    }
  });
});
