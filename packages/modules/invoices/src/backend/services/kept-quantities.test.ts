import { describe, expect, it } from 'vitest';
import { keptOrderLines } from './kept-quantities.js';

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
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'a', quantity: 1 }])).toEqual([
      { item: line('a', 3), quantity: 2 },
      { item: line('b', 1), quantity: 1 },
    ]);
  });

  it('drops a line returned in full', () => {
    expect(keptOrderLines([line('a', 3), line('b', 1)], [{ orderItemId: 'b', quantity: 1 }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });

  it('sums two returns of one line, and never keeps less than nothing', () => {
    expect(
      keptOrderLines(
        [line('a', 3)],
        [
          { orderItemId: 'a', quantity: 2 },
          { orderItemId: 'a', quantity: 2 },
        ],
      ),
    ).toEqual([]);
  });

  it('ignores a returned quantity for a line the order does not have', () => {
    expect(keptOrderLines([line('a', 3)], [{ orderItemId: 'z', quantity: 1 }])).toEqual([
      { item: line('a', 3), quantity: 3 },
    ]);
  });
});
