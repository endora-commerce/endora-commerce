import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook, type PriceBookRow } from '@endora-commerce/contracts';
import { BOOKS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Paging by line (feature 161, T062; FR-015): pages of 50, 100 or 200 lines
 * from `GET …/lines`, page numbers and the total line count, a product's
 * variants on its page, search and kind sent to the server, edits kept across
 * pages; on a non-base book a save past 5 000 rows refused before it is sent.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, gridCell, lineHeaders, lineRequests } = await import('../../helpers/price-book-grid');

const product = (i: number) => ({
  id: `00000000-0000-4000-8000-0000001640${i.toString(16).padStart(2, '0')}`,
  sku: `S-${String(i).padStart(3, '0')}`,
  name: `Screw ${String(i).padStart(3, '0')}`,
});

const ROWS: PriceBookRow[] = [];
for (let i = 1; i <= 120; i += 1) {
  ROWS.push(mkRow({ product: product(i), price: { type: 'fixed', amount: `${i}.0000` } }));
}
// Product 51 — first of page 2 at 50 a page — carries two variant lines.
ROWS.push(mkRow({ product: product(51), variant: { id: '00000000-0000-4000-8000-000000164a01', sku: 'S-051-A' }, price: { type: 'fixed', amount: '1.0000' } }));
ROWS.push(mkRow({ product: product(51), variant: { id: '00000000-0000-4000-8000-000000164a02', sku: 'S-051-B' }, price: { type: 'fixed', amount: '2.0000' } }));

let book: PriceBook;

beforeEach(() => {
  book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1], rowCount: ROWS.length });
  serveBook(api, { book, lines: linesOf(ROWS) });
});

async function open(): Promise<void> {
  mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: PLATFORM_ADMIN });
  await screen.findByRole('grid');
}

describe('price-book grid — paging by line', () => {
  it('pages 50 lines at a time with the total and page numbers, a product’s variants on its page', async () => {
    const user = userEvent.setup();
    await open();
    expect(lineRequests(api).at(-1)!.get('pageSize')).toBe('50');
    expect(screen.getByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '121');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());
    expect(lineRequests(api).at(-1)!.get('page')).toBe('2');
    const headers = lineHeaders();
    expect(headers[0]).toContain('Screw 051');
    expect(headers[1]).toContain('S-051-A');
    expect(headers[2]).toContain('S-051-B');
    await user.selectOptions(screen.getByLabelText('Rows per page:'), '200');
    await waitFor(() => expect(screen.getByText('Showing 1–120 of 120')).toBeInTheDocument());
    expect(lineRequests(api).at(-1)!.get('page')).toBe('1');
    expect(lineRequests(api).at(-1)!.get('pageSize')).toBe('200');
    expect([...screen.getByLabelText('Rows per page:').querySelectorAll('option')].map((o) => o.textContent)).toEqual(['50', '100', '200']);
  });

  it('sends the search and the kind to the server', async () => {
    const user = userEvent.setup();
    await open();
    await user.type(screen.getByRole('searchbox', { name: 'Search lines' }), 'screw 01');
    await waitFor(() => expect(lineRequests(api).at(-1)!.get('search')).toBe('screw 01'));
    await user.selectOptions(screen.getByLabelText('Line kind'), 'variant');
    await waitFor(() => expect(lineRequests(api).at(-1)!.getAll('kind')).toEqual(['variant']));
    expect(lineRequests(api).at(-1)!.get('page')).toBe('1');
  });

  it('keeps an edit across pages and shows it again on return', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(gridCell('Screw 002', 1));
    await user.keyboard('99{Enter}');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Page 2 of 3')).toBeInTheDocument());
    await user.click(gridCell('Screw 060', 1));
    await user.keyboard('66{Enter}');
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(screen.getByText('Page 1 of 3')).toBeInTheDocument());
    expect(gridCell('Screw 002', 1)).toHaveTextContent('99.00');
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 2');
  });

  it('refuses before sending a save that would take a non-base book past 5 000 rows', async () => {
    const user = userEvent.setup();
    book = priceBookSchema.parse({ ...book, rowCount: 4999, tierStarts: [1, 10] });
    serveBook(api, { book, lines: linesOf(ROWS) });
    await open();
    await user.click(gridCell('Screw 001', 10));
    await user.keyboard('1{Enter}');
    await user.click(gridCell('Screw 002', 10));
    await user.keyboard('2{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(await screen.findByText('This book would hold 5001 price rows; a price book holds at most 5000.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('price-book grid — a picked product already in the book (Checkpoint 5 review)', () => {
  it('asks the server once, adds only the new products and opens the one already priced', async () => {
    const user = userEvent.setup();
    serveBook(api, {
      book,
      lines: linesOf(ROWS),
      products: [
        { id: product(60).id, sku: product(60).sku, slug: 's-060', name: { 'en-US': product(60).name }, status: 'active', type: 'simple' },
        { id: '00000000-0000-4000-8000-000000164fff', sku: 'NEW-1', slug: 'new-1', name: { 'en-US': 'Brand new' }, status: 'active', type: 'simple' },
      ],
    });
    await open();
    // Screw 060 is on page 2, not loaded: the browser cannot know it is a line.
    await user.click(screen.getByRole('button', { name: 'Add lines' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Products…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Select Screw 060' })).not.toBeDisabled());
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Screw 060' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select Brand new' }));
    await user.click(within(dialog).getByRole('button', { name: 'Add 2' }));
    const memberships = api.get.mock.calls.map(([url]) => url as string).filter((url) => url.includes('/product-lines'));
    expect(memberships).toHaveLength(1);
    expect(new URLSearchParams(memberships[0]!.split('?')[1]).get('productIds')!.split(',').sort()).toEqual(
      [product(60).id, '00000000-0000-4000-8000-000000164fff'].sort(),
    );
    expect(await screen.findByText('Already in this book, not added again: Screw 060.')).toBeInTheDocument();
    const headers = lineHeaders();
    expect(headers.filter((h) => h.includes('Brand new'))).toHaveLength(1);
    expect(headers.some((h) => h.includes('Screw 060'))).toBe(false);
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 1');
    // Its price is never overwritten; the operator is taken to it instead.
    await user.click(screen.getByRole('button', { name: 'Open Screw 060' }));
    await waitFor(() => expect(lineRequests(api).at(-1)!.get('search')).toBe('S-060'));
    await waitFor(() => expect(lineHeaders().some((h) => h.includes('Screw 060'))).toBe(true));
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('price-book grid — opened on a line (161 US5 row links)', () => {
  it('searches what the address names, so a link can open a row where it is', async () => {
    mountScreen({ path: `/price-lists/${book.id}?tab=prices&search=S-060`, session: PLATFORM_ADMIN });
    await screen.findByRole('grid');
    expect(lineRequests(api)[0]!.get('search')).toBe('S-060');
    expect(screen.getByRole('searchbox', { name: 'Search lines' })).toHaveValue('S-060');
  });
});
