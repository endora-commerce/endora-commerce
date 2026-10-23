import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBook } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, IDS, PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * Entering prices (feature 161, T059; US2 scenarios 1–5 and 11; FR-008,
 * FR-011–FR-013): lines added in bulk, prices typed and pasted liberally and
 * refused per cell, bulk changes as one undo step, the unsaved count, and one
 * batch on save with its progress announced.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, primaryActions } = await import('../../helpers/price-book-screen');
const { B, serveBook, linesOf, mkRow, gridCell, lineHeaders, PRODUCTS } = await import('../../helpers/price-book-grid');

const STORED = [
  mkRow({ category: 'screws', price: { type: 'percent', percent: '-10.00' } }),
  mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } }),
  mkRow({ product: PRODUCTS.P2, price: { type: 'fixed', amount: '45.0000' } }),
];

/** Forty new products, then P1 — already a line of the book — on the third page of 20. */
const CATALOGUE = [
  ...Array.from({ length: 40 }, (_, i) => ({
    id: `00000000-0000-4000-8000-0000001630${(i + 1).toString(16).padStart(2, '0')}`,
    sku: `N-${String(i + 1).padStart(2, '0')}`,
    slug: `n-${i + 1}`,
    name: { 'en-US': `New product ${String(i + 1).padStart(2, '0')}` },
    status: 'active' as const,
    type: 'simple' as const,
  })),
  { id: PRODUCTS.P1.id, sku: 'P1', slug: 'p1', name: { 'en-US': 'Screws 0200' }, status: 'active' as const, type: 'simple' as const },
];

let book: PriceBook;

beforeEach(() => {
  book = priceBookSchema.parse({ ...BOOKS.L2, tierStarts: [1], rowCount: STORED.length });
  serveBook(api, { book, lines: linesOf(STORED), products: CATALOGUE });
});

async function open(session = PLATFORM_ADMIN) {
  const mounted = mountScreen({ path: `/price-lists/${book.id}?tab=prices`, session });
  await screen.findByRole('grid');
  return mounted;
}

const unsaved = (): string => screen.getByTestId('unsaved-count').textContent ?? '';

async function focusCell(user: ReturnType<typeof userEvent.setup>, line: string | RegExp, start: number): Promise<HTMLElement> {
  const cell = gridCell(line, start);
  await user.click(cell);
  expect(document.activeElement).toBe(cell);
  return cell;
}

describe('price-book grid — adding lines', () => {
  it('adds 40 products at once through the product browser, none twice, nothing saved yet', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Add lines' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Products…' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('[aria-busy="true"]')).toBeNull());
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Select New product 40' })).toBeInTheDocument());
    await user.click(within(dialog).getByRole('checkbox', { name: 'Select all selectable products on this page' }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    // The product already a line is shown, and cannot be picked again.
    await waitFor(() => expect(within(dialog).getByRole('checkbox', { name: 'Select Screws 0200' })).toBeDisabled());
    await user.click(within(dialog).getByRole('button', { name: 'Add 40' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const headers = lineHeaders();
    expect(headers.filter((h) => h.includes('New product'))).toHaveLength(40);
    expect(headers.filter((h) => h.includes('Screws 0200'))).toHaveLength(1);
    expect(unsaved()).toBe('Unsaved changes: 40');
    // An added line has no price yet, and says so.
    expect(gridCell('New product 07', 1)).toHaveTextContent('not priced here');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('adds category, attribute and category ∩ attribute lines, offering only eligible attributes', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Add lines' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Category and attribute value…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a category and attribute value line' });
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Bolts' })).toBeInTheDocument());
    // `…/targets/attributes` answers only the eligible *Price list rules* attributes.
    expect(within(within(dialog).getByLabelText('Attribute')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Color']);
    await user.selectOptions(within(dialog).getByLabelText('Category'), IDS.categories.bolts);
    await user.selectOptions(within(dialog).getByLabelText('Attribute'), 'color');
    await user.selectOptions(within(dialog).getByLabelText('Value'), 'blue');
    await user.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(lineHeaders().some((h) => h.includes('Bolts · Color: Blue'))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Add lines' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Category…' }));
    const categories = await screen.findByRole('dialog', { name: 'Add a category line' });
    await user.selectOptions(within(categories).getByLabelText('Category'), IDS.categories.bolts);
    await user.click(within(categories).getByRole('button', { name: 'Add line' }));
    expect(lineHeaders().some((h) => /^Bolts(?! ·)/.test(h))).toBe(true);
    expect(unsaved()).toBe('Unsaved changes: 2');
  });
});

describe('price-book grid — typing and pasting', () => {
  it('reads typed prices in every kind and shows the kind', async () => {
    const user = userEvent.setup();
    await open();
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('-5%{Enter}');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('-5%');
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('+3{Enter}');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('+3.00');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('adjustment');
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('95{Enter}');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('95.00');
    expect(unsaved()).toBe('Unsaved changes: 1');
  });

  it('normalises a pasted block — decimal comma, spaces, currency — and marks what it cannot read', async () => {
    const user = userEvent.setup();
    await open();
    await focusCell(user, /^Screws(?! 0)/, 1);
    await user.paste('-12,5 %\n95,50\n1 234,5 zł');
    expect(gridCell(/^Screws(?! 0)/, 1)).toHaveTextContent('-12.5%');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('95.50');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('1234.50');
    await focusCell(user, 'Screws 0200', 1);
    await user.paste('20%');
    const refused = gridCell('Screws 0200', 1);
    expect(refused).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(refused.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Write the sign of the percentage: +20% for a surcharge, -20% for a discount.',
    );
    // A refused cell blocks the save, and says why.
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    expect(await screen.findByText('Fix the cells marked as invalid before saving: 1.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('changes a selection in bulk as one step, undone as one step', async () => {
    const user = userEvent.setup();
    await open();
    await focusCell(user, /^Screws(?! 0)/, 1);
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Change selected…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the selected cells' });
    await user.click(within(dialog).getByRole('radio', { name: 'Set a percentage' }));
    await user.type(within(dialog).getByLabelText('Percentage'), '-7');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    for (const line of [/^Screws(?! 0)/, 'Screws 0200', 'Screws 0300'] as const) expect(gridCell(line, 1)).toHaveTextContent('-7%');
    expect(unsaved()).toBe('Unsaved changes: 3');
    gridCell('Screws 0200', 1).focus();
    await user.keyboard('{Control>}z{/Control}');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('-20%');
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('45.00');
    expect(unsaved()).toBe('Unsaved changes: 0');
  });

  it('multiplies fixed prices only, rounding as the server does', async () => {
    const user = userEvent.setup();
    await open();
    await focusCell(user, /^Screws(?! 0)/, 1);
    await user.keyboard('{Shift>}{ArrowDown}{ArrowDown}{/Shift}');
    await user.click(screen.getByRole('button', { name: 'Change selected…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Change the selected cells' });
    await user.click(within(dialog).getByRole('radio', { name: 'Multiply fixed prices by' }));
    await user.type(within(dialog).getByLabelText('Factor'), '1,0333');
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));
    // 45 × 1.0333 = 46.4985; the percentages are not fixed prices and stay.
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('46.4985');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('-20%');
  });
});

describe('price-book grid — saving', () => {
  it('sends one batch against the opened version, shows progress, announces the result and clears', async () => {
    const user = userEvent.setup();
    let resolveSave: (value: unknown) => void = () => undefined;
    api.put.mockImplementation(() => new Promise((resolve) => (resolveSave = resolve)));
    const { container } = await open();
    expect(primaryActions(container).map((e) => e.textContent)).toEqual(['Save prices']);
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('48{Enter}');
    await focusCell(user, 'Screws 0200', 1);
    await user.keyboard('-22%{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save prices' }));
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(api.put).toHaveBeenCalledTimes(1);
    const [url, body] = api.put.mock.calls[0]! as [string, { expectedVersion: number; upsert: unknown[]; delete: unknown[]; mode: string }];
    expect(url).toBe(`${B}/${book.id}/rows`);
    expect(body.expectedVersion).toBe(book.version);
    expect(body.mode).toBe('merge');
    expect(body.upsert).toEqual([
      expect.objectContaining({ id: STORED[1]!.id, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-22.00' } }),
      expect.objectContaining({ id: STORED[2]!.id, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '48.0000' } }),
    ]);
    expect(screen.getByText('Saving 2 changes…')).toBeInTheDocument();
    book = { ...book, version: book.version + 1 };
    serveBook(api, {
      book,
      lines: linesOf([
        STORED[0]!,
        { ...STORED[1]!, price: { type: 'percent', percent: '-22.00' } },
        { ...STORED[2]!, price: { type: 'fixed', amount: '48.0000' } },
      ]),
    });
    await act(async () => resolveSave({ data: { version: book.version, rows: [] } }));
    expect(await screen.findByText('Prices saved. Rows written: 2.')).toBeInTheDocument();
    expect(unsaved()).toBe('Unsaved changes: 0');
    expect(gridCell('Screws 0200', 1)).toHaveTextContent('-22%');
  });

  it('has no axe violations with unsaved and refused cells', async () => {
    const user = userEvent.setup();
    const { container } = await open();
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('abc{Enter}');
    await expectNoAxeViolations(container);
  });

  it('offers a reader the prices and nothing to change', async () => {
    book = { ...book, writable: false };
    serveBook(api, { book, lines: linesOf(STORED) });
    await open(PRICING_READER);
    expect(screen.getByRole('grid')).toHaveAttribute('aria-readonly', 'true');
    for (const name of ['Add lines', 'Change selected…', 'Save prices', 'Add quantity tier']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.getByText('You can view these prices but not change them.')).toBeInTheDocument();
  });

  it('keeps the edits when switching to the settings and back', async () => {
    const user = userEvent.setup();
    await open();
    await focusCell(user, 'Screws 0300', 1);
    await user.keyboard('48{Enter}');
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    await user.click(screen.getByRole('tab', { name: 'Prices' }));
    expect(gridCell('Screws 0300', 1)).toHaveTextContent('48.00');
    fireEvent.keyDown(document.body, { key: 'Escape' });
  });
});
