import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, PLATFORM_ADMIN, SALES_REP_ACME } from '../../helpers/price-book-fixtures';

/**
 * Variant lines and the cell detail (feature 161, T060; FR-009, FR-010): a
 * product line expands to every variant the catalogue knows, an empty variant
 * cell says what its product line gives; the cell detail sets a window that
 * does not fit the shared columns, shows what an empty cell inherits, and
 * clears a cell.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');
const { B, serveBook, linesOf, mkRow, gridCell, lineHeaders, PRODUCTS, VARIANTS } = await import('../../helpers/price-book-grid');

const STORED = [
  mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } }),
  mkRow({ product: PRODUCTS.P1, variant: VARIANTS.V1, price: { type: 'fixed', amount: '75.0000' } }),
  mkRow({ product: PRODUCTS.P2, price: { type: 'fixed', amount: '45.0000' } }),
];

let book: PriceBook;

beforeEach(() => {
  book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1], rowCount: STORED.length });
  serveBook(api, {
    book,
    lines: linesOf(STORED),
    variants: { [PRODUCTS.P1.id]: [VARIANTS.V1, VARIANTS.V2] },
  });
});

async function open() {
  const mounted = mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: PLATFORM_ADMIN });
  await screen.findByRole('grid');
  return mounted;
}

describe('price-book grid — variants', () => {
  it('expands a product line to every variant of the catalogue, the empty ones saying what they take', async () => {
    const user = userEvent.setup();
    await open();
    expect(lineHeaders().filter((h) => h.includes('P1-RED'))).toEqual([expect.stringContaining('P1-RED-L')]);
    await user.click(gridCell('Screws 0200', 1));
    await user.click(screen.getByRole('button', { name: 'Show variants' }));
    await waitFor(() => expect(lineHeaders().some((h) => h.includes('P1-RED-XL'))).toBe(true));
    const headers = lineHeaders();
    expect(headers.findIndex((h) => h.includes('P1-RED-XL'))).toBe(headers.findIndex((h) => h.includes('Screws 0200')) + 2);
    expect(gridCell('P1-RED-XL', 1)).toHaveTextContent('as product: -20%');
    // A variant shown is not an unsaved change.
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 0');
    await user.click(gridCell('P1-RED-XL', 1));
    await user.keyboard('70{Enter}');
    expect(gridCell('P1-RED-XL', 1)).toHaveTextContent('70.00');
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 1');
  });
});

describe('price-book grid — variants without catalog:read', () => {
  it('shows the priced variants and offers no expansion, which needs the catalogue’s read', async () => {
    mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: SALES_REP_ACME });
    await screen.findByRole('grid');
    expect(lineHeaders().some((h) => h.includes('P1-RED-L'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Show variants' })).toBeNull();
  });
});

describe('price-book grid — the cell detail', () => {
  it('sets a window that does not fit the columns, then saves it as such', async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValue({ data: { version: book.version + 1, rows: [] } });
    const { container } = await open();
    await user.click(gridCell('Screws 0300', 1));
    await user.click(screen.getByRole('button', { name: 'Cell details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Screws 0300, from 1' });
    await expectNoAxeViolations(container);
    await user.clear(within(dialog).getByLabelText('Price'));
    await user.type(within(dialog).getByLabelText('Price'), '42');
    await user.clear(within(dialog).getByLabelText('From quantity'));
    await user.type(within(dialog).getByLabelText('From quantity'), '25');
    await user.type(within(dialog).getByLabelText('To quantity'), '49');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(gridCell('Screws 0300', 25)).toHaveTextContent('42.00');
    expect(gridCell('Screws 0300', 25)).toHaveTextContent('25–49');
    // The row left its old start.
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('not priced here');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put.mock.calls[0]![0]).toBe(`${B}/${book.id}/rows`);
    // The row moves: its old start is deleted and the window is written anew.
    const body = api.put.mock.calls[0]![1] as { upsert: Array<Record<string, unknown>>; delete: string[] };
    expect(body.upsert).toEqual([{ selection: { productId: PRODUCTS.P2.id }, minQuantity: 25, maxQuantity: 49, price: { type: 'fixed', amount: '42.0000' } }]);
    expect(body.delete).toEqual([STORED[2]!.id]);
  });

  it('shows what an empty cell inherits, links the explanation, and clears a cell', async () => {
    const user = userEvent.setup();
    book = priceBookSchema.parse({ ...book, tierStarts: [1, 10] });
    serveBook(api, { book, lines: linesOf(STORED) });
    await open();
    await user.click(gridCell('Screws 0200', 10));
    await user.click(screen.getByRole('button', { name: 'Cell details' }));
    const dialog = await screen.findByRole('dialog', { name: 'Screws 0200, from 10' });
    expect(within(dialog).getByText('Empty: inherits from 1: -20%')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Why this price?' })).toHaveAttribute(
      'href',
      `/price-lists/explain?productId=${PRODUCTS.P1.id}&bookId=${book.id}`,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(gridCell('Screws 0200', 1));
    await user.click(screen.getByRole('button', { name: 'Cell details' }));
    const filled = await screen.findByRole('dialog', { name: 'Screws 0200, from 1' });
    await user.click(within(filled).getByRole('button', { name: 'Clear cell' }));
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('not priced here');
  });
});
