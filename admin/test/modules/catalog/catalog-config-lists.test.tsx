import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import core from '../../../../packages/modules/_i18n/i18n/en.json';
import catalog from '../../../../packages/modules/catalog/i18n/en.json';
import {
  adminSession,
  everyDeclaredModule,
  modulePresence,
  renderWithSession,
} from '../../helpers/render-with-session';

/**
 * UX audit slice S6 (issues #1439 DS-05, #1441 DS-07, #1448 DS-15) — the
 * catalogue's two dictionary lists, Attachment types and Attribute sets, are
 * the kit's list page: the list first, *New …* as the header's one primary
 * opening a dialog (no create form drawn above or under the list), row actions
 * in the row's "…" menu rather than a filled red Delete in every row, and an
 * `EmptyState` with its one action instead of a grey sentence.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
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
      patch: vi.fn(),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { AttachmentTypesPage } = await import(
  '../../../../packages/modules/catalog/src/admin/pages/AttachmentTypesPage'
);
const { AttributeSetsPage } = await import('../../../../packages/modules/catalog/src/admin/pages/AttributeSetsPage');

const CATALOG = catalog as Record<string, string>;
const CORE = core as Record<string, string>;
const BUNDLE = { core: CORE, catalog: CATALOG };

function tr(key: string, values: Record<string, string | number> = {}): string {
  const raw = CATALOG[key];
  if (raw === undefined) throw new Error(`missing catalog key ${key}`);
  return raw.replace(/\{(\w+)\}/g, (_m, name: string) => String(values[name] ?? `{${name}}`));
}

function renderPage(ui: React.ReactElement, permissions: string[] = ['*']): void {
  renderWithSession(<MemoryRouter>{ui}</MemoryRouter>, {
    session: adminSession({ permissions }),
    presence: modulePresence({ present: everyDeclaredModule() }),
    contributions: [],
    bundle: BUNDLE,
  });
}

/** The polite region that is a sibling of `element` — beside it, not a banner above the page. */
function statusBeside(element: HTMLElement): HTMLElement {
  const region = element.parentElement?.querySelector<HTMLElement>(':scope > [role="status"]');
  if (!region) throw new Error('no status region beside the control');
  return region;
}

function noBanner(): void {
  expect(document.querySelector('[data-slot="alert"]')).toBeNull();
}

/** No filled destructive button is drawn in a table row (DS-07). */
function noFilledRowDelete(): void {
  for (const row of document.querySelectorAll('tbody tr')) {
    expect(row.querySelector('[data-variant="destructive"]')).toBeNull();
  }
}

async function chooseRowAction(menuLabel: string, item: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: menuLabel }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function confirmDialog(): Promise<void> {
  const dialog = await screen.findByRole('dialog');
  const buttons = within(dialog).getAllByRole('button');
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe('AttachmentTypesPage — the kit list page (S6)', () => {
  const TYPE = { id: 't1', code: 'warranty', name: { 'en-US': 'Warranty', 'pl-PL': 'Gwarancja' }, position: 0, usageCount: 0 };
  const USED = { id: 't2', code: 'certificate', name: { 'en-US': 'Certificate' }, position: 1, usageCount: 3 };

  it('shows an EmptyState whose one action opens the create dialog, and no create form on the page', async () => {
    getSpy.mockResolvedValue({ data: [] });
    renderPage(<AttachmentTypesPage />);
    expect(await screen.findByText(tr('attachmentTypes.empty'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('form')).toBeNull();
    // While the list is empty the empty state's action is the only "New …" (Von Restorff).
    const news = screen.getAllByRole('button', { name: tr('attachmentTypes.action.new') });
    expect(news).toHaveLength(1);
    fireEvent.click(news[0]!);
    expect(await screen.findByRole('dialog', { name: tr('attachmentTypes.create.title') })).toBeInTheDocument();
  });

  it('creates from the header dialog, closes it and says "created" beside New, with no banner', async () => {
    getSpy.mockResolvedValue({ data: [USED] });
    postSpy.mockResolvedValue({ data: TYPE });
    renderPage(<AttachmentTypesPage />);
    const newButton = await screen.findByRole('button', { name: tr('attachmentTypes.action.new') });
    const region = statusBeside(newButton);
    expect(region.textContent).toBe('');

    fireEvent.click(newButton);
    const dialog = await screen.findByRole('dialog', { name: tr('attachmentTypes.create.title') });
    fireEvent.change(within(dialog).getByLabelText(tr('attachmentTypes.field.code')), { target: { value: 'warranty' } });
    fireEvent.change(within(dialog).getByLabelText(tr('attachmentTypes.field.nameEn')), { target: { value: 'Warranty' } });
    fireEvent.click(within(dialog).getByRole('button', { name: CORE['common.action.create']! }));

    await waitFor(() => expect(region).toHaveTextContent(tr('attachmentTypes.success.create', { code: 'warranty' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attachment-types', {
      code: 'warranty',
      name: { 'en-US': 'Warranty', 'pl-PL': 'Warranty' },
    });
    noBanner();
  });

  it('keeps the dialog open with the refusal and the typed values when create fails', async () => {
    getSpy.mockResolvedValue({ data: [USED] });
    postSpy.mockRejectedValue(new Error('down'));
    renderPage(<AttachmentTypesPage />);
    fireEvent.click(await screen.findByRole('button', { name: tr('attachmentTypes.action.new') }));
    const dialog = await screen.findByRole('dialog');
    const code = within(dialog).getByLabelText(tr('attachmentTypes.field.code'));
    fireEvent.change(code, { target: { value: 'manual' } });
    fireEvent.change(within(dialog).getByLabelText(tr('attachmentTypes.field.nameEn')), { target: { value: 'Manual' } });
    fireEvent.click(within(dialog).getByRole('button', { name: CORE['common.action.create']! }));

    expect(await within(dialog).findByText(tr('attachmentTypes.error.create'))).toBeInTheDocument();
    expect(code).toHaveValue('manual');
  });

  it('deletes through the row menu, confirmed, and says "deleted" beside New; a refusal stays in the dialog', async () => {
    getSpy.mockResolvedValue({ data: [TYPE, USED] });
    deleteSpy.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('down'));
    renderPage(<AttachmentTypesPage />);
    const region = statusBeside(await screen.findByRole('button', { name: tr('attachmentTypes.action.new') }));
    noFilledRowDelete();

    await chooseRowAction(tr('attachmentTypes.rowActions', { code: 'warranty' }), tr('attachmentTypes.action.delete'));
    await confirmDialog();
    await waitFor(() => expect(region).toHaveTextContent(tr('attachmentTypes.success.delete', { code: 'warranty' })));
    expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attachment-types/t1');

    await chooseRowAction(tr('attachmentTypes.rowActions', { code: 'warranty' }), tr('attachmentTypes.action.delete'));
    const dialog = await screen.findByRole('dialog');
    const buttons = within(dialog).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]!);
    // The refusal is said in the dialog, where the operator is looking, and it stays open.
    expect(await within(dialog).findByText(tr('attachmentTypes.error.delete'))).toBeInTheDocument();
    expect(region.textContent).toBe('');
  });

  it('says why a type in use cannot be deleted, without asking to confirm', async () => {
    getSpy.mockResolvedValue({ data: [USED] });
    renderPage(<AttachmentTypesPage />);
    await chooseRowAction(tr('attachmentTypes.rowActions', { code: 'certificate' }), tr('attachmentTypes.action.delete'));
    expect(await screen.findByText(tr('attachmentTypes.deleteInUse', { code: 'certificate', count: 3 }))).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('offers neither New nor the row menu without catalog:write', async () => {
    getSpy.mockResolvedValue({ data: [TYPE] });
    renderPage(<AttachmentTypesPage />, ['catalog:read']);
    expect(await screen.findByText('warranty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: tr('attachmentTypes.action.new') })).toBeNull();
    expect(screen.queryByRole('button', { name: tr('attachmentTypes.rowActions', { code: 'warranty' }) })).toBeNull();
  });

  it('offers Retry beside a load error', async () => {
    getSpy.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ data: [TYPE] });
    renderPage(<AttachmentTypesPage />);
    expect(await screen.findByText(tr('attachmentTypes.error.load'))).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: CORE['common.action.retry']! }));
    expect(await screen.findByText('warranty')).toBeInTheDocument();
  });
});

describe('AttributeSetsPage — the kit list page (S6)', () => {
  const SYSTEM = { id: 's0', code: 'default', name: { 'en-US': 'Default' }, isSystem: true, attributeCount: 2, productCount: 9 };
  const CUSTOM = { id: 's1', code: 'electronics', name: { 'en-US': 'Electronics' }, isSystem: false, attributeCount: 1, productCount: 0 };
  const ATTRS = [
    { id: 'a1', key: 'brand', label: { 'en-US': 'Brand' }, valueType: 'string' },
    { id: 'a2', key: 'voltage', label: { 'en-US': 'Voltage' }, valueType: 'number' },
  ];

  function serve(sets: unknown[]): void {
    getSpy.mockImplementation(async (url: string) => {
      if (url === '/api/v1/admin/catalog/attribute-sets') return { data: sets };
      if (url === '/api/v1/admin/catalog/attributes') return { data: ATTRS };
      if (url === '/api/v1/admin/catalog/attribute-sets/s1') {
        return { data: { ...CUSTOM, attributes: [{ id: 'a1', key: 'brand', label: { 'en-US': 'Brand' }, valueType: 'string' }] } };
      }
      throw new Error(`unexpected GET ${url}`);
    });
  }

  it('shows an EmptyState with the one New action, and no create card above the list', async () => {
    serve([]);
    renderPage(<AttributeSetsPage />);
    expect(await screen.findByText(tr('attributeSets.empty'))).toBeInTheDocument();
    expect(document.querySelector('form')).toBeNull();
    expect(screen.queryByRole('heading', { name: tr('attributeSets.create.title') })).toBeNull();
    expect(screen.getAllByRole('button', { name: tr('attributeSets.action.new') })).toHaveLength(1);
  });

  it('creates from the header dialog and says "created" beside New, with no banner', async () => {
    serve([SYSTEM]);
    postSpy.mockResolvedValue({ data: { ...CUSTOM, attributes: [] } });
    renderPage(<AttributeSetsPage />);
    const newButton = await screen.findByRole('button', { name: tr('attributeSets.action.new') });
    const region = statusBeside(newButton);

    fireEvent.click(newButton);
    const dialog = await screen.findByRole('dialog', { name: tr('attributeSets.create.title') });
    fireEvent.change(within(dialog).getByLabelText(tr('attributeSets.field.code')), { target: { value: 'electronics' } });
    fireEvent.change(within(dialog).getByLabelText(tr('attributeSets.field.nameEn')), { target: { value: 'Electronics' } });
    fireEvent.click(within(dialog).getByRole('button', { name: tr('attributeSets.create.submit') }));

    await waitFor(() => expect(region).toHaveTextContent(tr('attributeSets.success.create', { name: 'electronics' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attribute-sets', {
      code: 'electronics',
      name: { 'en-US': 'Electronics' },
    });
    noBanner();
  });

  it('labels the system set in the admin language and puts its actions in the row menu', async () => {
    serve([SYSTEM, CUSTOM]);
    renderPage(<AttributeSetsPage />);
    expect(await screen.findByText(tr('attributeSets.badge.system'))).toBeInTheDocument();
    noFilledRowDelete();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: tr('attributeSets.rowActions', { code: 'default' }) }));
    const del = await screen.findByRole('menuitem', { name: tr('attributeSets.action.delete') });
    expect(del).toHaveAttribute('data-disabled');
    expect(del).toHaveAttribute('title', tr('attributeSets.deleteHint.system'));
  });

  it('manages a set\'s attributes in a dialog that applies each change at once', async () => {
    serve([CUSTOM]);
    postSpy.mockResolvedValue({
      data: {
        ...CUSTOM,
        attributes: [
          { id: 'a1', key: 'brand', label: { 'en-US': 'Brand' }, valueType: 'string' },
          { id: 'a2', key: 'voltage', label: { 'en-US': 'Voltage' }, valueType: 'number' },
        ],
      },
    });
    renderPage(<AttributeSetsPage />);
    await chooseRowAction(tr('attributeSets.rowActions', { code: 'electronics' }), tr('attributeSets.action.manage'));
    const dialog = await screen.findByRole('dialog', { name: tr('attributeSets.manage.title', { code: 'electronics' }) });
    expect(await within(dialog).findByText('brand')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: tr('attributeSets.action.assign', { key: 'voltage' }) }));
    await waitFor(() =>
      expect(within(dialog).getByRole('status')).toHaveTextContent(tr('attributeSets.success.assign', { code: 'electronics' })),
    );
    expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attribute-sets/s1/attributes', {
      assignments: [{ attributeId: 'a2' }],
    });
    noBanner();
  });

  it('deletes a custom set through the row menu, confirmed, and says so beside New', async () => {
    serve([CUSTOM]);
    deleteSpy.mockResolvedValue(undefined);
    renderPage(<AttributeSetsPage />);
    await chooseRowAction(tr('attributeSets.rowActions', { code: 'electronics' }), tr('attributeSets.action.delete'));
    await confirmDialog();
    expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/catalog/attribute-sets/s1');
    // The last row is gone, so the region beside the empty state's action says it.
    await waitFor(() => expect(screen.getByText(tr('attributeSets.success.delete', { code: 'electronics' }))).toBeInTheDocument());
    noBanner();
  });

  it('offers neither New nor Delete without catalog:write', async () => {
    serve([CUSTOM]);
    renderPage(<AttributeSetsPage />, ['catalog:read']);
    expect(await screen.findByText('electronics')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: tr('attributeSets.action.new') })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: tr('attributeSets.rowActions', { code: 'electronics' }) }));
    expect(await screen.findByRole('menuitem', { name: tr('attributeSets.action.view') })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: tr('attributeSets.action.delete') })).toBeNull();
  });
});
