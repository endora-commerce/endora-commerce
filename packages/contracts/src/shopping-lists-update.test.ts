import { describe, expect, it } from 'vitest';
import { LINE_QUANTITY_MAX, REQUEST_LINE_ITEMS_MAX } from './line-bounds.js';
import { renameShoppingListRequestSchema, updateShoppingListRequestSchema } from './shopping-lists.js';

/**
 * Issue #1251 — one *Save changes* on the storefront list page: the list's name and every
 * edited line quantity travel in one `PATCH /api/v1/shopping-lists/:id` body, written at once.
 */
const A = '00000000-0000-4000-8000-00000000a001';
const B = '00000000-0000-4000-8000-00000000a002';

describe('updateShoppingListRequestSchema', () => {
  it('accepts a name alone, the lines alone, or both', () => {
    expect(updateShoppingListRequestSchema.parse({ name: 'Site A' })).toEqual({ name: 'Site A' });
    expect(updateShoppingListRequestSchema.parse({ items: [{ id: A, quantity: 3 }] })).toEqual({
      items: [{ id: A, quantity: 3 }],
    });
    expect(
      updateShoppingListRequestSchema.parse({
        name: 'Site A',
        items: [
          { id: A, quantity: 3 },
          { id: B, quantity: LINE_QUANTITY_MAX },
        ],
      }).items,
    ).toHaveLength(2);
  });

  it('still accepts every body the rename schema accepts', () => {
    const body = renameShoppingListRequestSchema.parse({ name: 'Renamed' });
    expect(updateShoppingListRequestSchema.safeParse(body).success).toBe(true);
  });

  it.each([
    ['an empty body', {}],
    ['an empty name', { name: '' }],
    ['an unknown key', { name: 'A', isDefault: true }],
    ['a line twice', { items: [{ id: A, quantity: 1 }, { id: A, quantity: 2 }] }],
    ['a zero quantity', { items: [{ id: A, quantity: 0 }] }],
    ['a quantity past the bound', { items: [{ id: A, quantity: LINE_QUANTITY_MAX + 1 }] }],
    ['a line id that is not one', { items: [{ id: 'i1', quantity: 1 }] }],
    ['a line with a note', { items: [{ id: A, quantity: 1, note: 'x' }] }],
  ])('refuses %s', (_label, body) => {
    expect(updateShoppingListRequestSchema.safeParse(body).success).toBe(false);
  });

  it('bounds the lines at REQUEST_LINE_ITEMS_MAX', () => {
    const lines = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        quantity: 1,
      }));
    expect(updateShoppingListRequestSchema.safeParse({ items: lines(REQUEST_LINE_ITEMS_MAX) }).success).toBe(true);
    expect(updateShoppingListRequestSchema.safeParse({ items: lines(REQUEST_LINE_ITEMS_MAX + 1) }).success).toBe(false);
  });
});
