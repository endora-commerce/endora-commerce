import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { priceBookSchema } from '@endora-commerce/contracts';
import { BOOKS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Inherited cells (feature 161, T058; FR-037, FR-009): an empty cell says what
 * the line's nearest lower tier gives at that quantity, or that the line does
 * not price it — never a zero; an empty variant cell says what its product
 * line gives.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, gridCell, PRODUCTS, VARIANTS } = await import('../../helpers/price-book-grid');

const ROWS = [
  mkRow({ product: PRODUCTS.P1, min: 1, max: 9, price: { type: 'percent', percent: '-20.00' } }),
  mkRow({ product: PRODUCTS.P1, min: 10, max: 99, price: { type: 'percent', percent: '-25.00' } }),
  mkRow({ product: PRODUCTS.P1, min: 100, price: { type: 'percent', percent: '-30.00' } }),
  mkRow({ product: PRODUCTS.P1, variant: VARIANTS.V1, min: 100, price: { type: 'fixed', amount: '60.0000' } }),
  mkRow({ category: 'screws', min: 1, max: 9, price: { type: 'percent', percent: '-10.00' } }),
  mkRow({ product: PRODUCTS.P2, min: 1, price: { type: 'fixed', amount: '45.0000' } }),
];

async function open(): Promise<void> {
  const book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1, 10, 100], rowCount: ROWS.length });
  serveBook(api, { book, lines: linesOf(ROWS) });
  mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: PLATFORM_ADMIN });
  await screen.findByRole('grid');
}

describe('price-book grid — inherited cells', () => {
  it('shows what the nearest lower tier gives', async () => {
    await open();
    expect(gridCell('Screws 0300', 10)).toHaveTextContent('inherits from 1: 45.00');
    expect(gridCell('Screws 0300', 100)).toHaveTextContent('inherits from 1: 45.00');
  });

  it('says the line does not price a quantity its tiers leave out, never zero', async () => {
    await open();
    const cell = gridCell(/^Screws(?! 0)/, 10);
    expect(cell).toHaveTextContent('not priced here');
    expect(within(cell).getByTitle('This line does not price this quantity.')).toBeInTheDocument();
    expect(cell.textContent).not.toMatch(/0[.,]00/);
  });

  it('says what an empty variant cell takes from its product line', async () => {
    await open();
    expect(gridCell('P1-RED-L', 1)).toHaveTextContent('as product: -20%');
    expect(gridCell('P1-RED-L', 10)).toHaveTextContent('as product: -25%');
    expect(gridCell('P1-RED-L', 100)).toHaveTextContent('60.00');
  });
});
