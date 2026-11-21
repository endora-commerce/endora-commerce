import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import catalog from '../../../../packages/modules/catalog/i18n/en.json';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * Issue #1499 (UX audit SALES-17, owner decision DEC-12 a) — the catalog's
 * dictionary, tree and bulk-operation screens say an action's result where it
 * was asked for, in a `role="status"` region that is mounted empty before the
 * action, not as a success `Alert` at the top of the page. A refusal stays the
 * page's destructive banner and clears the result. Attachment types are held in
 * `catalog-config-lists.test.tsx` since they moved onto the kit list page (S6).
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { AttributesManager } = await import('../../../../packages/modules/catalog/src/admin/pages/AttributesManager');
const { CategoriesTree } = await import('../../../../packages/modules/catalog/src/admin/pages/CategoriesTree');
const { BulkOperationDetailPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/BulkOperationDetailPage'
);

const CATALOG = catalog as Record<string, string>;
const BUNDLE = { core: core as Record<string, string>, catalog: CATALOG };

function tr(key: string, values: Record<string, string | number> = {}): string {
  const raw = CATALOG[key];
  if (raw === undefined) throw new Error(`missing catalog key ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name] ?? `{${name}}`));
}

function renderAt(ui: React.ReactElement, url = '/'): void {
  renderWithSession(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>, {
    session: adminSession({ permissions: ['*'] }),
    presence: modulePresence({ present: everyDeclaredModule() }),
    contributions: [],
    bundle: BUNDLE,
  });
}

function noSuccessBanner(): void {
  expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
}

/** The polite region that is a sibling of `element` — beside it, not a banner above the page. */
function statusBeside(element: HTMLElement): HTMLElement {
  const region = element.parentElement?.querySelector<HTMLElement>(':scope > [role="status"]');
  if (!region) throw new Error('no status region beside the control');
  return region;
}

/** Answers the kit's confirm dialog with its confirm button. */
async function confirmDialog(): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const buttons = within(dialog).getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  deleteSpy.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('AttributesManager — results beside New attribute (#1499, #1527)', () => {
  const ATTR = {
    id: 'a1',
    key: 'brand',
    label: { 'en-US': 'Brand' },
    labelDefault: 'Brand',
    valueType: 'string',
    enumValues: null,
    isSearchable: false,
    isFilterable: false,
    isVariantAxis: false,
    displayAsSlider: false,
    isComparable: false,
    isRequired: false,
    isPromoRule: false,
    isPriceRule: false,
    filterPosition: 0,
    isVisibleOnProductPage: true,
    massEditable: false,
  };

  it('says "created" beside New attribute once the dialog has closed, with no success banner', async () => {
    getSpy.mockResolvedValue({ data: [ATTR] });
    postSpy.mockResolvedValue({ data: { ...ATTR, id: 'a2', key: 'colour' } });
    renderAt(<AttributesManager />);
    const newButton = await screen.findByRole('button', { name: tr('attributes.action.new') });
    const region = statusBeside(newButton);
    expect(region.textContent).toBe('');

    fireEvent.click(newButton);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(tr('attributes.field.key')), { target: { value: 'colour' } });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('attributes.action.create') }));

    await waitFor(() => expect(region).toHaveTextContent(tr('attributes.success.create', { key: 'colour' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    noSuccessBanner();
  });

  it('says "updated" in the same region after an edit, and opening the editor again clears it', async () => {
    getSpy.mockResolvedValue({ data: [ATTR] });
    patchSpy.mockResolvedValue({ data: ATTR });
    renderAt(<AttributesManager />);
    const newButton = await screen.findByRole('button', { name: tr('attributes.action.new') });
    const region = statusBeside(newButton);

    fireEvent.click(await screen.findByRole('button', { name: 'Brand' }));
    const dialog = await screen.findByRole('dialog', { name: tr('attributes.edit.title', { key: 'brand' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('attributes.action.saveEdit') }));

    await waitFor(() => expect(region).toHaveTextContent(tr('attributes.success.update', { key: 'brand' })));
    expect(region.getAttribute('data-tone')).toBe('success');
    noSuccessBanner();

    fireEvent.click(screen.getByRole('button', { name: 'Brand' }));
    expect(region.textContent).toBe('');
  });
});

/** Picks an entry of a category row's actions menu (#1507), as a pointer user would. */
async function chooseRowAction(name: string, item: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: tr('categories.action.menu', { name }) }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

describe('CategoriesTree — results in the page header (#1499)', () => {
  const ROOT = {
    id: '33333333-3333-4333-8333-333333333301',
    parentCategoryId: null,
    name: { 'en-US': 'Furniture' },
    slug: 'furniture',
    sortOrder: 0,
    isActive: true,
  };

  it('says "deactivated" beside "New root category", with no success banner', async () => {
    getSpy.mockResolvedValue({ data: [ROOT] });
    patchSpy.mockResolvedValue({ data: { ...ROOT, isActive: false } });
    renderAt(<CategoriesTree />, '/catalog/categories');
    const newRoot = await screen.findByRole('button', { name: tr('categories.action.newRoot') });
    const region = statusBeside(newRoot);
    expect(region.textContent).toBe('');

    await chooseRowAction('Furniture', tr('categories.action.deactivate'));

    await waitFor(() => expect(region).toHaveTextContent(tr('categories.success.deactivated')));
    noSuccessBanner();

    // Opening a create form starts a new action.
    fireEvent.click(newRoot);
    expect(region.textContent).toBe('');
  });

  it('says "deleted" there too — the row is gone — and a refusal clears it and is the banner', async () => {
    getSpy.mockResolvedValue({ data: [ROOT] });
    deleteSpy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('down'));
    renderAt(<CategoriesTree />, '/catalog/categories');
    const region = statusBeside(await screen.findByRole('button', { name: tr('categories.action.newRoot') }));

    await chooseRowAction('Furniture', tr('categories.action.delete'));
    await confirmDialog();
    await waitFor(() => expect(region).toHaveTextContent(tr('categories.success.delete')));
    noSuccessBanner();

    await chooseRowAction('Furniture', tr('categories.action.delete'));
    await confirmDialog();
    expect(await screen.findByText(tr('categories.error.delete'))).toBeInTheDocument();
    expect(region.textContent).toBe('');
  });
});

describe('BulkOperationDetailPage — the undo result where Undo was (#1499)', () => {
  const OP_ID = '00000000-0000-4000-8000-00000000b499';
  const op = (undoStatus: 'none' | 'reverted'): Record<string, unknown> => ({
    id: OP_ID,
    type: 'product_bulk_update',
    status: 'completed',
    total: 2,
    processed: 2,
    succeeded: 2,
    skipped: 0,
    failed: 0,
    requestedByAdminUserId: '00000000-0000-4000-8000-0000000000ad',
    touchedFields: ['name'],
    results: [],
    error: null,
    logs: [],
    reversible: true,
    undoStatus,
    undoneAt: null,
    createdAt: '2026-11-13T10:00:00.000Z',
    startedAt: '2026-11-13T10:00:00.000Z',
    finishedAt: '2026-11-13T10:00:01.000Z',
  });

  function renderDetail(): void {
    renderAt(
      <Routes>
        <Route path="/catalog/bulk-operations/:id" element={<BulkOperationDetailPage />} />
      </Routes>,
      `/catalog/bulk-operations/${OP_ID}`,
    );
  }

  it('says the undo result in the summary header once Undo is gone, as a warning when some conflicted', async () => {
    let current = op('none');
    getSpy.mockImplementation(async () => ({ data: current }));
    postSpy.mockImplementation(async () => {
      current = op('reverted');
      return { data: { reverted: 1, conflicts: [{ productId: 'p2', reason: 'changed' }] } };
    });
    renderDetail();
    const undo = await screen.findByRole('button', { name: tr('bulkOperations.undo.action') });
    const region = statusBeside(undo);
    expect(region.textContent).toBe('');

    fireEvent.click(undo);
    await confirmDialog();

    await waitFor(() =>
      expect(region).toHaveTextContent(tr('bulkOperations.undo.result', { reverted: 1, conflicts: 1 })),
    );
    expect(region.getAttribute('data-tone')).toBe('warning');
    await waitFor(() => expect(screen.queryByRole('button', { name: tr('bulkOperations.undo.action') })).toBeNull());
    expect(region.isConnected).toBe(true);
    // The record's own "already undone" note does not repeat what was just said.
    expect(screen.queryByText(tr('bulkOperations.undo.alreadyReverted'))).toBeNull();
    noSuccessBanner();
    expect(document.querySelector('[data-slot="alert"][data-variant="warning"]')).toBeNull();
  });

  it('notes an edit undone earlier as plain text in the summary header, not a success banner', async () => {
    getSpy.mockResolvedValue({ data: op('reverted') });
    renderDetail();
    const note = await screen.findByText(tr('bulkOperations.undo.alreadyReverted'));
    expect(note.closest('[data-slot="alert"]')).toBeNull();
    expect(note.closest('[role="status"]')).toBeNull();
    noSuccessBanner();
  });
});
