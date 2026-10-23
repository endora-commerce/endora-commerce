import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { priceBookSchema } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * The grid's layout (feature 161, T057; FR-006, FR-007): lines from the most
 * general to the most specific, one column per tier start, each price's kind
 * in words and an icon, the percentage's reference, and the note that sends
 * the operator to the precedence.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, gridCell, lineHeaders, PRODUCTS, VARIANTS } = await import('../../helpers/price-book-grid');

const MIXED = [
  mkRow({ product: PRODUCTS.P2, price: { type: 'amount', amount: '3.0000' } }),
  mkRow({ product: PRODUCTS.P1, min: 1, max: 9, price: { type: 'percent', percent: '-20.00' } }),
  mkRow({ product: PRODUCTS.P1, min: 10, price: { type: 'percent', percent: '-25.00' } }),
  mkRow({ product: PRODUCTS.P1, variant: VARIANTS.V1, price: { type: 'fixed', amount: '75.0000' } }),
  mkRow({ category: 'screws', color: 'red', price: { type: 'fixed', amount: '120.0000' } }),
  mkRow({ category: 'screws', price: { type: 'percent', percent: '-10.00' } }),
  mkRow({ color: 'red', price: { type: 'percent', percent: '5.00' } }),
  mkRow({ all: true, price: { type: 'percent', percent: '-2.00' } }),
];

function open(book = BOOKS.L2, language: 'en' | 'pl' = 'en') {
  const served = priceBookSchema.parse({ ...book, tierStarts: [1, 10], rowCount: MIXED.length });
  serveBook(api, { book: served, lines: linesOf(MIXED) });
  return mountScreen({ path: `/price-lists/${served.id}?tab=prices`, session: PLATFORM_ADMIN, language });
}

describe('price-book grid — layout', () => {
  it('orders the lines from all products to variants, a variant under its product', async () => {
    open();
    await screen.findByRole('grid');
    const headers = lineHeaders();
    const at = (text: string): number => headers.findIndex((h) => h.includes(text));
    expect(at('All products')).toBe(0);
    expect(at('Color: Red')).toBe(1);
    expect(at('Screws · Color: Red')).toBe(3);
    expect(headers[2]).toContain('Screws');
    expect(at('Screws 0200')).toBe(4);
    expect(at('P1-RED-L')).toBe(5);
    expect(at('Screws 0300')).toBe(6);
  });

  it('has one column per tier start of the book', async () => {
    open();
    const grid = await screen.findByRole('grid');
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Line', 'From 1', 'From 10']);
  });

  it('states every price’s kind in words, a percentage with its reference', async () => {
    open();
    await screen.findByRole('grid');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('-20%');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('of catalogue price');
    expect(gridCell('Screws · Color: Red', 1)).toHaveTextContent('120.00');
    expect(gridCell('Screws · Color: Red', 1)).toHaveTextContent('fixed price');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('+3.00');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('adjustment');
    // An icon beside the words, hidden from assistive technology.
    expect(gridCell('Screws 0200', 1).querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('reads a catalogue book’s percentages as of base', async () => {
    open(BOOKS.L1);
    await screen.findByRole('grid');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('of base');
  });

  it('says that the precedence decides between lines, and links it', async () => {
    open();
    await screen.findByRole('grid');
    expect(screen.getByText(/Which line wins for a buyer is decided by the price precedence/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See the price precedence' })).toHaveAttribute('href', '/price-lists/display-modes#precedence');
  });

  it('has no axe violations, and speaks Polish', async () => {
    const { container, unmount } = open();
    await screen.findByRole('grid');
    await expectNoAxeViolations(container);
    unmount();
    open(BOOKS.L2, 'pl');
    const grid = await screen.findByRole('grid');
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Linia', 'Od 1', 'Od 10']);
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('ceny katalogowej');
  });
});
