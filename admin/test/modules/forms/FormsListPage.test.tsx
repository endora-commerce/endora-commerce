import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { COPY_ID, FORM_ID, LANGUAGE, detail, en, renderForms, summary } from './forms-fixtures';

/**
 * The forms list and the create screen (`specs/170-forms-module/` User Story 1, T032;
 * `contracts/admin-surfaces.md` §4): every form with its status, version, entries and warnings;
 * creating a draft; the row actions — open, duplicate, close or reopen, delete behind a dialog that
 * says what goes with the form.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
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

const { FormsListPage } = await import('../../../../packages/modules/forms/src/admin/pages/FormsListPage');
const { FormCreatePage } = await import('../../../../packages/modules/forms/src/admin/pages/FormCreatePage');

const LIST = [
  summary({ status: 'published', publishedVersionNumber: 2, entryCount: 7, warnings: [{ code: 'no_recipients' }] }),
  summary({ id: COPY_ID, key: 'survey', name: 'Survey', status: 'draft' }),
];

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/forms/languages')) {
      return Promise.resolve({ data: { languages: [LANGUAGE, 'pl-PL'], defaultLanguage: LANGUAGE } });
    }
    if (path.startsWith(`/api/v1/admin/forms/${FORM_ID}`)) {
      return Promise.resolve({ data: detail({ status: 'published', publishedVersionNumber: 2, entryCount: 7 }) });
    }
    if (path.startsWith('/api/v1/admin/forms')) return Promise.resolve({ data: { items: LIST, total: LIST.length } });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('FormsListPage', () => {
  it('lists every form with its key, status, version, entries and warnings', async () => {
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    const row = (await screen.findByRole('link', { name: 'Contact' })).closest('tr')!;
    expect(within(row).getByText('contact')).toBeTruthy();
    expect(within(row).getByText(en('status.published'))).toBeTruthy();
    expect(within(row).getByText(en('list.version', { number: 2 }))).toBeTruthy();
    expect(within(row).getByText('7')).toBeTruthy();
    expect(within(row).getByText(en('warnings.no_recipients'))).toBeTruthy();
    const draft = screen.getByRole('link', { name: 'Survey' }).closest('tr')!;
    expect(within(draft).getByText(en('list.notPublished'))).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact' }).getAttribute('href')).toBe(`/forms/${FORM_ID}`);
  });

  it('offers creating a form only with forms:write', async () => {
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    expect((await screen.findByRole('link', { name: en('list.create') })).getAttribute('href')).toBe('/forms/new');
  });

  it('hides the create link and the write actions from a reader', async () => {
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms', permissions: ['forms:read'] });
    await screen.findByRole('link', { name: 'Contact' });
    expect(screen.queryByRole('link', { name: en('list.create') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('list.actions', { name: 'Contact' }) })).toBeNull();
  });

  it('filters by text and status through the API', async () => {
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    await screen.findByRole('link', { name: 'Contact' });
    await userEvent.type(screen.getByLabelText(en('list.search')), 'cont');
    await userEvent.selectOptions(screen.getByLabelText(en('list.status')), 'published');
    await waitFor(() =>
      expect(getSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/v1\/admin\/forms\?.*q=cont.*status=published|status=published.*q=cont/)),
    );
  });

  it('duplicates a form and opens the copy', async () => {
    postSpy.mockResolvedValue({ data: detail({ id: COPY_ID, key: 'contact_copy' }) });
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    await userEvent.click(await screen.findByRole('button', { name: en('list.actions', { name: 'Contact' }) }));
    await userEvent.click(await screen.findByRole('menuitem', { name: en('list.duplicate') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/forms/${FORM_ID}/duplicate`, {}));
    expect(await screen.findByText('form builder screen')).toBeTruthy();
  });

  it('closes a published form at the revision it reads', async () => {
    postSpy.mockResolvedValue({ data: detail({ status: 'closed' }) });
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    await userEvent.click(await screen.findByRole('button', { name: en('list.actions', { name: 'Contact' }) }));
    await userEvent.click(await screen.findByRole('menuitem', { name: en('list.close') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith(`/api/v1/admin/forms/${FORM_ID}/close`, { expectedRevision: 3 }),
    );
  });

  it('deletes behind a dialog that says the versions and the entries go with the form', async () => {
    deleteSpy.mockResolvedValue(undefined);
    renderForms(<FormsListPage />, { path: '/forms', pattern: '/forms' });
    await userEvent.click(await screen.findByRole('button', { name: en('list.actions', { name: 'Contact' }) }));
    await userEvent.click(await screen.findByRole('menuitem', { name: en('list.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('delete.title', { name: 'Contact' }) });
    expect(within(dialog).getByText(en('delete.body'))).toBeTruthy();
    expect(within(dialog).getByText(en('delete.entries', { count: 7 }))).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: en('delete.confirm') }));
    // The entries go with the form only because the dialog said so (T079, FR-013).
    await waitFor(() =>
      expect(deleteSpy).toHaveBeenCalledWith(`/api/v1/admin/forms/${FORM_ID}?expectedRevision=3&confirmEntriesDeletion=true`),
    );
  });
});

describe('FormCreatePage', () => {
  it('refuses to send without a name, and says so', async () => {
    renderForms(<FormCreatePage />, { path: '/forms/new', pattern: '/forms/new' });
    await userEvent.click(await screen.findByRole('button', { name: en('create.submit') }));
    expect(await screen.findByText(en('create.error.name'))).toBeTruthy();
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('creates a draft in the chosen storefront language and opens the builder (US1-1)', async () => {
    postSpy.mockResolvedValue({ data: detail() });
    renderForms(<FormCreatePage />, { path: '/forms/new', pattern: '/forms/new' });
    await userEvent.type(await screen.findByLabelText(new RegExp(en('create.name'))), 'Contact the shop');
    await userEvent.selectOptions(screen.getByLabelText(en('create.language')), 'pl-PL');
    await userEvent.click(screen.getByRole('button', { name: en('create.submit') }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/forms', { name: 'Contact the shop', defaultLanguage: 'pl-PL' }),
    );
    expect(await screen.findByText('form builder screen')).toBeTruthy();
  });
});
