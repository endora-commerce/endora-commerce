import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #1492 (CAT-17) and #1448 (DS-15), UX audit slice S14 — the bulk
 * operation page's per-element list. Its filter is one labelled select (it was
 * four buttons, the chosen one filled: colour alone said which was on), and its
 * two empties are the kit's: nothing recorded, or nothing for this outcome —
 * with *Clear filters* back to every element.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: (...a: unknown[]) => getSpy(...a), post: (...a: unknown[]) => postSpy(...a), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const { BulkOperationDetailPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/BulkOperationDetailPage'
);

const __dirname = dirname(fileURLToPath(import.meta.url));
const EN = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../packages/modules/catalog/i18n/en.json'), 'utf8'),
) as Record<string, string>;
const tr = (key: string): string => EN[key] ?? key;

const OP_ID = '00000000-0000-4000-8000-00000000b514';
const P1 = '00000000-0000-4000-8000-0000000000e1';

function operation(results: unknown[] | null): Record<string, unknown> {
  return {
    id: OP_ID,
    type: 'product_bulk_update',
    status: 'completed',
    total: 1,
    processed: 1,
    succeeded: 1,
    skipped: 0,
    failed: 0,
    requestedByAdminUserId: '00000000-0000-4000-8000-0000000000ad',
    touchedFields: ['status'],
    results,
    error: null,
    logs: [],
    reversible: true,
    undoStatus: 'none',
    undoneAt: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    startedAt: '2026-11-13T10:00:00.000Z',
    finishedAt: '2026-11-13T10:00:01.000Z',
  };
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  postSpy.mockResolvedValue({ data: [{ id: P1, sku: 'SKU-1', name: 'Drill' }] });
});
afterEach(() => vi.clearAllMocks());

function renderPage(): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[`/catalog/bulk-operations/${OP_ID}`]}>
      <Routes>
        <Route path="/catalog/bulk-operations/:id" element={<BulkOperationDetailPage />} />
      </Routes>
    </MemoryRouter>,
    { catalog: EN },
    { language: 'en' },
  );
}

describe('bulk operation page — per-element list (S14)', () => {
  it('filters by outcome with a labelled select, and an empty outcome offers Clear filters', async () => {
    getSpy.mockResolvedValue({ data: operation([{ productId: P1, status: 'succeeded', changedFields: ['status'] }]) });
    renderPage();
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: /Drill/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: tr('bulkOperations.outcome.failed') })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: tr('bulkOperations.detail.outcome') }), 'failed');
    expect(screen.queryByRole('link', { name: /Drill/ })).toBeNull();
    expect(screen.getByText(tr('bulkOperations.detail.noElementsForFilter'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(screen.getByRole('link', { name: /Drill/ })).toBeInTheDocument());
    expect(screen.getByRole('combobox', { name: tr('bulkOperations.detail.outcome') })).toHaveValue('all');
  });

  it('says nothing was recorded, in the kit’s empty state, when there are no results', async () => {
    getSpy.mockResolvedValue({ data: operation(null) });
    renderPage();
    const title = await screen.findByText(tr('bulkOperations.detail.noResults'));
    expect(title.closest('.b2b-empty')).not.toBeNull();
  });

  it('offers Undo as the kit’s primary button', async () => {
    getSpy.mockResolvedValue({ data: operation([]) });
    renderPage();
    const undo = await screen.findByRole('button', { name: tr('bulkOperations.undo.action') });
    expect(undo.className).not.toMatch(/b2b-btn/);
    expect(undo.className).toMatch(/bg-primary/);
  });
});
