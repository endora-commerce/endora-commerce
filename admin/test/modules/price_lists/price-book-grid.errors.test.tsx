import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook } from '@endora-commerce/contracts';
import { BOOKS, PLATFORM_ADMIN } from '../../helpers/price-book-fixtures';

/**
 * Refusals and conflicts (feature 161, T061; FR-014, FR-016, SC-005): every
 * failing cell marked, the edits kept; a book changed by someone else refused
 * as stale, reloaded, the edits kept for re-applying; leaving with unsaved
 * changes asks first; inactive lines say why.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, apiError } = await import('../../helpers/price-book-screen');
const { B, serveBook, linesOf, mkRow, gridCell, lineHeaders, PRODUCTS } = await import('../../helpers/price-book-grid');

const STORED = [
  mkRow({ color: 'red', price: { type: 'percent', percent: '-3.00' }, inactiveReason: 'attribute_not_price_rule' }),
  mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } }),
  mkRow({ product: PRODUCTS.P2, price: { type: 'fixed', amount: '45.0000' } }),
  mkRow({ product: PRODUCTS.P3, price: { type: 'fixed', amount: '30.0000' }, targetDeleted: true, inactiveReason: 'target_deleted' }),
];

let book: PriceBook;

beforeEach(() => {
  book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1], rowCount: STORED.length });
  serveBook(api, { book, lines: linesOf(STORED) });
});

async function open(): Promise<void> {
  mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session: PLATFORM_ADMIN });
  await screen.findByRole('grid');
}

async function typeInto(user: ReturnType<typeof userEvent.setup>, line: string, text: string): Promise<void> {
  await user.click(gridCell(line, 1));
  await user.keyboard(`${text}{Enter}`);
}

describe('price-book grid — refused saves', () => {
  it('marks every cell the server refuses, with its reason, and keeps every edit', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValue(
      await apiError(400, 'PRICE_BOOK_ROW_SHAPE', 'The price rows were refused: 2 rows fail.', {
        errors: [
          { index: 0, field: 'price', code: 'PRICE_BOOK_ROW_SHAPE', message: 'x' },
          { index: 1, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', message: 'y' },
        ],
      }),
    );
    await open();
    await typeInto(user, 'Screws 0200', '-30%');
    await typeInto(user, 'Screws 0300', '40');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(await screen.findByText('Some prices were refused: 2 cells. Each marked cell says why.')).toBeInTheDocument();
    for (const [line, reason] of [
      ['Screws 0200', 'Some price rows are not valid.'],
      ['Screws 0300', 'Two rows of the same selection overlap in their quantity ranges.'],
    ] as const) {
      const cell = gridCell(line, 1);
      expect(cell).toHaveAttribute('aria-invalid', 'true');
      expect(document.getElementById(cell.getAttribute('aria-describedby')!)?.textContent).toContain(reason);
    }
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('-30%');
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 2');
  });

  it('says the rule each cell broke when the server names it, in the admin language (Checkpoint 11 ruling 2)', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValue(
      await apiError(400, 'PRICE_BOOK_ROW_SHAPE', 'refused', {
        errors: [
          { index: 0, field: 'maxQuantity', code: 'PRICE_BOOK_ROW_SHAPE', reason: 'max_below_min', message: 'English' },
          { index: 1, field: 'minQuantity', code: 'PRICE_BOOK_ROW_OVERLAP', reason: 'rows_overlap', message: 'English' },
        ],
      }),
    );
    await open();
    await typeInto(user, 'Screws 0200', '-30%');
    await typeInto(user, 'Screws 0300', '40');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    await screen.findByText('Some prices were refused: 2 cells. Each marked cell says why.');
    const reasonOf = (line: string): string | null | undefined =>
      document.getElementById(gridCell(line, 1).getAttribute('aria-describedby')!)?.textContent;
    expect(reasonOf('Screws 0200')).toContain('The quantity range ends before it starts.');
    expect(reasonOf('Screws 0300')).toContain('This quantity range overlaps another row of the same line.');
    expect(reasonOf('Screws 0200')).not.toContain('English');
  });

  it('refuses a stale save, reloads, keeps the edits and re-applies them against the new version', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValueOnce(await apiError(409, 'PRICE_BOOK_STALE', 'This price book changed since you opened it.'));
    await open();
    await typeInto(user, 'Screws 0300', '40');
    // Someone else changed P1 meanwhile; the reload shows it.
    const theirs = priceBookSchema.parse({ ...book, version: book.version + 1 });
    serveBook(api, { book: theirs, lines: linesOf([STORED[0]!, { ...STORED[1]!, price: { type: 'percent', percent: '-21.00' } }, STORED[2]!, STORED[3]!]) });
    api.put.mockRejectedValueOnce(await apiError(409, 'PRICE_BOOK_STALE', 'This price book changed since you opened it.'));
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This price book changed since you opened it. Your 1 unsaved changes are kept.');
    await waitFor(() => expect(gridCell('Screws 0200', 1)).toHaveTextContent('-21%'));
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('40.00');
    expect(screen.getByRole('button', { name: 'Save prices' })).toBeDisabled();
    api.put.mockResolvedValueOnce({ data: { version: theirs.version + 1, rows: [] } });
    await user.click(within(alert).getByRole('button', { name: 'Re-apply my changes' }));
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect((api.put.mock.calls[0]![1] as { expectedVersion: number }).expectedVersion).toBe(book.version);
    expect((api.put.mock.calls[1]![1] as { expectedVersion: number }).expectedVersion).toBe(theirs.version);
  });

  it('discards the kept edits on request', async () => {
    const user = userEvent.setup();
    api.put.mockRejectedValueOnce(await apiError(409, 'PRICE_BOOK_STALE', 'stale'));
    await open();
    await typeInto(user, 'Screws 0300', '40');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const alert = await screen.findByRole('alert');
    await user.click(within(alert).getByRole('button', { name: 'Discard my changes' }));
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('45.00');
    expect(screen.getByTestId('unsaved-count')).toHaveTextContent('Unsaved changes: 0');
    expect(B).toBeTruthy();
  });
});

describe('price-book grid — leaving and inactive lines', () => {
  it('asks before the page is left with unsaved changes', async () => {
    const user = userEvent.setup();
    await open();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    await typeInto(user, 'Screws 0300', '40');
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('shows why an inactive or deleted-target line prices nothing', async () => {
    await open();
    const headers = lineHeaders();
    expect(headers.find((h) => h.includes('Color: Red'))).toContain('Inactive: the attribute is no longer a price rule');
    expect(headers.find((h) => h.includes('Bolt 10'))).toContain('Inactive: the product, variant or category was deleted');
  });
});
