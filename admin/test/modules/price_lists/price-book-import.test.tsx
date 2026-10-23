import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { priceBookSchema, type PriceBookDiffRow, type PriceBookRow, type PriceBookRowsDryRun } from '@endora-commerce/contracts';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BOOKS, PLATFORM_ADMIN, PRICING_READER } from '../../helpers/price-book-fixtures';

/**
 * CSV export and import on a book's prices (feature 161, T090; US9 scenarios
 * 1–6; FR-018, FR-038–FR-042).
 *
 * The file is read and checked locally (`price-book-csv.ts`, T089), previewed
 * by the server's `PUT …/rows?dryRun=true`, and written only on confirmation,
 * as the same body with the preview's version. These tests drive the screen:
 * the export's reads and file; the dialog's file, mode, encoding prompt,
 * preview, refused rows with line and column, download, confirmation and the
 * stale refusal; and the import's absence while the grid holds unsaved edits
 * or the book is read-only.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@endora-commerce/admin-kit/lib', async () => ({
  ...(await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib')),
  apiClient: api,
}));

const { mountScreen, apiError } = await import('../../helpers/price-book-screen');
const { serveBook, linesOf, mkRow, gridCell, PRODUCTS, B } = await import('../../helpers/price-book-grid');

const ROWS: PriceBookRow[] = [
  mkRow({ category: 'screws', price: { type: 'percent', percent: '-10.00' } }),
  mkRow({ product: PRODUCTS.P1, price: { type: 'percent', percent: '-20.00' } }),
];
const BOOK = priceBookSchema.parse({ ...BOOKS.L2, rowCount: ROWS.length, tierStarts: [1] });

const EN_HEADER = 'kind;product_sku;variant_sku;category_path;attribute_key;attribute_value;min_quantity;max_quantity;price_kind;value';
const EXPORTED = [EN_HEADER, 'category;;;screws;;;1;;percent;-10.00', 'product;P1;;;;;1;;percent;-20.00'].join('\r\n') + '\r\n';

const diffRow = (row: PriceBookRow, overrides: Partial<PriceBookDiffRow> = {}): PriceBookDiffRow => ({
  id: row.id,
  selectionKind: row.selectionKind,
  selection: row.selection,
  naturalKey: row.naturalKey,
  minQuantity: row.minQuantity,
  maxQuantity: row.maxQuantity,
  price: row.price,
  ...overrides,
});
const NEW_ID = '00000000-0000-4000-8000-0000001620ff';
const P2_ROW: PriceBookDiffRow = {
  id: NEW_ID,
  selectionKind: 'product',
  selection: { variantId: null, productId: PRODUCTS.P2.id, categoryId: null, attribute: null },
  naturalKey: { productSku: 'P2' },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'fixed', amount: '25.0000' },
};

let dryRun: PriceBookRowsDryRun;
let downloads: Array<{ name: string; text: string }>;

function answer(partial: Partial<PriceBookRowsDryRun> & Pick<PriceBookRowsDryRun, 'resolved'>): PriceBookRowsDryRun {
  return { version: BOOK.version, diff: { added: [], changed: [], removed: [], unchangedCount: 0 }, errors: [], ...partial };
}

beforeEach(() => {
  serveBook(api, { book: BOOK, lines: linesOf(ROWS) });
  const served = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string) => {
    const [path, query = ''] = url.split('?');
    if (path === `${B}/${BOOK.id}/rows`) {
      const params = new URLSearchParams(query);
      const page = Number(params.get('page'));
      return { data: page === 1 ? ROWS : [], meta: { page, pageSize: Number(params.get('pageSize')), totalCount: ROWS.length } };
    }
    return served(url);
  });
  dryRun = answer({ resolved: [diffRow(ROWS[0]!), diffRow(ROWS[1]!)], diff: { added: [], changed: [], removed: [], unchangedCount: 2 } });
  api.put.mockImplementation(async (url: string) => {
    if (url === `${B}/${BOOK.id}/rows?dryRun=true`) return { data: dryRun };
    if (url === `${B}/${BOOK.id}/rows`) return { data: { version: BOOK.version + 1, rows: [] } };
    throw new Error(`unexpected PUT ${url}`);
  });

  downloads = [];
  const blobs = new Map<string, Blob>();
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (blob: Blob): string => {
      const href = `blob:test/${blobs.size}`;
      blobs.set(href, blob);
      return href;
    },
    revokeObjectURL: (): void => undefined,
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const blob = blobs.get(this.href);
    if (blob) void blob.text().then((text) => downloads.push({ name: this.download, text }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function openPrices(session = PLATFORM_ADMIN): Promise<void> {
  mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session });
  await screen.findByRole('grid');
}

async function openMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'CSV file' }));
}

async function openImport(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await openMenu(user);
  await user.click(await screen.findByRole('menuitem', { name: 'Import from CSV…' }));
  return screen.findByRole('dialog', { name: 'Import prices from a CSV file' });
}

const csvFile = (text: string, name = 'acme.csv'): File => new File([text], name, { type: 'text/csv' });

async function upload(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, file: File, mode: 'Merge' | 'Replace' = 'Merge'): Promise<void> {
  await user.upload(within(dialog).getByLabelText('CSV file'), file);
  await user.click(within(dialog).getByRole('radio', { name: new RegExp(`^${mode}`) }));
  await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
}

const dryRunBodies = (): Array<{ mode: string; upsert: unknown[]; delete: unknown[] }> =>
  api.put.mock.calls.filter(([url]) => (url as string).endsWith('?dryRun=true')).map(([, body]) => body as never);
const writes = (): unknown[][] => api.put.mock.calls.filter(([url]) => url === `${B}/${BOOK.id}/rows`);

describe('export (FR-018)', () => {
  it('reads the rows 1 000 at a time for the current filter and downloads one file in the fixed format', async () => {
    const user = userEvent.setup();
    await openPrices();
    await user.selectOptions(screen.getByLabelText('Line kind'), 'product');
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Export to CSV' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    const asked = api.get.mock.calls.map(([url]) => url as string).filter((url) => url.startsWith(`${B}/${BOOK.id}/rows`));
    expect(asked).toEqual([`${B}/${BOOK.id}/rows?selectionKind=product&page=1&pageSize=1000`]);
    expect(downloads[0]!.name).toMatch(/^acme-screws-\d{4}-\d{2}-\d{2}-en\.csv$/);
    expect(downloads[0]!.text.replace(/^﻿/, '')).toBe(EXPORTED);
    expect(await screen.findByText('Exported 2 rows.')).toBeInTheDocument();
  });
});

describe('import — where it is offered (FR-042)', () => {
  it('is absent while the grid holds unsaved edits, and says why', async () => {
    const user = userEvent.setup();
    await openPrices();
    await user.click(gridCell('Screws 0200', 1));
    await user.keyboard('-25%{Enter}');
    expect(await screen.findByText('Save or discard your changes to import a CSV file.')).toBeInTheDocument();
    await openMenu(user);
    expect(await screen.findByRole('menuitem', { name: 'Export to CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Import from CSV…' })).toBeNull();
  });

  it('is absent on a book the caller may not change; the export stays', async () => {
    const user = userEvent.setup();
    serveBook(api, { book: { ...BOOK, writable: false }, lines: linesOf(ROWS) });
    await openPrices(PRICING_READER);
    await openMenu(user);
    expect(await screen.findByRole('menuitem', { name: 'Export to CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Import from CSV…' })).toBeNull();
  });
});

describe('import — the preview (FR-040, FR-041)', () => {
  it('scenario 1 — an export re-imported unchanged previews “no changes” and offers nothing to confirm', async () => {
    const user = userEvent.setup();
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(EXPORTED));
    expect(await within(dialog).findByText('No changes: the book already holds what the file says.')).toBeInTheDocument();
    expect(dryRunBodies()).toEqual([
      {
        mode: 'merge',
        upsert: [
          { key: { categoryPath: 'screws' }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-10.00' } },
          { key: { productSku: 'P1' }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-20.00' } },
        ],
        delete: [],
      },
    ]);
    expect(within(dialog).getByRole('button', { name: /^Import/ })).toBeDisabled();
    expect(within(dialog).getByText('There is nothing to import.')).toBeInTheDocument();
  });

  it('scenario 2 — lists the change (old → new), the addition and the refused row with its line and column, and cannot be confirmed', async () => {
    const user = userEvent.setup();
    const file = [EN_HEADER, 'category;;;screws;;;1;;percent;-10.00', 'product;P1;;;;;1;;percent;-25.00', 'product;P2;;;;;1;;fixed;25', 'product;NOPE;;;;;1;;fixed;10'].join('\n');
    dryRun = answer({
      resolved: [diffRow(ROWS[0]!), diffRow(ROWS[1]!, { price: { type: 'percent', percent: '-25.00' } }), P2_ROW, null],
      diff: {
        added: [P2_ROW],
        changed: [{ before: diffRow(ROWS[1]!), after: diffRow(ROWS[1]!, { price: { type: 'percent', percent: '-25.00' } }) }],
        removed: [],
        unchangedCount: 1,
      },
      errors: [{ index: 3, field: 'key.productSku', code: 'PRICE_BOOK_ROW_TARGET', reason: 'product_unknown', message: 'No product has the SKU NOPE.' }],
    });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(file));

    expect(await within(dialog).findByText('Nothing has been written yet.')).toBeInTheDocument();
    const summary = within(dialog).getByRole('list', { name: 'What the file would change' });
    expect(within(summary).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['1 changed', '1 added', '1 unchanged', '1 refused']);

    const changed = within(dialog).getByRole('table', { name: 'Changed' });
    expect(within(changed).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['3Product P1 · from 1-20%-25%']);
    const added = within(dialog).getByRole('table', { name: 'Added' });
    expect(within(added).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['4Product P2 · from 125.00']);
    const refused = within(dialog).getByRole('table', { name: 'Refused rows' });
    expect(within(refused).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['5product_skuNo product has the SKU “NOPE”.']);

    expect(within(dialog).getByRole('button', { name: /^Import/ })).toBeDisabled();
    expect(within(dialog).getByText('Fix the refused rows in the file and upload it again, or download them with their reasons.')).toBeInTheDocument();
    expect(writes()).toEqual([]);
  });

  it('refuses a line locally with its line and column, and previews only the readable ones', async () => {
    const user = userEvent.setup();
    const file = [EN_HEADER, 'widget;;;;;;1;;fixed;1', 'product;P1;;;;;1;;percent;-20.00'].join('\n');
    dryRun = answer({ resolved: [diffRow(ROWS[1]!)], diff: { added: [], changed: [], removed: [], unchangedCount: 1 } });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(file));
    const refused = await within(dialog).findByRole('table', { name: 'Refused rows' });
    expect(within(refused).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['2kindUnknown kind “widget”.']);
    expect(dryRunBodies()[0]!.upsert).toHaveLength(1);
    // Checkpoint 11 ruling: say that what the file could not read is not compared.
    expect(within(dialog).getByText('Lines refused in the file are not compared with the book.')).toBeInTheDocument();
  });

  it('adds no such note when every line of the file was read', async () => {
    const user = userEvent.setup();
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(EXPORTED));
    await within(dialog).findByText('No changes: the book already holds what the file says.');
    expect(within(dialog).queryByText('Lines refused in the file are not compared with the book.')).toBeNull();
  });

  it('scenario 6 — downloads exactly the refused rows with a reason column', async () => {
    const user = userEvent.setup();
    const file = [EN_HEADER, 'widget;;;;;;1;;fixed;1', 'product;P1;;;;;1;;percent;-20.00'].join('\n');
    dryRun = answer({ resolved: [diffRow(ROWS[1]!)], diff: { added: [], changed: [], removed: [], unchangedCount: 1 } });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(file));
    await user.click(await within(dialog).findByRole('button', { name: 'Download refused rows' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]!.name).toBe('acme-refused.csv');
    expect(downloads[0]!.text.replace(/^﻿/, '').split('\r\n')).toEqual([`${EN_HEADER};reason`, 'widget;;;;;;1;;fixed;1;Unknown kind “widget”.', '']);
  });

  it('scenario 3 — replace mode lists the removed rows and states their count before the confirm button', async () => {
    const user = userEvent.setup();
    dryRun = answer({ resolved: [diffRow(ROWS[1]!)], diff: { added: [], changed: [], removed: [diffRow(ROWS[0]!)], unchangedCount: 1 } });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile([EN_HEADER, 'product;P1;;;;;1;;percent;-20.00'].join('\n')), 'Replace');
    const removed = await within(dialog).findByRole('table', { name: 'Removed' });
    expect(within(removed).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual(['Category screws · from 1-10%']);
    expect(dryRunBodies()[0]!.mode).toBe('replace');
    const warning = within(dialog).getByText('Replacing removes 1 rows that are not in the file.');
    const confirm = within(dialog).getByRole('button', { name: 'Import 1 changes' });
    expect(warning.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('scenario 5 — asks for the encoding when the file is not UTF-8, showing its first lines as read', async () => {
    const user = userEvent.setup();
    const ascii = (s: string): number[] => [...new TextEncoder().encode(s)];
    // A category path whose e-ogonek (U+0119) is the Windows-1250 byte 0xEA, which is not UTF-8.
    const bytes = new Uint8Array([...ascii(`${EN_HEADER}\n`), ...ascii('category;;;wkr'), 0xea, ...ascii('ty;;;1;;percent;-5,00\n')]);
    dryRun = answer({ resolved: [null], errors: [{ index: 0, field: 'key.categoryPath', code: 'PRICE_BOOK_ROW_TARGET', message: 'x' }] });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, new File([bytes], 'cp1250.csv'));
    const prompt = await within(dialog).findByRole('group', { name: 'Which encoding is this file in?' });
    expect(within(prompt).getByText(/category;;;wkręty;;;1;;percent;-5,00/)).toBeInTheDocument();
    expect(within(prompt).getByRole('radio', { name: 'Windows-1250 (Central European)' })).toBeChecked();
    expect(dryRunBodies()).toEqual([]);
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await within(dialog).findByRole('table', { name: 'Refused rows' });
    expect(dryRunBodies()[0]!.upsert).toEqual([
      { key: { categoryPath: 'wkręty' }, minQuantity: 1, maxQuantity: null, price: { type: 'percent', percent: '-5.00' } },
    ]);
  });

  it('refuses a file over 5 MB and a file with an unknown column before any request', async () => {
    const user = userEvent.setup();
    await openPrices();
    const dialog = await openImport(user);
    const big = csvFile(EXPORTED);
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    await upload(user, dialog, big);
    expect(await within(dialog).findByText('The file is larger than 5 MB.')).toBeInTheDocument();
    await upload(user, dialog, csvFile(`${EN_HEADER};colour\n`));
    expect(await within(dialog).findByText('Unknown columns: colour. The header must be the price-book format’s.')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('import — confirmation (FR-041)', () => {
  const FILE = [EN_HEADER, 'category;;;screws;;;1;;percent;-10.00', 'product;P1;;;;;1;;percent;-25.00', 'product;P2;;;;;1;;fixed;25'].join('\n');
  beforeEach(() => {
    dryRun = answer({
      version: BOOK.version,
      resolved: [diffRow(ROWS[0]!), diffRow(ROWS[1]!, { price: { type: 'percent', percent: '-25.00' } }), P2_ROW],
      diff: {
        added: [P2_ROW],
        changed: [{ before: diffRow(ROWS[1]!), after: diffRow(ROWS[1]!, { price: { type: 'percent', percent: '-25.00' } }) }],
        removed: [],
        unchangedCount: 1,
      },
    });
  });

  it('scenario 4 — sends the same batch once with the preview’s version, then closes and shows the result', async () => {
    const user = userEvent.setup();
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(FILE));
    await user.click(await within(dialog).findByRole('button', { name: 'Import 2 changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(writes()).toHaveLength(1);
    const [, body] = writes()[0]!;
    expect(body).toEqual({ ...dryRunBodies()[0], expectedVersion: BOOK.version });
    expect(await screen.findByText('Imported 2 changes.')).toBeInTheDocument();
    // The book and its lines are read again.
    await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === `${B}/${BOOK.id}`).length).toBeGreaterThan(1));
  });

  it('scenario 4 — a book saved by someone else since the preview is refused, and a new preview offered', async () => {
    const user = userEvent.setup();
    api.put.mockImplementation(async (url: string) => {
      if (url.endsWith('?dryRun=true')) return { data: dryRun };
      throw await apiError(409, 'PRICE_BOOK_STALE', 'stale', { currentVersion: BOOK.version + 1 });
    });
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(FILE));
    await user.click(await within(dialog).findByRole('button', { name: 'Import 2 changes' }));
    expect(
      await within(dialog).findByText('Someone changed this price book after the preview. Preview the file again to see what it would change now.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Import/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Preview again' }));
    await waitFor(() => expect(dryRunBodies()).toHaveLength(2));
    expect(await within(dialog).findByRole('button', { name: 'Import 2 changes' })).toBeEnabled();
  });

  it('cannot be confirmed twice while the import is in flight', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    api.put.mockImplementation((url: string) =>
      url.endsWith('?dryRun=true')
        ? Promise.resolve({ data: dryRun })
        : new Promise((resolve) => {
            release = () => resolve({ data: { version: BOOK.version + 1, rows: [] } });
          }),
    );
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(FILE));
    const confirm = await within(dialog).findByRole('button', { name: 'Import 2 changes' });
    await user.click(confirm);
    expect(within(dialog).getByRole('button', { name: 'Importing…' })).toBeDisabled();
    expect(writes()).toHaveLength(1);
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no axe violations on the preview', async () => {
    const user = userEvent.setup();
    await openPrices();
    const dialog = await openImport(user);
    await upload(user, dialog, csvFile(FILE));
    await within(dialog).findByRole('button', { name: 'Import 2 changes' });
    await expectNoAxeViolations(dialog);
  });
});

describe('import — Polish', () => {
  it('reads in Polish', async () => {
    const user = userEvent.setup();
    mountScreen({ path: `/price-lists/${BOOK.id}?tab=prices`, session: PLATFORM_ADMIN, language: 'pl' });
    await screen.findByRole('grid');
    await user.click(screen.getByRole('button', { name: 'Plik CSV' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Importuj z pliku CSV…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Import cen z pliku CSV' });
    expect(within(dialog).getByLabelText('Plik CSV')).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /^Scal/ })).toBeChecked();
  });
});
