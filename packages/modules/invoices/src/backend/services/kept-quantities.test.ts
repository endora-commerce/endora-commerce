import { describe, expect, it } from 'vitest';
import { keptDiscount, keptOrderLines } from './kept-quantities.js';

/**
 * Issue #435 — an invoice issued after a return lists what the buyer kept
 * (product-owner ruling of 2026-11-07).
 */
const line = (id: string, quantity: number) => ({ id, quantity });

describe('keptOrderLines', () => {
  it('leaves every line as ordered when nothing came back', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [])).toEqual([
      { item: line('a', 3), quantity: 3 },
      { item: line('b', 1), quantity: 1 },
    ]);
  });

  it('takes the returned quantity off a line returned in part', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'a', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 2 },
      { item: line('b', 1), quantity: 1 },
    ]);
  });

  it('drops a line returned in full', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'b', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });

  it('sums two returns of one line, and never keeps less than nothing', () => {
    expect(
      keptOrderLines(
        [line('a', 3)],
        [
          { orderItemId: 'a', quantity: 2, discount: '0.00' },
          { orderItemId: 'a', quantity: 2, discount: '0.00' },
        ],
      ),
    ).toEqual([]);
  });

  it('ignores a returned quantity for a line the order does not have', () => {
    expect(keptOrderLines([line('a', 3)], [{ orderItemId: 'z', quantity: 1, discount: '0.00' }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });
});

/** Ruling Q3 of 2026-11-07 — the discount line carries only the kept goods' share. */
describe('keptDiscount', () => {
  const back = (discount: string) => ({ orderItemId: 'a', quantity: 1, discount });

  it('is the order discount when nothing came back', () => {
    expect(keptDiscount('6.94', [])).toBe('6.94');
  });

  it('is the order discount less what the returns carried back', () => {
    expect(keptDiscount('6.94', [back('2.31'), back('2.32')])).toBe('2.31');
  });

  it('is zero when the returns carried it all back, and never negative', () => {
    expect(keptDiscount('6.94', [back('2.31'), back('2.32'), back('2.31')])).toBe('0.00');
    expect(keptDiscount('1.00', [back('2.31')])).toBe('0.00');
  });

  it('is zero for an order without a discount', () => {
    expect(keptDiscount('0.00', [back('0.00')])).toBe('0.00');
  });
});
