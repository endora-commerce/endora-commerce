import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { BOOKS, PLATFORM_ADMIN, summaryOf } from '../../helpers/price-book-fixtures';

/**
 * The books that price the product directly (feature 161, T071; US3 scenario
 * 5; FR-021): read-only, each with its audience and the price it sets, linking
 * to the book and to "Why this price?"; an empty state.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountBasePricePanel } = await import('../../helpers/price-book-screen');
const { P5, B, basePrices, serveBasePrices } = await import('./base-price-fixture');

const ROW = '00000000-0000-4000-8000-000000162f01';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('books pricing the product', () => {
  it('lists each book with its audience and price, linked to the book and the explanation', async () => {
    serveBasePrices(api, basePrices(), [
      {
        ...summaryOf(BOOKS.L2),
        matches: [{ rowId: ROW, selectionKind: 'product', minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-20.00' } }],
      },
      {
        ...summaryOf(BOOKS.L1),
        matches: [{ rowId: ROW, selectionKind: 'variant', minQuantity: 10, maxQuantity: null, price: { type: 'fixed', amount: '75.0000' } }],
      },
    ]);
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    const list = await screen.findByRole('list', { name: 'Price books pricing this product' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByRole('link', { name: 'Acme screws' })).toHaveAttribute('href', `/price-lists/${BOOKS.L2.id}`);
    expect(items[0]).toHaveTextContent('Organizations · 1');
    expect(items[0]).toHaveTextContent('From 1: -20% of catalogue price');
    expect(items[1]).toHaveTextContent('Variant, from 10: 75.00 fixed price');
    expect(screen.getByRole('link', { name: 'Why this price?' })).toHaveAttribute('href', `/price-lists/explain?productId=${P5}`);
    const asked = api.get.mock.calls.map(([url]) => url as string).find((url) => url.split('?')[0] === B)!;
    expect(new URLSearchParams(asked.split('?')[1]).get('productId')).toBe(P5);
  });

  it('says when no book prices the product directly', async () => {
    serveBasePrices(api, basePrices(), []);
    mountBasePricePanel({ productId: P5, session: PLATFORM_ADMIN });
    expect(await screen.findByText('No price book prices this product directly.')).toBeInTheDocument();
  });
});
