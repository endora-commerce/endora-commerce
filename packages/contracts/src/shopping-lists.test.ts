import { describe, expect, it } from 'vitest';
import { SHOPPING_LIST_AUTO_DEFAULT_NAME, isAutoDefaultShoppingList, toCartDroppedLines } from './shopping-lists.js';

/**
 * Feature 155 (FR-011, US4 #3) — a list's skipped items as the carts bridge's
 * `droppedLines`: one mapping both composition roots call, so production and the
 * test harness cannot answer a shopping-list append differently.
 */
describe('toCartDroppedLines', () => {
  it('a below-minimum skip says so, with the minimum it missed', () => {
    expect(
      toCartDroppedLines([{ productId: 'p-1', reason: 'below_minimum', minimum: 10 }]),
    ).toEqual([{ productId: 'p-1', productName: 'p-1', reason: 'below_minimum', minimum: 10 }]);
  });

  it('a below-minimum skip without a minimum carries none', () => {
    expect(toCartDroppedLines([{ productId: 'p-1', reason: 'below_minimum' }])).toEqual([
      { productId: 'p-1', productName: 'p-1', reason: 'below_minimum' },
    ]);
  });

  it('every other skip is not_purchasable, in input order', () => {
    expect(
      toCartDroppedLines([
        { productId: 'p-1', reason: 'product_archived' },
        { productId: 'p-2', reason: 'variant_unavailable' },
        { productId: 'p-3', reason: 'product_not_found' },
      ]),
    ).toEqual([
      { productId: 'p-1', productName: 'p-1', reason: 'not_purchasable' },
      { productId: 'p-2', productName: 'p-2', reason: 'not_purchasable' },
      { productId: 'p-3', productName: 'p-3', reason: 'not_purchasable' },
    ]);
  });
});

/**
 * Issue #751 (owner ruling on PR #760) — the list the platform creates for
 * every customer, while it is still the untouched default: the default flag
 * and the stored name together.
 */
describe('isAutoDefaultShoppingList', () => {
  it('is the default list still carrying the name the platform gave it', () => {
    expect(SHOPPING_LIST_AUTO_DEFAULT_NAME).toBe('Default');
    expect(isAutoDefaultShoppingList({ name: 'Default', isDefault: true })).toBe(true);
  });

  it('is not a renamed default, nor a list of that name that is not the default', () => {
    expect(isAutoDefaultShoppingList({ name: 'Biuro', isDefault: true })).toBe(false);
    expect(isAutoDefaultShoppingList({ name: 'default', isDefault: true })).toBe(false);
    expect(isAutoDefaultShoppingList({ name: 'Default', isDefault: false })).toBe(false);
  });
});
