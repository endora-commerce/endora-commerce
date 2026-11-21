import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { adminSession, everyDeclaredModule, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { BUNDLE, COMPARISON, INVOICE, summary } from './fixtures';

/**
 * `specs/152-compare-pdf-template/` T037 — *Document templates*
 * (`contracts/admin-ui.md` §2): one section per available type with its built-in
 * layout and its templates by scope, the default marked; the write controls
 * absent without the write code; set-default and the confirmed delete of a
 * default; axe.
 *
 * Issue #1535 (UX audit CONTENT-18) — the kit list page: **one** primary
 * *New template* in the header, the document type chosen in its dialog, and
 * every row's secondary actions in a `RowActionMenu` (the name is the link).
 */

const api = {
  listDocumentTypes: vi.fn(),
  listTemplates: vi.fn(),
  listSalesChannels: vi.fn(),
  setDefaultTemplate: vi.fn(),
  clearDefaultTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  createTemplate: vi.fn(),
  getDocumentType: vi.fn(),
  previewDocument: vi.fn(),
};
vi.mock('../../../../packages/modules/document_templates/src/admin/api', () => api);

const { DocumentTemplatesPage } = await import(
  '../../../../packages/modules/document_templates/src/admin/pages/DocumentTemplatesPage'
);

function renderPage(permissions: string[] = ['*'], path = '/document-templates'): HTMLElement {
  return renderWithSession(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <DocumentTemplatesPage />
      </MemoryRouter>
    </StrictMode>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [],
      bundle: BUNDLE,
    },
  ).container;
}

const section = (code: string): HTMLElement => screen.getByTestId(`document-type-${code}`);

/** Opens a row's action menu; Radix opens on pointer-down. */
async function openRowMenu(name: string, within_: HTMLElement | null = null): Promise<HTMLElement> {
  const label = `Actions for ${name}`;
  const trigger = within_ ? within(within_).getByRole('button', { name: label }) : await screen.findByRole('button', { name: label });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  return screen.findByRole('menu');
}

const DRAFT = '00000000-0000-4000-8000-0000000000d3';

describe('DocumentTemplatesPage (spec 152, issue #1535)', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.listDocumentTypes.mockResolvedValue([COMPARISON, INVOICE]);
    api.listSalesChannels.mockResolvedValue([{ id: '00000000-0000-4000-8000-0000000000c1', name: 'Channel B' }]);
    api.listTemplates.mockImplementation(async (type: string) =>
      type === 'comparisons.comparison'
        ? [
            summary(),
            summary({ id: '00000000-0000-4000-8000-0000000000d2', name: 'Brand B', isDefault: true, salesChannelId: '00000000-0000-4000-8000-0000000000c1', salesChannelName: 'Channel B' }),
            summary({ id: DRAFT, name: 'Draft', isDefault: false }),
          ]
        : [],
    );
  });

  it('shows one section per available type, its built-in layout and its templates by scope (FR-001, FR-002)', async () => {
    renderPage();
    await waitFor(() => expect(section('comparisons.comparison')).toBeTruthy());
    const comparison = within(section('comparisons.comparison'));
    expect(comparison.getByRole('heading', { name: 'documentTypes.comparison.label' })).toBeTruthy();
    expect(comparison.getByText('page.builtIn')).toBeTruthy();
    expect(comparison.getAllByText('page.allChannels').length).toBeGreaterThan(0);
    expect(comparison.getByText('Channel B')).toBeTruthy();
    expect(comparison.getAllByText('page.default')).toHaveLength(2);
    // The name is the link to the editor; there is no separate Edit button.
    expect(comparison.getByRole('link', { name: 'Draft' }).getAttribute('href')).toBe(`/document-templates/${DRAFT}`);
    expect(screen.queryAllByRole('button', { name: 'page.edit' })).toHaveLength(0);
    expect(within(section('invoices.invoice')).getByText('page.noTemplates')).toBeTruthy();
  });

  it('has exactly one New template — in the header — and no per-type create button (Von Restorff)', async () => {
    renderPage();
    await waitFor(() => expect(section('comparisons.comparison')).toBeTruthy());
    expect(screen.getAllByRole('button', { name: 'page.newTemplate' })).toHaveLength(1);
    expect(within(section('comparisons.comparison')).queryByRole('button', { name: 'page.newTemplate' })).toBeNull();
    // A row carries no visible button of its own: its actions are behind its menu.
    expect(screen.queryAllByRole('button', { name: 'page.setDefault' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'page.delete' })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: 'page.duplicate' })).toHaveLength(0);
  });

  it('asks for the document type in the New template dialog, and creates a template of the chosen type', async () => {
    api.createTemplate.mockResolvedValue({ id: '00000000-0000-4000-8000-0000000000e1' });
    renderPage();
    await waitFor(() => expect(section('invoices.invoice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'page.newTemplate' }));
    const dialog = await screen.findByRole('dialog');
    const typeSelect = within(dialog).getByLabelText('dialog.documentType') as HTMLSelectElement;
    expect(typeSelect.value).toBe('comparisons.comparison');
    fireEvent.change(typeSelect, { target: { value: 'invoices.invoice' } });
    fireEvent.change(within(dialog).getByLabelText('dialog.name'), { target: { value: 'Invoice A' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'dialog.create' }));
    await waitFor(() => expect(api.createTemplate).toHaveBeenCalledTimes(1));
    expect(api.createTemplate.mock.calls[0]?.[0]).toMatchObject({ documentType: 'invoices.invoice', name: 'Invoice A', source: { kind: 'built_in' } });
  });

  it('preselects the type named in ?type= in the New template dialog (Tesler)', async () => {
    renderPage(['*'], '/document-templates?type=invoices.invoice');
    await waitFor(() => expect(section('invoices.invoice')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'page.newTemplate' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('dialog.documentType') as HTMLSelectElement).value).toBe('invoices.invoice');
  });

  it('duplicates from the row menu, with the type fixed', async () => {
    renderPage();
    const menu = await openRowMenu('Draft');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'page.duplicate' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('dialog.documentType')).toBeNull();
    expect((within(dialog).getByLabelText('dialog.source') as HTMLSelectElement).value).toBe(DRAFT);
  });

  it('sets the default from the row menu with the loaded version, and says so beside the header action', async () => {
    api.setDefaultTemplate.mockResolvedValue(summary({ id: DRAFT, name: 'Draft' }));
    renderPage();
    const menu = await openRowMenu('Draft');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'page.setDefault' }));
    await waitFor(() => expect(api.setDefaultTemplate).toHaveBeenCalledWith(DRAFT, 3));
    await waitFor(() => expect(screen.getByTestId('document-templates-status').textContent).toContain('page.defaultSet'));
  });

  it('deleting a default asks first, says what applies instead, and confirms (FR-007)', async () => {
    api.deleteTemplate.mockResolvedValue(undefined);
    renderPage();
    const menu = await openRowMenu('Brand A');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'page.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('dialog.deleteDefaultGlobal')).toBeTruthy();
    await answerConfirm(true);
    await waitFor(() => expect(api.deleteTemplate).toHaveBeenCalledWith('00000000-0000-4000-8000-0000000000d1', 3, true));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Brand A' })).toBeNull());
  });

  it('offers no mutating control without document_templates:write (FR-060)', async () => {
    renderPage(['document_templates:read']);
    await waitFor(() => expect(section('comparisons.comparison')).toBeTruthy());
    expect(screen.queryAllByRole('button', { name: 'page.newTemplate' })).toHaveLength(0);
    // A template row has nothing but its link; the built-in row keeps its preview.
    expect(screen.queryByRole('button', { name: 'Actions for Draft' })).toBeNull();
    const menu = await openRowMenu('page.builtIn (documentTypes.comparison.label)', section('comparisons.comparison'));
    expect(within(menu).getByRole('menuitem', { name: 'editor.preview' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'page.createFromThis' })).toBeNull();
  });

  it('previews the built-in layout in a dialog rather than a pop-up', async () => {
    api.getDocumentType.mockResolvedValue({ builtInContent: { schemaVersion: 1, languages: { 'en-US': { root: { props: {} }, content: [] } } } });
    api.previewDocument.mockResolvedValue(new Blob(['%PDF-']));
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    const open = vi.spyOn(window, 'open');
    renderPage();
    await waitFor(() => expect(section('invoices.invoice')).toBeTruthy());
    const menu = await openRowMenu('page.builtIn (documentTypes.invoice.label)', section('invoices.invoice'));
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'editor.preview' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('iframe')?.getAttribute('src')).toBe('blob:x');
    expect(within(dialog).getByRole('link', { name: 'editor.previewOpen' }).getAttribute('href')).toBe('blob:x');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('says what to do when no document type is available', async () => {
    api.listDocumentTypes.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText('page.emptyTitle')).toBeTruthy());
    expect(screen.getByText('page.empty')).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: 'page.newTemplate' })).toHaveLength(0);
  });

  it('marks the type named in ?type= and has no axe violations', async () => {
    const container = renderPage(['*'], '/document-templates?type=invoices.invoice');
    await waitFor(() => expect(section('invoices.invoice').className).toContain('ring-2'));
    await expectNoAxeViolations(container);
  });
});
