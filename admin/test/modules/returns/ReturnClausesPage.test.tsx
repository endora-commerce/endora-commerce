import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * `specs/180-off-platform-complaints/` T074 (FR-B30, D-1, D-10; design review R-9): the
 * clauses page — a table, a dialog with per-language fields, the revision warning, a
 * confirmed delete and the empty state.
 */

installOffsetParentShim();

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }));

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => api.get(...args),
      post: (...args: unknown[]) => api.post(...args),
      put: (...args: unknown[]) => api.put(...args),
      patch: (...args: unknown[]) => api.patch(...args),
      delete: (...args: unknown[]) => api.delete(...args),
    },
  };
});

const { ReturnClausesPage } = await import('../../../../packages/modules/returns/src/admin/pages/ReturnClausesPage');

const CLAUSE = {
  id: '00000000-0000-4000-8000-0000000c1a05',
  label: { en: 'Inspection terms' },
  text: { en: 'We inspect the goods first.' },
  linkUrl: null,
  appliesTo: 'complaint',
  mode: 'must_accept',
  salesChannelId: null,
  weight: 100,
  isActive: true,
  revision: 3,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-02T10:00:00Z',
};

const BUNDLE = {
  returns: {
    'clauses.title': 'Clauses',
    'clauses.add': 'Add clause',
    'clauses.empty': 'No clauses yet',
    'clauses.col.label': 'Label',
    'clauses.col.channel': 'Channel',
    'clauses.col.appliesTo': 'Applies to',
    'clauses.col.mode': 'Mode',
    'clauses.col.active': 'Active',
    'clauses.col.revision': 'Revision',
    'clauses.col.updated': 'Updated',
    'clauses.missingLanguages': 'Missing: {languages}',
    'clauses.allChannels': 'All channels',
    'clauses.appliesTo.complaint': 'Complaints',
    'clauses.appliesTo.return': 'Returns',
    'clauses.appliesTo.both': 'Returns and complaints',
    'clauses.mode.must_accept': 'Must accept',
    'clauses.mode.inform_only': 'Inform only',
    'clauses.yes': 'Yes',
    'clauses.no': 'No',
    'clauses.actions': 'Actions for {label}',
    'clauses.edit': 'Edit',
    'clauses.delete': 'Delete',
    'clauses.dialog.create': 'New clause',
    'clauses.dialog.edit': 'Edit clause',
    'clauses.field.label': 'Label',
    'clauses.field.text': 'Text',
    'clauses.field.linkUrl': 'Link to the full terms',
    'clauses.field.channel': 'Sales channel',
    'clauses.field.appliesTo': 'Applies to',
    'clauses.field.mode': 'Mode',
    'clauses.field.active': 'Active',
    'clauses.field.weight': 'Order',
    'clauses.counter': '{count} / {max}',
    'clauses.revisionWarning': 'Saving a change to an active clause creates revision {next}.',
    'clauses.error.defaultLanguage': 'Enter the label and the text in {language}.',
    'clauses.save': 'Save',
    'clauses.cancel': 'Cancel',
    'clauses.deleteTitle': 'Delete this clause?',
    'clauses.deleteMessage': 'Cases keep the copy they stored.',
  },
};

let clauses: unknown[];

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  clauses = [CLAUSE];
  api.get.mockImplementation((path: string) => {
    if (path === '/api/v1/admin/returns/clauses') return Promise.resolve({ data: clauses });
    if (path.startsWith('/api/v1/admin/sales-channels')) return Promise.resolve({ items: [], page: 1, pageSize: 100, total: 0 });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: CLAUSE });
  api.patch.mockResolvedValue({ data: CLAUSE });
  api.delete.mockResolvedValue({ data: { ok: true } });
});

function renderPage(): void {
  renderWithI18n(
    <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
      <MemoryRouter>
        <ReturnClausesPage />
      </MemoryRouter>
    </AppLanguageContext.Provider>,
    BUNDLE,
  );
}

describe('ReturnClausesPage (180 T074)', () => {
  it('lists the clauses with their columns and the missing languages', async () => {
    renderPage();
    expect((await screen.findAllByText('Inspection terms')).length).toBeGreaterThan(0);
    for (const header of ['Label', 'Channel', 'Applies to', 'Mode', 'Active', 'Revision', 'Updated']) {
      expect(screen.getAllByText(header).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Missing: pl').length).toBeGreaterThan(0);
    expect(screen.getAllByText('All channels').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Complaints').length).toBeGreaterThan(0);
  });

  it('shows the empty state', async () => {
    clauses = [];
    renderPage();
    expect(await screen.findByText('No clauses yet')).toBeInTheDocument();
  });

  it('creates in a dialog with per-language fields, the channel, the kinds, the mode, active and the order', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add clause' }));
    const dialog = await screen.findByRole('dialog', { name: 'New clause' });
    expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['en', 'pl']);
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Terms');
    await userEvent.type(within(dialog).getByLabelText('Text'), 'Read me');
    expect(within(dialog).getByText('7 / 5000')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Link to the full terms'), 'https://shop.example/terms');
    await userEvent.selectOptions(within(dialog).getByLabelText('Mode'), 'inform_only');
    await userEvent.selectOptions(within(dialog).getByLabelText('Applies to'), 'return');
    expect(within(dialog).getByLabelText('Active')).toBeChecked();
    expect(within(dialog).getByLabelText('Order')).toHaveValue(100);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/admin/returns/clauses', {
        label: { en: 'Terms' },
        text: { en: 'Read me' },
        linkUrl: { en: 'https://shop.example/terms' },
        appliesTo: 'return',
        mode: 'inform_only',
        salesChannelId: null,
        weight: 100,
        isActive: true,
      }),
    );
  });

  it('moves to the default language’s tab and focuses the field when it is missing', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add clause' }));
    const dialog = await screen.findByRole('dialog', { name: 'New clause' });
    await userEvent.click(within(dialog).getByRole('tab', { name: 'pl' }));
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Warunki');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Enter the label and the text in en.')).toBeInTheDocument();
    expect(within(dialog).getByRole('tab', { name: 'en' })).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByLabelText('Label')).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('warns that editing an active clause creates a new revision', async () => {
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Actions for Inspection terms' }))[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit clause' });
    expect(within(dialog).getByText('Saving a change to an active clause creates revision 4.')).toBeInTheDocument();
  });

  it('deletes after a confirmation', async () => {
    renderPage();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Actions for Inspection terms' }))[0]!);
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Cases keep the copy they stored.')).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(`/api/v1/admin/returns/clauses/${CLAUSE.id}`));
  });
});
