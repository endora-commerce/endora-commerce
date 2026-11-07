import { describe, expect, it } from 'vitest';
import { restockDisposition, type RestockProductState } from './restock-product-state.js';

/**
 * Issue #468 — what a restock does with a queued back-in-stock subscription, from the
 * product's global state alone (product owner ruling, 2026-11-07).
 */
const NOW = new Date('2026-11-07T12:00:00.000Z');

function product(overrides: Partial<RestockProductState> = {}): RestockProductState {
  return {
    status: 'active',
    archivedAt: null,
    deletedAt: null,
    publishFrom: null,
    publishUntil: null,
    ...overrides,
  };
}

describe('restockDisposition (#468)', () => {
  it('sends for an active, live product with an open window', () => {
    expect(restockDisposition(product(), NOW)).toBe('send');
  });

  it('sends inside a bounded global window, both ends inclusive', () => {
    expect(restockDisposition(product({ publishFrom: NOW, publishUntil: NOW }), NOW)).toBe('send');
  });

  it('cancels when the product does not resolve', () => {
    expect(restockDisposition(null, NOW)).toBe('cancel');
  });

  it('cancels a deleted product, whatever else it says', () => {
    expect(restockDisposition(product({ deletedAt: NOW }), NOW)).toBe('cancel');
    expect(restockDisposition(product({ deletedAt: NOW, archivedAt: NOW, status: 'inactive' }), NOW)).toBe(
      'cancel',
    );
  });

  it('holds an archived product', () => {
    expect(restockDisposition(product({ archivedAt: NOW }), NOW)).toBe('hold');
  });

  it('holds a globally inactive product', () => {
    expect(restockDisposition(product({ status: 'inactive' }), NOW)).toBe('hold');
  });

  it('holds a product before or after its global publication window', () => {
    expect(restockDisposition(product({ publishFrom: new Date(NOW.getTime() + 1) }), NOW)).toBe('hold');
    expect(restockDisposition(product({ publishUntil: new Date(NOW.getTime() - 1) }), NOW)).toBe('hold');
  });

  it('treats an absent window (a record built without one) as open', () => {
    const { publishFrom: _f, publishUntil: _u, ...withoutWindow } = product();
    expect(restockDisposition(withoutWindow, NOW)).toBe('send');
  });
});
