import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, withSession } from '../../helpers/render-with-session';

/**
 * Issue #1439 (DS-05) and #1448 (DS-15), UX audit slice S14 — the Bulk actions
 * list is the kit's `ListPage`: the status filter is a labelled `Select` in the
 * `ListToolbar` (not a strip of filled buttons), the list is server-paged
 * (`limit` / `offset`, which the endpoint always took — the screen asked for its
 * first 100 and showed nothing past them), the operation is a link a keyboard
 * reaches (the row used to open on a mouse click only), and the two empties
 * differ: nothing yet, or nothing with this status — *Clear filters*.
 */

const getSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { BulkOperationsPage, bulkOperationsListPath } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/BulkOperationsPage'
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogBundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../../../packages/modules/catalog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
const EN = catalogBundle('en');
const tr = (key: string): string => EN[key] ?? key;

const session = adminSession({ permissions: ['*'] });
const OP_ID = '00000000-0000-4000-8000-0000000b1001';

function operation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: OP_ID,
    type: 'product_bulk_update',
    status: 'completed',
    requestedByAdminUserId: '00000000-0000-4000-8000-0000000000ad',
    total: 250,
    processed: 250,
    succeeded: 248,
    skipped: 2,
    failed: 0,
    touchedFields: ['status'],
    results: null,
    logs: null,
    error: null,
    createdAt: '2026-11-20T10:00:00.000Z',
    startedAt: '2026-11-20T10:00:00.000Z',
    finishedAt: '2026-11-20T10:01:00.000Z',
    reversible: true,
    undoStatus: 'none',
    undoneAt: null,
    ...overrides,
  };
}

const page = (data: unknown[], total = data.length) => ({ data, pagination: { total, limit: 20, offset: 0 } });

function renderPage(language: 'en' | 'pl' = 'en'): void {
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <BulkOperationsPage />
      </MemoryRouter>,
      { session },
    ),
    { catalog: catalogBundle(language) },
    { language },
  );
}

beforeEach(() => getSpy.mockReset());
afterEach(() => vi.clearAllMocks());

describe('bulkOperationsListPath', () => {
  it('asks for one page by limit and offset, with the status only when one is chosen', () => {
    expect(bulkOperationsListPath({ status: 'all', page: 1, pageSize: 20 })).toBe(
      '/api/v1/admin/catalog/bulk-operations?limit=20&offset=0',
    );
    expect(bulkOperationsListPath({ status: 'failed', page: 3, pageSize: 50 })).toBe(
      '/api/v1/admin/catalog/bulk-operations?status=failed&limit=50&offset=100',
    );
  });
});

describe('BulkOperationsPage — the ListPage pattern (S14)', () => {
  it('links each operation to its page and announces the count', async () => {
    getSpy.mockResolvedValue(page([operation()], 1));
    renderPage();
    const link = await screen.findByRole('link', { name: tr('bulkOperations.type.product_bulk_update') });
    expect(link).toHaveAttribute('href', `/catalog/bulk-operations/${OP_ID}`);
    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/bulk-operations?limit=20&offset=0');
    expect(screen.getByRole('status').textContent).toBe(tr('bulkOperations.count').replace('{count}', '1'));
    // The status filter is a labelled select, not a strip of filled buttons.
    expect(screen.queryByRole('button', { name: tr('bulkOperations.filter.pending') })).toBeNull();
    expect(screen.getByRole('combobox', { name: tr('bulkOperations.column.status') })).toBeInTheDocument();
  });

  it('pages past the first page when the total says there is more', async () => {
    getSpy.mockResolvedValue(page(Array.from({ length: 20 }, (_, i) => operation({ id: `${OP_ID.slice(0, -2)}${String(i).padStart(2, '0')}` })), 45));
    renderPage();
    const user = userEvent.setup();
    await screen.findAllByRole('link', { name: tr('bulkOperations.type.product_bulk_update') });
    await user.click(screen.getByRole('button', { name: /next/i }));
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/bulk-operations?limit=20&offset=20'),
    );
  });

  it('filters by status and goes back to the first page', async () => {
    getSpy.mockResolvedValue(page([operation()], 1));
    renderPage();
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: tr('bulkOperations.column.status') }),
      'failed',
    );
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/bulk-operations?status=failed&limit=20&offset=0'),
    );
  });

  it('says there is nothing yet, and where operations come from, when the list is empty', async () => {
    getSpy.mockResolvedValue(page([], 0));
    renderPage();
    expect(await screen.findByText(tr('bulkOperations.emptyTitle'))).toBeInTheDocument();
    expect(screen.getByText(tr('bulkOperations.emptyHint'))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('bulkOperations.emptyAction') })).toHaveAttribute(
      'href',
      '/catalog/products',
    );
  });

  it('says no operation has the status, with Clear filters, when a filter empties it', async () => {
    getSpy.mockResolvedValue(page([], 0));
    renderPage();
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByRole('combobox', { name: tr('bulkOperations.column.status') }),
      'running',
    );
    expect(await screen.findByText(tr('bulkOperations.emptyFiltered'))).toBeInTheDocument();
    // The empty state's own *Clear filters* (the toolbar offers *Clear all filters* too).
    const clears = screen.getAllByRole('button', { name: /clear/i });
    await user.click(clears[clears.length - 1]!);
    await waitFor(() =>
      expect(getSpy).toHaveBeenLastCalledWith('/api/v1/admin/catalog/bulk-operations?limit=20&offset=0'),
    );
  });

  it('offers Retry after a failed load', async () => {
    getSpy.mockRejectedValueOnce(new Error('down')).mockResolvedValue(page([operation()], 1));
    renderPage();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /retry/i }));
    expect(await screen.findByRole('link', { name: tr('bulkOperations.type.product_bulk_update') })).toBeInTheDocument();
  });

  it('renders in Polish', async () => {
    getSpy.mockResolvedValue(page([], 0));
    renderPage('pl');
    expect(await screen.findByText(catalogBundle('pl')['bulkOperations.emptyTitle']!)).toBeInTheDocument();
  });
});
