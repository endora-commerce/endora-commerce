import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
 * page's destructive banner and clears the result.
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

const { AttachmentTypesPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttachmentTypesPage'
);
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

/** The form card's title — "Create attribute" is also the create button's label. */
async function formTitle(text: string): Promise<HTMLElement> {
  const found = await screen.findAllByText(text);
  const title = found.find((element) => element.closest('button') === null);
  if (!title) throw new Error(`no title "${text}"`);
  return title;
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

describe('AttachmentTypesPage — results beside Add and in the list header (#1499)', () => {
  const TYPE = { id: 't1', code: 'warranty', name: { 'en-US': 'Warranty' }, position: 0, usageCount: 0 };

  it('says "created" beside Add, with no success banner, and clears it on the next edit', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: TYPE });
    renderAt(<AttachmentTypesPage />);
    const add = await screen.findByRole('button', { name: tr('attachmentTypes.action.add') });
    const region = statusBeside(add);
    expect(region.textContent).toBe('');

    fireEvent.change(document.getElementById('atcode') as HTMLInputElement, { target: { value: 'warranty' } });
    fireEvent.change(document.getElementById('atnameen') as HTMLInputElement, { target: { value: 'Warranty' } });
    fireEvent.click(add);

    await waitFor(() => expect(region).toHaveTextContent(tr('attachmentTypes.success.create', { code: 'warranty' })));
    noSuccessBanner();

    fireEvent.change(document.getElementById('atcode') as HTMLInputElement, { target: { value: 'manual' } });
    expect(region.textContent).toBe('');
  });

  it('says "deleted" in the list header — the row is gone — and a refusal is the banner', async () => {
    getSpy.mockResolvedValue({ data: [TYPE] });
    deleteSpy.mockResolvedValue(undefined);
    renderAt(<AttachmentTypesPage />);
    const title = await screen.findByText(tr('attachmentTypes.list.title'));
    const region = statusBeside(title);
    expect(region.textContent).toBe('');

    fireEvent.click(await screen.findByRole('button', { name: tr('attachmentTypes.action.delete') }));
    await confirmDialog();

    await waitFor(() => expect(region).toHaveTextContent(tr('attachmentTypes.success.delete', { code: 'warranty' })));
    noSuccessBanner();

    deleteSpy.mockRejectedValueOnce(new Error('down'));
    fireEvent.click(screen.getByRole('button', { name: tr('attachmentTypes.action.delete') }));
    await confirmDialog();
    expect(await screen.findByText(tr('attachmentTypes.error.delete'))).toBeInTheDocument();
    expect(region.textContent).toBe('');
  });
});

describe('AttributesManager — results in the form header and above the table (#1499)', () => {
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

  it('says "created" in the form card header, with no success banner', async () => {
    getSpy.mockResolvedValue({ data: [] });
    postSpy.mockResolvedValue({ data: ATTR });
    renderAt(<AttributesManager />);
    const title = await formTitle(tr('attributes.create.title'));
    const region = statusBeside(title);
    expect(region.textContent).toBe('');

    fireEvent.change(document.getElementById('akey') as HTMLInputElement, { target: { value: 'brand' } });
    fireEvent.click(screen.getByRole('button', { name: tr('attributes.action.create') }));

    await waitFor(() => expect(region).toHaveTextContent(tr('attributes.success.create', { key: 'brand' })));
    noSuccessBanner();
  });

  it('keeps the form header mounted when a saved edit gives way to the create form', async () => {
    getSpy.mockResolvedValue({ data: [ATTR] });
    patchSpy.mockResolvedValue({ data: ATTR });
    renderAt(<AttributesManager />);
    const title = await formTitle(tr('attributes.create.title'));
    const region = statusBeside(title);

    fireEvent.click(await screen.findByRole('button', { name: tr('attributes.action.edit') }));
    expect(await screen.findByText(tr('attributes.edit.title', { key: 'brand' }))).toBe(title);
    const form = document.getElementById('akey')!.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(region).toHaveTextContent(tr('attributes.success.update', { key: 'brand' })));
    expect(await formTitle(tr('attributes.create.title'))).toBe(title);
    expect(region.isConnected).toBe(true);
    noSuccessBanner();
  });

  it('says "flags saved" above the table once the unsaved-flags bar is gone, and a flag edit clears it', async () => {
    getSpy.mockResolvedValue({ data: [ATTR] });
    patchSpy.mockResolvedValue({ data: { ...ATTR, massEditable: true } });
    renderAt(<AttributesManager />);
    const table = (await screen.findByText('brand')).closest('table')!;
    const region = table.parentElement?.parentElement?.querySelector<HTMLElement>('[role="status"]');
    if (!region) throw new Error('no status region above the table');
    expect(region.textContent).toBe('');

    fireEvent.click(within(table).getByLabelText('brand-massEditable'));
    fireEvent.click(screen.getByRole('button', { name: tr('attributes.action.save') }));

    await waitFor(() => expect(region.textContent).not.toBe(''));
    expect(region.getAttribute('data-tone')).toBe('success');
    noSuccessBanner();

    fireEvent.click(within(table).getByLabelText('brand-isSearchable'));
    expect(region.textContent).toBe('');
  });
});

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

    fireEvent.click(await screen.findByRole('button', { name: tr('categories.action.deactivate') }));

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

    fireEvent.click(await screen.findByRole('button', { name: tr('categories.action.delete') }));
    await confirmDialog();
    await waitFor(() => expect(region).toHaveTextContent(tr('categories.success.delete')));
    noSuccessBanner();

    fireEvent.click(screen.getByRole('button', { name: tr('categories.action.delete') }));
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
