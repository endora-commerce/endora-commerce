import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';
import { installOffsetParentShim } from '../../helpers/layout-shim';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import catalog from '../../../../packages/modules/catalog/i18n/en.json';

/**
 * Feature 163, Phase 15a (T156u; FR-010, FR-019, FR-053; spec Session 2026-10-25,
 * Q1-a, Q1-d, O-5, O-6) — the editor's two status values and its Archive / Restore,
 * and the bulk dialog's Archive / Restore.
 *
 * Archive and Restore are their own actions, not a status: each sits behind a
 * confirmation that says what it does, takes effect at once through its own route,
 * and is not offered without `catalog:write`. The editor says plainly that setting
 * Active does not restore an archived product (O-5).
 *
 * The bundles are the shipped English ones, so a missing key fails here rather than
 * rendering as its own name.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();

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
      delete: vi.fn(),
    },
  };
});

vi.mock('../../../../packages/modules/catalog/src/admin/components/ProductScopeEditor', () => ({
  ProductScopeEditor: vi.fn(() => null),
}));

// The focus assertions measure the dialog's focus trap, not jsdom's layout.
installOffsetParentShim();

const { ProductEditor } = await import('../../../../packages/modules/catalog/src/admin/pages/ProductEditor');
const { ProductsBulkEditDialog } = await import(
  '../../../../packages/modules/catalog/src/admin/components/ProductsBulkEditDialog'
);

const CATALOG = catalog as Record<string, string>;
const BUNDLE = { core: core as Record<string, string>, catalog: CATALOG };

function tr(key: string, values: Record<string, string | number> = {}): string {
  const raw = CATALOG[key];
  if (raw === undefined) throw new Error(`missing catalog key ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
}

const PRODUCT_ID = '11111111-1111-4111-8111-111111111163';
const SET_ID = '22222222-2222-4222-8222-222222222263';

function product(overrides: { status?: 'active' | 'inactive'; archivedAt?: string | null } = {}): unknown {
  return {
    id: PRODUCT_ID,
    sku: 'ARC-1',
    slug: 'arc-1',
    type: 'simple',
    status: overrides.status ?? 'active',
    archivedAt: overrides.archivedAt ?? null,
    name: { 'en-US': 'Oak chair', 'pl-PL': '' },
    description: { 'en-US': '', 'pl-PL': '' },
    visibility: 'public',
    attributeValues: {},
    attributeSetId: SET_ID,
  };
}

let current: unknown = product();

function primeGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('/catalog/categories')) return Promise.resolve({ data: [] });
    if (path.includes('/attribute-sets')) {
      return Promise.resolve({ data: [{ id: SET_ID, code: 'default', name: { 'en-US': 'Default' }, isSystem: true }] });
    }
    if (path === `/api/v1/admin/catalog/products/${PRODUCT_ID}`) return Promise.resolve({ data: current });
    return Promise.resolve({ data: [] });
  });
}

function renderEditor(options: { permissions?: readonly string[]; id?: string } = {}): void {
  renderWithSession(
    <MemoryRouter initialEntries={[`/catalog/products/${options.id ?? PRODUCT_ID}`]}>
      <Routes>
        <Route path="/catalog/products/:id" element={<ProductEditor />} />
      </Routes>
    </MemoryRouter>,
    {
      session: adminSession({ permissions: options.permissions ?? ['*'] }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      bundle: BUNDLE,
    },
  );
}

async function statusSelect(): Promise<HTMLSelectElement> {
  return (await screen.findByLabelText(tr('productEditor.field.status'))) as HTMLSelectElement;
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  current = product();
  primeGets();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProductEditor — two status values (FR-010)', () => {
  it('the global selector offers Active and Inactive only, labelled', async () => {
    renderEditor();
    const select = await statusSelect();
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(['active', 'inactive']);
    expect(options.map((o) => o.textContent)).toEqual(['Active', 'Inactive']);
    expect(select).toHaveAccessibleDescription(tr('productEditor.field.status.help'));
    expect(document.body.textContent).not.toMatch(/draft/i);
  });

  it('a new product starts Inactive (Q1-d)', async () => {
    renderEditor({ id: 'new' });
    expect((await statusSelect()).value).toBe('inactive');
    expect(screen.queryByRole('button', { name: tr('productEditor.action.archive') })).toBeNull();
  });

  it('the duplicate confirmation no longer speaks of a draft', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: /Duplicate/ }));
    expect(confirmSpy).toHaveBeenCalledWith(tr('productEditor.duplicateConfirm'));
    expect(tr('productEditor.duplicateConfirm')).not.toMatch(/draft/i);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('ProductEditor — Archive (FR-019)', () => {
  it('confirms what Archive does, archives at once, then shows the archived state with Restore', async () => {
    postSpy.mockResolvedValue({ data: product({ archivedAt: '2026-10-26T09:00:00.000Z' }) });
    const user = userEvent.setup();
    renderEditor();

    const archive = await screen.findByRole('button', { name: tr('productEditor.action.archive') });
    expect(screen.queryByRole('button', { name: tr('productEditor.action.restore') })).toBeNull();
    expect(screen.queryByTestId('product-archived-notice')).toBeNull();
    await user.click(archive);

    const dialog = screen.getByRole('dialog', { name: tr('productEditor.archive.confirmTitle') });
    // The dialog is described by the sentence that says what Archive does.
    expect(dialog).toHaveAccessibleDescription(tr('productEditor.archive.confirmBody'));
    expect(tr('productEditor.archive.confirmBody')).toMatch(/every sales channel/);
    expect(tr('productEditor.archive.confirmBody')).toMatch(/status .* stay as they are/);
    expect(postSpy).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: tr('productEditor.archive.confirm') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${PRODUCT_ID}/archive`, {}),
    );
    // Not a status write: nothing goes through the page's PATCH.
    expect(patchSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(await screen.findByTestId('product-archived-notice')).toHaveTextContent(tr('productEditor.archived.title'));
    expect(screen.getByText(tr('productEditor.archive.done'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('productEditor.action.restore') })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: tr('productEditor.action.archive') })).toBeNull();
    // The status is kept, drawn as a neutral outline beside the one coloured
    // Archived pill.
    expect((await statusSelect()).value).toBe('active');
    const head = document.querySelector('.b2b-page-head__title')!;
    expect(head.querySelector('.b2b-badge--dot')).toHaveClass('b2b-badge--outline');
    expect(head.querySelector('.b2b-badge--dot')).not.toHaveClass('b2b-badge--success');
    expect(within(head as HTMLElement).getByText(tr('productsList.status.archived'))).toHaveClass('b2b-badge--warn');
  });

  it('Cancel and Escape close the confirmation and send nothing', async () => {
    const user = userEvent.setup();
    renderEditor();
    const archive = await screen.findByRole('button', { name: tr('productEditor.action.archive') });

    await user.click(archive);
    await user.click(screen.getByRole('button', { name: tr('productEditor.archive.cancel') }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(archive);
    // Focus moves into the dialog (keyboard path), and Escape leaves it.
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('a refused Archive keeps the confirmation open with the reason', async () => {
    postSpy.mockRejectedValue(new ApiError(404, { error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } }));
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: tr('productEditor.action.archive') }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: tr('productEditor.archive.confirm') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Product not found.');
    expect(screen.queryByTestId('product-archived-notice')).toBeNull();
  });
});

describe('ProductEditor — an archived product and Restore (FR-019, O-5)', () => {
  beforeEach(() => {
    current = product({ status: 'active', archivedAt: '2026-10-20T00:00:00.000Z' });
  });

  it('says it is archived once, with Restore inside the notice, and the O-5 note at the selector', async () => {
    renderEditor();
    const notice = await screen.findByTestId('product-archived-notice');
    expect(notice).toHaveTextContent(`${tr('productEditor.archived.title')} ${tr('productEditor.archived.body')}`);
    expect(within(notice).getByRole('button', { name: tr('productEditor.action.restore') })).toBeInTheDocument();
    // Restore is offered once, in the notice; the header offers no Archive.
    expect(screen.getAllByRole('button', { name: tr('productEditor.action.restore') })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: tr('productEditor.action.archive') })).toBeNull();
    // "Setting Active does not restore" is said once, at the selector.
    const said = document.body.textContent!.split(tr('productEditor.field.status.archivedNote')).length - 1;
    expect(said).toBe(1);
    const select = await statusSelect();
    expect(select).toHaveAccessibleDescription(
      `${tr('productEditor.field.status.help')} ${tr('productEditor.field.status.archivedNote')}`,
    );
  });

  it('confirms what Restore does, restores at once, and the archived state goes', async () => {
    postSpy.mockResolvedValue({ data: product({ status: 'active', archivedAt: null }) });
    const user = userEvent.setup();
    renderEditor();
    await user.click(await screen.findByRole('button', { name: tr('productEditor.action.restore') }));

    const dialog = screen.getByRole('dialog', { name: tr('productEditor.restore.confirmTitle') });
    expect(dialog).toHaveAccessibleDescription(tr('productEditor.restore.confirmBody'));
    expect(tr('productEditor.restore.confirmBody')).toMatch(/status is Inactive it stays off/);
    await user.click(within(dialog).getByRole('button', { name: tr('productEditor.restore.confirm') }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/catalog/products/${PRODUCT_ID}/restore`, {}),
    );
    await waitFor(() => expect(screen.queryByTestId('product-archived-notice')).toBeNull());
    expect(screen.getByText(tr('productEditor.restore.done'))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: tr('productEditor.action.archive') })).toBeInTheDocument();
  });

  it('saving with status Active sends the status only and leaves the product archived', async () => {
    patchSpy.mockResolvedValue({ data: current });
    const user = userEvent.setup();
    renderEditor();
    await screen.findByTestId('product-archived-notice');
    await user.click(screen.getByRole('button', { name: /Save/ }));
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    const [, body] = patchSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(body['status']).toBe('active');
    expect(body).not.toHaveProperty('archived');
    expect(body).not.toHaveProperty('archivedAt');
    expect(postSpy).not.toHaveBeenCalled();
    expect(await screen.findByTestId('product-archived-notice')).toBeInTheDocument();
  });
});

describe('ProductEditor — catalog:read only', () => {
  it('offers neither Archive nor Restore, and still shows the archived state', async () => {
    current = product({ archivedAt: '2026-10-20T00:00:00.000Z' });
    renderEditor({ permissions: ['catalog:read'] });
    expect(await screen.findByTestId('product-archived-notice')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: tr('productEditor.action.archive') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('productEditor.action.restore') })).toBeNull();
  });
});

// ------------------------------------------------------------------ bulk dialog

const IDS = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3'];
const OPERATION_ID = '00000000-0000-4000-8000-0000000000f1';

function renderDialog(archiveAction: 'archive' | 'restore' | null): { onApplied: ReturnType<typeof vi.fn> } {
  const onApplied = vi.fn();
  renderWithSession(
    <MemoryRouter>
      <ProductsBulkEditDialog
        productIds={IDS}
        selectionScope="page"
        archiveAction={archiveAction}
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    </MemoryRouter>,
    { session: adminSession({ permissions: ['*'] }), bundle: BUNDLE },
  );
  return { onApplied };
}

function primeDialogGets(): void {
  getSpy.mockImplementation((path: string) => {
    if (path.includes('attributes/by-flag')) return Promise.resolve({ data: { items: [] } });
    if (path.includes('sales-channels')) return Promise.resolve({ items: [] });
    return Promise.resolve({ data: [] });
  });
}

describe('ProductsBulkEditDialog — Set status and bulk Archive / Restore (FR-053)', () => {
  beforeEach(() => {
    primeDialogGets();
  });

  it('"Set status" offers Active and Inactive only', async () => {
    renderDialog('archive');
    const statusGroup = await screen.findByRole('checkbox', { name: new RegExp(tr('productsList.bulkEdit.section.status')) });
    const select = statusGroup.closest('div')!.querySelector('select')!;
    expect(Array.from(select.options).map((o) => [o.value, o.textContent])).toEqual([
      ['active', 'Active'],
      ['inactive', 'Inactive'],
    ]);
  });

  it('archives the selection alone, after a confirmation, and reports per product with a way to undo', async () => {
    postSpy.mockResolvedValue({
      data: {
        bulkOperationId: OPERATION_ID,
        summary: { succeeded: 3, skipped: 0, failed: 0, total: 3 },
        results: [
          { productId: IDS[0], status: 'succeeded', changedFields: ['archivedAt'] },
          { productId: IDS[1], status: 'succeeded', changedFields: ['archivedAt'] },
          { productId: IDS[2], status: 'succeeded', changedFields: [] },
        ],
      },
    });
    const user = userEvent.setup();
    const { onApplied } = renderDialog('archive');

    const region = await screen.findByRole('region', { name: tr('productsList.bulkEdit.archive.title') });
    const open = within(region).getByRole('button', { name: tr('productsList.bulkEdit.archive.action', { count: 3 }) });
    expect(open).toHaveAccessibleDescription(tr('productsList.bulkEdit.archive.hint'));
    await user.click(open);

    const dialog = screen.getByRole('dialog', { name: tr('productsList.bulkEdit.archive.confirmTitle', { count: 3 }) });
    expect(dialog).toHaveAccessibleDescription(tr('productsList.bulkEdit.archive.confirmBody'));
    expect(postSpy).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: tr('productsList.bulkEdit.archive.confirm', { count: 3 }) }));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/bulk-update', {
        productIds: IDS,
        fields: { archived: true },
      }),
    );
    expect(onApplied).toHaveBeenCalledTimes(1);
    const heading = await screen.findByRole('heading', { name: tr('productsList.bulkEdit.archive.done', { count: 2 }) });
    // The confirm button unmounted with its step; focus moves to the outcome.
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(tr('productsList.bulkEdit.archive.unchanged', { count: 1 }))).toBeInTheDocument();
    // An inline run is not persisted as an operation: no link to a page that 404s.
    expect(screen.queryByRole('link', { name: tr('productsList.bulkEdit.viewOperation') })).toBeNull();
    // One modal root throughout.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('a queued Archive says it is archiving, and links to its operation', async () => {
    postSpy.mockResolvedValue({ data: { queued: true, bulkOperationId: OPERATION_ID, total: 3 } });
    const user = userEvent.setup();
    renderDialog('archive');
    await user.click(await screen.findByRole('button', { name: tr('productsList.bulkEdit.archive.action', { count: 3 }) }));
    await user.click(screen.getByRole('button', { name: tr('productsList.bulkEdit.archive.confirm', { count: 3 }) }));
    const heading = await screen.findByRole('heading', { name: tr('productsList.bulkEdit.archive.queued.title') });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByText(tr('productsList.bulkEdit.archive.queued.body', { total: 3 }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: tr('productsList.bulkEdit.viewOperation') })).toHaveAttribute(
      'href',
      `/catalog/bulk-operations/${OPERATION_ID}`,
    );
  });

  it('Escape on the confirmation step goes back to the form, not out of the dialog', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithSession(
      <MemoryRouter>
        <ProductsBulkEditDialog productIds={IDS} archiveAction="archive" onClose={onClose} />
      </MemoryRouter>,
      { session: adminSession({ permissions: ['*'] }), bundle: BUNDLE },
    );
    await user.click(await screen.findByRole('button', { name: tr('productsList.bulkEdit.archive.action', { count: 3 }) }));
    expect(screen.getByRole('dialog', { name: tr('productsList.bulkEdit.archive.confirmTitle', { count: 3 }) })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: tr('productsList.bulkEdit.title', { count: 3 }) })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(postSpy).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores with archived: false', async () => {
    postSpy.mockResolvedValue({ data: { queued: true, bulkOperationId: OPERATION_ID, total: 3 } });
    const user = userEvent.setup();
    renderDialog('restore');
    await user.click(await screen.findByRole('button', { name: tr('productsList.bulkEdit.restore.action', { count: 3 }) }));
    const dialog = screen.getByRole('dialog', { name: tr('productsList.bulkEdit.restore.confirmTitle', { count: 3 }) });
    expect(tr('productsList.bulkEdit.restore.hint')).toMatch(/Setting Active alone does not restore/);
    await user.click(within(dialog).getByRole('button', { name: tr('productsList.bulkEdit.restore.confirm', { count: 3 }) }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/products/bulk-update', {
        productIds: IDS,
        fields: { archived: false },
      }),
    );
    expect(await screen.findByRole('heading', { name: tr('productsList.bulkEdit.restore.queued.title') })).toBeInTheDocument();
  });

  it('is not offered while a field is touched — it never travels with other fields', async () => {
    const user = userEvent.setup();
    renderDialog('archive');
    const open = await screen.findByRole('button', { name: tr('productsList.bulkEdit.archive.action', { count: 3 }) });
    expect(open).toBeEnabled();
    await user.click(screen.getByRole('checkbox', { name: new RegExp(tr('productsList.bulkEdit.section.status')) }));
    expect(open).toBeDisabled();
    expect(open).toHaveAccessibleDescription(tr('productsList.bulkEdit.archiveAlone'));
  });

  it('a refused bulk Archive keeps the confirmation open with the reason', async () => {
    postSpy.mockRejectedValue(new ApiError(400, { error: { code: 'VALIDATION_FAILED', message: 'Refused.' } }));
    const user = userEvent.setup();
    renderDialog('archive');
    await user.click(await screen.findByRole('button', { name: tr('productsList.bulkEdit.archive.action', { count: 3 }) }));
    const dialog = screen.getByRole('dialog', { name: tr('productsList.bulkEdit.archive.confirmTitle', { count: 3 }) });
    await user.click(within(dialog).getByRole('button', { name: tr('productsList.bulkEdit.archive.confirm', { count: 3 }) }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Refused.');
    // Said once: the step's own alert, not a second copy above it.
    expect(screen.getAllByText('Refused.')).toHaveLength(1);
  });

  it('offers neither when the host passes none (no catalog:write)', async () => {
    renderDialog(null);
    // By role: "Status" is also the value label of "Set status in one channel" (163 T097).
    await screen.findByRole('checkbox', { name: new RegExp(`^${tr('productsList.bulkEdit.section.status')}`) });
    expect(screen.queryByRole('region', { name: tr('productsList.bulkEdit.archive.title') })).toBeNull();
    expect(screen.queryByRole('region', { name: tr('productsList.bulkEdit.restore.title') })).toBeNull();
  });
});
