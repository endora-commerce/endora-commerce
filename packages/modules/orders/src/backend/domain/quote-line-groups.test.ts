import { describe, expect, it } from 'vitest';
import {
  adminLayout,
  basketLayout,
  carryQuoteGrouping,
  layoutShape,
  planAdminLineGrouping,
  type OrderLineForCarry,
  type OrderLineLayout,
  type QuoteLineForCarry,
} from './quote-line-groups.js';

/**
 * Feature 159 (US4, US5; `specs/159-quote-request-item-groups/contracts/orders-api.md` §1–§2)
 * — the pure layout of a new order's lines: carried from the quote it was
 * placed from, laid out by the administrator who created it, or the basket's
 * own order.
 */

const P1 = '00000000-0000-4000-8000-000000000101';
const P2 = '00000000-0000-4000-8000-000000000102';
const P3 = '00000000-0000-4000-8000-000000000103';
const P4 = '00000000-0000-4000-8000-000000000104';
const V1 = '00000000-0000-4000-8000-000000000201';
const HALL_A = { id: '00000000-0000-4000-8000-00000000a001', name: 'Hall A', position: 0 };
const HALL_B = { id: '00000000-0000-4000-8000-00000000a002', name: 'Hall B', position: 1 };

const quoteLine = (
  productId: string,
  agreedUnitPrice: string | null,
  group: typeof HALL_A | null,
  position: number,
  variantId: string | null = null,
  quantity?: number,
): QuoteLineForCarry => ({ productId, variantId, agreedUnitPrice, group, position, ...(quantity !== undefined ? { quantity } : {}) });

const orderLine = (
  key: string,
  productId: string,
  unitPrice: string,
  variantId: string | null = null,
  quantity?: number,
): OrderLineForCarry => ({
  key,
  productId,
  variantId,
  unitPrice,
  ...(quantity !== undefined ? { quantity } : {}),
});

/** The layout as a readable list: `[section, key, position]` in display order. */
function display(layout: OrderLineLayout): Array<[string, string, number]> {
  const out: Array<[string, string, number]> = [];
  const names = new Map(layout.groups.map((group) => [group.sourceId, group.name]));
  const sections = [...layout.groups.map((group) => group.sourceId), null];
  for (const section of sections) {
    const keys = [...layout.lines.entries()]
      .filter(([, line]) => line.groupSourceId === section)
      .sort(([, a], [, b]) => a.position - b.position);
    for (const [key, line] of keys) out.push([section === null ? '-' : names.get(section)!, key, line.position]);
  }
  return out;
}

describe('carryQuoteGrouping', () => {
  it('an unchanged basket takes the quote groups, their order and each group’s line order (SC-003)', () => {
    // Quote display order: Hall A [P3, P1], Hall B [P2], ungrouped [P4].
    const quote = [
      quoteLine(P3, '30', HALL_A, 0),
      quoteLine(P1, '10', HALL_A, 1),
      quoteLine(P2, '20', HALL_B, 0),
      quoteLine(P4, '40', null, 0),
    ];
    // The basket holds them in another order.
    const order = [orderLine('0', P1, '10'), orderLine('1', P2, '20'), orderLine('2', P3, '30'), orderLine('3', P4, '40')];
    const layout = carryQuoteGrouping(quote, order);
    expect(layout.groups).toEqual([
      { sourceId: HALL_A.id, name: 'Hall A', position: 0 },
      { sourceId: HALL_B.id, name: 'Hall B', position: 1 },
    ]);
    expect(display(layout)).toEqual([
      ['Hall A', '2', 0],
      ['Hall A', '0', 1],
      ['Hall B', '1', 0],
      ['-', '3', 0],
    ]);
  });

  it('matches by product, variant and agreed price first — a duplicated product in two groups keeps each its own', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0, V1), quoteLine(P1, '12', HALL_B, 0, V1)];
    // The basket lists the Hall B line first.
    const order = [orderLine('x', P1, '12.00', V1), orderLine('y', P1, '10.0000', V1)];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Hall A', 'y', 0],
      ['Hall B', 'x', 0],
    ]);
  });

  it('one product split over two groups at the same price: quantity decides, whatever the basket order (N-31)', () => {
    const GROUP_Y = { id: '00000000-0000-4000-8000-00000000b001', name: 'Y', position: 0 };
    const GROUP_Z = { id: '00000000-0000-4000-8000-00000000b002', name: 'Z', position: 1 };
    const quote = [quoteLine(P1, '10', GROUP_Y, 0, null, 5), quoteLine(P1, '10', GROUP_Z, 0, null, 3)];
    for (const order of [
      [orderLine('five', P1, '10.00', null, 5), orderLine('three', P1, '10.00', null, 3)],
      [orderLine('three', P1, '10.00', null, 3), orderLine('five', P1, '10.00', null, 5)],
    ]) {
      expect(display(carryQuoteGrouping(quote, order))).toEqual([
        ['Y', 'five', 0],
        ['Z', 'three', 0],
      ]);
    }
  });

  it('a split line whose quantity changed in the basket still lands in a group of its product', () => {
    const GROUP_Y = { id: '00000000-0000-4000-8000-00000000b001', name: 'Y', position: 0 };
    const GROUP_Z = { id: '00000000-0000-4000-8000-00000000b002', name: 'Z', position: 1 };
    const quote = [quoteLine(P1, '10', GROUP_Y, 0, null, 5), quoteLine(P1, '10', GROUP_Z, 0, null, 3)];
    // The 5 became 6; the 3 is untouched and keeps Z, so the 6 takes Y.
    const order = [orderLine('six', P1, '10', null, 6), orderLine('three', P1, '10', null, 3)];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Y', 'six', 0],
      ['Z', 'three', 0],
    ]);
  });

  it('an exact match is never taken by an earlier line’s fallback', () => {
    // Line x (price changed) would fall back to the first P1 quote line — the
    // one line y matches exactly — if fallbacks ran before every exact match.
    const quote = [quoteLine(P1, '10', HALL_A, 0), quoteLine(P1, '12', HALL_B, 0)];
    const order = [orderLine('x', P1, '15'), orderLine('y', P1, '10')];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Hall A', 'y', 0],
      ['Hall B', 'x', 0],
    ]);
  });

  it('falls back to product and variant when the price no longer matches', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0), quoteLine(P2, null, HALL_B, 0)];
    const order = [orderLine('a', P2, '22'), orderLine('b', P1, '11')];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Hall A', 'b', 0],
      ['Hall B', 'a', 0],
    ]);
  });

  it('a variant is part of the match', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0, V1)];
    const order = [orderLine('a', P1, '10')];
    const layout = carryQuoteGrouping(quote, order);
    expect(layout.groups).toEqual([]);
    expect(display(layout)).toEqual([['-', 'a', 0]]);
  });

  it('an unmatched line is ungrouped, after the matched ungrouped lines, in basket order (FR-051)', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0), quoteLine(P2, '20', null, 0)];
    const order = [orderLine('new-1', P3, '5'), orderLine('p1', P1, '10'), orderLine('new-2', P4, '6'), orderLine('p2', P2, '20')];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Hall A', 'p1', 0],
      ['-', 'p2', 0],
      ['-', 'new-1', 1],
      ['-', 'new-2', 2],
    ]);
  });

  it('a quote line is claimed once — a second order line of the same product is unmatched', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0)];
    const order = [orderLine('a', P1, '10'), orderLine('b', P1, '10')];
    expect(display(carryQuoteGrouping(quote, order))).toEqual([
      ['Hall A', 'a', 0],
      ['-', 'b', 0],
    ]);
  });

  it('drops a group no order line came from and renumbers the rest (FR-034)', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0), quoteLine(P2, '20', HALL_B, 0)];
    const order = [orderLine('b', P2, '20')];
    const layout = carryQuoteGrouping(quote, order);
    expect(layout.groups).toEqual([{ sourceId: HALL_B.id, name: 'Hall B', position: 0 }]);
    expect(display(layout)).toEqual([['Hall B', 'b', 0]]);
  });

  it('orders the groups by their quote position, not by the order the lines arrive in', () => {
    const quote = [quoteLine(P2, '20', HALL_B, 0), quoteLine(P1, '10', HALL_A, 0)];
    const layout = carryQuoteGrouping(quote, [orderLine('b', P2, '20'), orderLine('a', P1, '10')]);
    expect(layout.groups.map((group) => group.name)).toEqual(['Hall A', 'Hall B']);
  });

  it('records without group and position (an old stub, an overlay) carry nothing — basket order only', () => {
    const quote: QuoteLineForCarry[] = [
      { productId: P2, variantId: null, agreedUnitPrice: '20' },
      { productId: P1, variantId: null, agreedUnitPrice: '10' },
    ];
    const order = [orderLine('a', P1, '10'), orderLine('b', P2, '20')];
    const layout = carryQuoteGrouping(quote, order);
    expect(layout).toEqual(basketLayout(order));
    expect(display(layout)).toEqual([
      ['-', 'a', 0],
      ['-', 'b', 1],
    ]);
  });

  it('a quote never grouped gives its line order to the order, and no group', () => {
    const quote = [quoteLine(P2, '20', null, 0), quoteLine(P1, '10', null, 1)];
    const layout = carryQuoteGrouping(quote, [orderLine('a', P1, '10'), orderLine('b', P2, '20')]);
    expect(layout.groups).toEqual([]);
    expect(display(layout)).toEqual([
      ['-', 'b', 0],
      ['-', 'a', 1],
    ]);
  });
});

describe('basketLayout', () => {
  it('positions 0…k-1 in basket order, no group (I-O3)', () => {
    const layout = basketLayout([orderLine('a', P1, '1'), orderLine('b', P2, '2')]);
    expect(layout.groups).toEqual([]);
    expect([...layout.lines.entries()]).toEqual([
      ['a', { groupSourceId: null, position: 0 }],
      ['b', { groupSourceId: null, position: 1 }],
    ]);
  });
});

describe('planAdminLineGrouping', () => {
  it('keeps every request line, in request order, with its product, variant, quantity and group key', () => {
    const grouping = planAdminLineGrouping(
      [
        { key: 'g1', name: 'Hall A' },
        { key: 'g2', name: 'Hall B' },
      ],
      [
        { productId: P1, quantity: 5, groupKey: 'g2' },
        { productId: P2, variantId: V1, quantity: 1, groupKey: 'g1' },
        { productId: P3, quantity: 2 },
      ],
    );
    expect(grouping.groups).toEqual([
      { key: 'g1', name: 'Hall A' },
      { key: 'g2', name: 'Hall B' },
    ]);
    expect(grouping.lines).toEqual([
      { productId: P1, variantId: null, quantity: 5, groupKey: 'g2' },
      { productId: P2, variantId: V1, quantity: 1, groupKey: 'g1' },
      { productId: P3, variantId: null, quantity: 2, groupKey: null },
    ]);
  });

  it('the same product and variant on lines of two groups is no conflict — each line keeps its own group (N-31)', () => {
    const grouping = planAdminLineGrouping(
      [
        { key: 'g1', name: 'Hall A' },
        { key: 'g2', name: 'Hall B' },
      ],
      [
        { productId: P1, quantity: 5, groupKey: 'g1' },
        { productId: P1, quantity: 3, groupKey: 'g2' },
        { productId: P1, quantity: 1 },
      ],
    );
    expect(grouping.lines.map((line) => line.groupKey)).toEqual(['g1', 'g2', null]);
  });
});

describe('adminLayout', () => {
  const grouping = planAdminLineGrouping(
    [
      { key: 'g1', name: 'Hall A' },
      { key: 'g2', name: 'Hall B' },
      { key: 'g3', name: 'Empty' },
    ],
    [
      { productId: P1, quantity: 1, groupKey: 'g2' },
      { productId: P2, quantity: 1, groupKey: 'g1' },
      { productId: P3, quantity: 1 },
      { productId: P4, quantity: 1, groupKey: 'g1' },
    ],
  );

  it('lays the order out as the request did; a group no line names is not created (D2)', () => {
    const order = [orderLine('0', P1, '1', null, 1), orderLine('1', P2, '1', null, 1), orderLine('2', P3, '1', null, 1), orderLine('3', P4, '1', null, 1)];
    const layout = adminLayout(order, grouping);
    expect(layout.groups).toEqual([
      { sourceId: 'g1', name: 'Hall A', position: 0 },
      { sourceId: 'g2', name: 'Hall B', position: 1 },
    ]);
    expect(display(layout)).toEqual([
      ['Hall A', '1', 0],
      ['Hall A', '3', 1],
      ['Hall B', '0', 0],
      ['-', '2', 0],
    ]);
  });

  it('an order line the request did not name is ungrouped, last', () => {
    const order = [
      orderLine('extra', '00000000-0000-4000-8000-000000000999', '1', null, 1),
      orderLine('0', P1, '1', null, 1),
      orderLine('2', P3, '1', null, 1),
    ];
    expect(display(adminLayout(order, grouping))).toEqual([
      ['Hall B', '0', 0],
      ['-', '2', 0],
      ['-', 'extra', 1],
    ]);
  });

  it('one product split over two groups: each basket line takes the group of its own request line (N-31)', () => {
    const split = planAdminLineGrouping(
      [
        { key: 'y', name: 'Group Y' },
        { key: 'z', name: 'Group Z' },
      ],
      [
        { productId: P1, quantity: 5, groupKey: 'y' },
        { productId: P2, quantity: 1, groupKey: 'z' },
        { productId: P1, quantity: 3, groupKey: 'z' },
      ],
    );
    // The basket in request order (one line per request line).
    const inOrder = [orderLine('0', P1, '10', null, 5), orderLine('1', P2, '10', null, 1), orderLine('2', P1, '10', null, 3)];
    expect(display(adminLayout(inOrder, split))).toEqual([
      ['Group Y', '0', 0],
      ['Group Z', '1', 0],
      ['Group Z', '2', 1],
    ]);
    // A basket answered in another order still pairs by quantity.
    const shuffled = [orderLine('a', P1, '10', null, 3), orderLine('b', P2, '10', null, 1), orderLine('c', P1, '10', null, 5)];
    expect(display(adminLayout(shuffled, split))).toEqual([
      ['Group Y', 'c', 0],
      ['Group Z', 'b', 0],
      ['Group Z', 'a', 1],
    ]);
  });
});

describe('layoutShape', () => {
  it('counts each group’s lines, never naming it — the audit entry’s `groups` (FR-081, D-288)', () => {
    const quote = [quoteLine(P1, '10', HALL_A, 0), quoteLine(P2, '20', HALL_A, 1), quoteLine(P3, '30', HALL_B, 0)];
    const layout = carryQuoteGrouping(quote, [orderLine('a', P1, '10'), orderLine('b', P2, '20'), orderLine('c', P3, '30')]);
    expect(layoutShape(layout)).toEqual([
      { lineCount: 2 },
      { lineCount: 1 },
    ]);
    expect(layoutShape(basketLayout([orderLine('a', P1, '1')]))).toEqual([]);
  });
});
