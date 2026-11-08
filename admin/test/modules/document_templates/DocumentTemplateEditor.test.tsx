import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Config, Data } from '@puckeditor/core';
// Puck paints into an iframe jsdom will not draw; the editor takes `<Puck>` from
// page-builder-core's editor barrel, so that is where the probe goes.
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { adminSession, everyDeclaredModule, modulePresence, renderWithSession } from '../../helpers/render-with-session';
import { expectNoAxeViolations } from '../../helpers/axe';
import { BUNDLE, comparisonConfig, detail, invoiceConfig, typeDetail } from './fixtures';

/**
 * `specs/152-compare-pdf-template/` T037, T047, T062 — the document-template
 * editor (`contracts/admin-ui.md` §3). Puck paints into an iframe jsdom will
 * not draw, so it is replaced by a probe that records the config and the data
 * it was handed: what is asserted is the editor's composition — the palette is
 * the type's and nothing else, a stored block nothing renders is kept, the
 * language switcher and merge fields follow the type — and its save, conflict,
 * read-only and preview behaviour.
 */

let lastPuck: { config: Config; data: Data } | null = null;
vi.mock('@endora-commerce/page-builder-core/editor', async (importOriginal) => {
  const { useBlockRenderEnvironment } = await import('@endora-commerce/page-builder-core/contributions');
  return {
    ...(await importOriginal<typeof import('@endora-commerce/page-builder-core/editor')>()),
    Puck: (props: { config: Config; data: Data }) => {
      lastPuck = props;
      // What a block on the canvas reads as the language of the tree it draws (issue #888).
      const { language, preview } = useBlockRenderEnvironment();
      return <div data-testid="puck" data-language={language} data-preview={String(preview)} />;
    },
  };
});

const api = {
  getTemplate: vi.fn(),
  getDocumentType: vi.fn(),
  getBuilderConfig: vi.fn(),
  listContentLanguages: vi.fn(),
  saveTemplateContent: vi.fn(),
  setDefaultTemplate: vi.fn(),
  clearDefaultTemplate: vi.fn(),
  previewDocument: vi.fn(),
};
vi.mock('../../../../packages/modules/document_templates/src/admin/api', () => api);

const { DocumentTemplateEditor } = await import(
  '../../../../packages/modules/document_templates/src/admin/pages/DocumentTemplateEditor'
);

function renderEditor(permissions: string[] = ['*']): HTMLElement {
  return renderWithSession(
    <StrictMode>
      <MemoryRouter initialEntries={['/document-templates/00000000-0000-4000-8000-0000000000d1']}>
        <Routes>
          <Route path="/document-templates/:id" element={<DocumentTemplateEditor />} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
    {
      session: adminSession({ permissions }),
      presence: modulePresence({ present: everyDeclaredModule() }),
      contributions: [
        {
          moduleId: 'comparisons',
          contributions: {
            blocks: [
              {
                name: 'comparisons.ComparisonHeader',
                context: 'document',
                component: () => Promise.resolve({ default: { render: () => <p>contributed-header</p> } }),
              },
            ],
          },
        },
      ],
      bundle: BUNDLE,
    },
  ).container;
}

const components = (): string[] => Object.keys(lastPuck?.config.components ?? {});

describe('DocumentTemplateEditor (spec 152)', () => {
  beforeEach(() => {
    lastPuck = null;
    for (const fn of Object.values(api)) fn.mockReset();
    api.getTemplate.mockResolvedValue(detail());
    api.getDocumentType.mockResolvedValue(typeDetail());
    api.getBuilderConfig.mockResolvedValue(comparisonConfig());
    api.listContentLanguages.mockResolvedValue(['en-US', 'pl-PL', 'de-DE']);
  });

  it("offers the comparison type's palette — its three blocks and the six general ones — and no invoice block (FR-011)", async () => {
    renderEditor();
    await waitFor(() => expect(lastPuck).not.toBeNull());
    const names = components().filter((name) => name !== 'gone.Block');
    expect(names).toHaveLength(9);
    expect(names.some((name) => name.startsWith('invoices.'))).toBe(false);
    expect(lastPuck!.config.categories?.['comparison']?.components).toEqual([
      'comparisons.ComparisonHeader',
      'comparisons.ComparisonTable',
      'comparisons.ComparisonShareLink',
    ]);
  });

  it('keeps a stored block nothing renders, with its props (FR-018)', async () => {
    renderEditor();
    await waitFor(() => expect(lastPuck).not.toBeNull());
    expect(components()).toContain('gone.Block');
    expect(lastPuck!.data.content.find((node) => node.type === 'gone.Block')?.props).toEqual({ id: 'g', keep: 1 });
  });

  it('shows the merge fields and every content language, and starts a new one from the current (FR-014, FR-017)', async () => {
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('language-switcher')).toBeTruthy());
    expect(screen.getByTestId('merge-fields')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('editor.language'), { target: { value: 'de-DE' } });
    fireEvent.click(await screen.findByRole('button', { name: 'editor.startFrom' }));
    await waitFor(() => expect(lastPuck!.data.content.length).toBe(2));
  });

  it('saves the edited language with the loaded version, and a stale version opens the reload dialog (FR-006)', async () => {
    api.saveTemplateContent.mockRejectedValueOnce(
      new ApiError(409, { error: { code: 'VERSION_CONFLICT', message: 'changed', requestId: 'r' } } as never),
    );
    renderEditor();
    await waitFor(() => expect(lastPuck).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'editor.save' }));
    await waitFor(() => expect(api.saveTemplateContent).toHaveBeenCalled());
    expect(api.saveTemplateContent.mock.calls[0]?.slice(0, 2)).toEqual(['00000000-0000-4000-8000-0000000000d1', 'en-US']);
    expect(api.saveTemplateContent.mock.calls[0]?.[3]).toBe(3);
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'editor.conflict.reload' })).toBeTruthy();
  });

  it('previews the canvas in the edited language without saving (FR-015)', async () => {
    api.previewDocument.mockResolvedValue(new Blob(['%PDF-']));
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    renderEditor();
    await waitFor(() => expect(lastPuck).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'editor.preview' }));
    await waitFor(() => expect(api.previewDocument).toHaveBeenCalledWith('comparisons.comparison', 'en-US', expect.anything()));
    expect(api.saveTemplateContent).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('is read-only without document_templates:write — preview stays (FR-060)', async () => {
    const container = renderEditor(['document_templates:read']);
    await waitFor(() => expect(lastPuck).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'editor.save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'page.setDefault' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'page.clearDefault' })).toBeNull();
    expect(screen.getByRole('button', { name: 'editor.preview' })).toBeTruthy();
    expect(screen.getByText('editor.readOnly')).toBeTruthy();
    await expectNoAxeViolations(container);
  });

  it('an invoice template: ten invoice blocks and a contributed stand-in, no general block, no language switcher, no merge fields (FR-080, FR-085, T062)', async () => {
    api.getTemplate.mockResolvedValue(
      detail({ documentType: 'invoices.invoice', content: { schemaVersion: 1, languages: { 'pl-PL': { root: { props: {} }, content: [] } } } }),
    );
    api.getDocumentType.mockResolvedValue(
      typeDetail({ code: 'invoices.invoice', moduleId: 'invoices', labelKey: 'documentTypes.invoice.label', languages: ['pl-PL'], variables: [{ key: 'date', labelKey: 'variables.date', ownerModule: 'document_templates', scope: 'body' }] }),
    );
    api.getBuilderConfig.mockResolvedValue(invoiceConfig());
    renderEditor();
    await waitFor(() => expect(lastPuck).not.toBeNull());
    expect(components().filter((name) => name.startsWith('invoices.'))).toHaveLength(10);
    expect(components()).toContain('ksef.InvoiceSection');
    expect(components().some((name) => name.startsWith('document_templates.'))).toBe(false);
    expect(screen.queryByTestId('language-switcher')).toBeNull();
    expect(screen.queryByTestId('merge-fields')).toBeNull();
  });

  it('hands the edited language to the blocks on the canvas, as a preview (issue #888)', async () => {
    api.getTemplate.mockResolvedValue(
      detail({ documentType: 'invoices.invoice', content: { schemaVersion: 1, languages: { 'pl-PL': { root: { props: {} }, content: [] } } } }),
    );
    api.getDocumentType.mockResolvedValue(
      typeDetail({ code: 'invoices.invoice', moduleId: 'invoices', labelKey: 'documentTypes.invoice.label', languages: ['pl-PL'] }),
    );
    api.getBuilderConfig.mockResolvedValue(invoiceConfig());
    renderEditor();
    await waitFor(() => expect(screen.getByTestId('puck').getAttribute('data-language')).toBe('pl-PL'));
    expect(screen.getByTestId('puck').getAttribute('data-preview')).toBe('true');
  });
});
