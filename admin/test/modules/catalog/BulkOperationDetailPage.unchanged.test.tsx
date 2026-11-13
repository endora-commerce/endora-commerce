import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithI18n } from '../../helpers/render-with-i18n';

/**
 * Issue #501, item 2 (ruling B) — bulk-archiving an already archived product reported the
 * row as "Succeeded" with no changed fields. The API keeps `succeeded` (the contract is
 * unchanged); the detail page names such a row "Unchanged", by the rule the bulk edit
 * dialog already used. The summary's succeeded count is untouched.
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
const catalogBundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(resolve(__dirname, `../../../../packages/modules/catalog/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;

const OP_ID = '00000000-0000-4000-8000-00000000b501';
const MOVED = '00000000-0000-4000-8000-0000000000a1';
const ALREADY = '00000000-0000-4000-8000-0000000000a2';

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockResolvedValue({
    data: {
      id: OP_ID,
      type: 'product_bulk_update',
      status: 'completed',
      total: 2,
      processed: 2,
      succeeded: 2,
      skipped: 0,
      failed: 0,
      requestedByAdminUserId: '00000000-0000-4000-8000-0000000000ad',
      touchedFields: ['archived'],
      results: [
        { productId: MOVED, status: 'succeeded', changedFields: ['archivedAt'] },
        { productId: ALREADY, status: 'succeeded', changedFields: [] },
      ],
      error: null,
      logs: [],
      reversible: false,
      undoStatus: 'none',
      undoneAt: null,
      createdAt: '2026-11-13T10:00:00.000Z',
      startedAt: '2026-11-13T10:00:00.000Z',
      finishedAt: '2026-11-13T10:00:01.000Z',
    },
  });
  postSpy.mockResolvedValue({
    data: [
      { id: MOVED, sku: 'SKU-MOVED', name: 'Moved' },
      { id: ALREADY, sku: 'SKU-ALREADY', name: 'Already archived' },
    ],
  });
});
afterEach(() => vi.clearAllMocks());

function renderPage(language: 'en' | 'pl'): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[`/catalog/bulk-operations/${OP_ID}`]}>
      <Routes>
        <Route path="/catalog/bulk-operations/:id" element={<BulkOperationDetailPage />} />
      </Routes>
    </MemoryRouter>,
    { catalog: catalogBundle(language) },
    { language },
  );
}

async function rowOf(name: string): Promise<HTMLElement> {
  return (await screen.findByText(name)).closest('tr') as HTMLElement;
}

describe('bulk operation detail — a row that changed nothing (issue #501)', () => {
  it('says Unchanged for it and Succeeded for the row that moved', async () => {
    renderPage('en');
    expect(within(await rowOf('Already archived')).getByText('Unchanged')).toBeTruthy();
    expect(within(await rowOf('Already archived')).queryByText('Succeeded')).toBeNull();
    expect(within(await rowOf('Moved')).getByText('Succeeded')).toBeTruthy();
  });

  it('says Bez zmian in Polish', async () => {
    renderPage('pl');
    expect(within(await rowOf('Already archived')).getByText('Bez zmian')).toBeTruthy();
  });
});
