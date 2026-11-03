import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setMobileViewport } from '../../setup';
import { CHANNEL_ID, ENTRY_ID, FORM_ID, OTHER_ENTRY_ID, en, entrySummary, renderForms, summary } from './forms-fixtures';

/**
 * The entries list (`specs/170-forms-module/` User Story 4, T074; FR-048, FR-050, FR-052;
 * `contracts/admin-surfaces.md` §4): newest first, filtered by form, statuses, a date range and a
 * search; older entries a step away; selection with a bulk delete behind a dialog that says it is
 * for good; the export offered only to a holder of `forms:entries_export`, and only once a form is
 * chosen, since its columns are that form's.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
  return {
    ...actual,
    apiClient: {
      get: (...args: unknown[]) => getSpy(...args),
      post: (...args: unknown[]) => postSpy(...args),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const { EntriesListPage } = await import('../../../../packages/modules/forms/src/admin/pages/EntriesListPage');

const API = '/api/v1/admin/forms/entries';
const ENTRIES = [
  entrySummary({ submitterEmail: 'grace@example.com', status: 'new' }),
  entrySummary({ id: OTHER_ENTRY_ID, submitterEmail: null, status: 'spam', submittedAt: '2026-10-31T08:00:00.000Z' }),
];
const READ = ['forms:read', 'forms:entries_read'];
const WRITE = [...READ, 'forms:entries_write'];
const EXPORT = [...READ, 'forms:entries_export'];

const entryCalls = (): string[] =>
  getSpy.mock.calls.map(([path]) => String(path)).filter((path) => path.startsWith(API));
const lastQuery = (): URLSearchParams => new URLSearchParams(entryCalls().at(-1)!.split('?')[1] ?? '');

beforeEach(() => {
  setMobileViewport(false);
  getSpy.mockReset();
  postSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith(API)) {
      const cursor = new URLSearchParams(path.split('?')[1] ?? '').get('cursor');
      return Promise.resolve({
        data: cursor
          ? { items: [entrySummary({ id: '00000000-0000-4000-8000-0000000e0003', submittedAt: '2026-10-01T08:00:00.000Z' })], nextCursor: null }
          : { items: ENTRIES, nextCursor: 'next-page' },
      });
    }
    if (path.startsWith('/api/v1/admin/forms')) {
      return Promise.resolve({ data: { items: [summary({ status: 'published', entryCount: 2 })], total: 1 } });
    }
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: CHANNEL_ID, code: 'default', name: { 'en-US': 'Default store' }, active: true }] });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('EntriesListPage', () => {
  it('lists entries newest first with their form, sender and status', async () => {
    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: READ });
    const first = (await screen.findByText('grace@example.com')).closest('tr')!;
    expect(within(first).getByText('Contact')).toBeTruthy();
    expect(within(first).getByText(en('entryStatus.new'))).toBeTruthy();
    const second = screen.getByText(en('entries.anonymous')).closest('tr')!;
    expect(within(second).getByText(en('entryStatus.spam'))).toBeTruthy();
    expect(lastQuery().get('limit')).toBe('50');
    expect(screen.getByRole('link', { name: /grace@example\.com/ }).getAttribute('href')).toBe(`/forms/entries/${ENTRY_ID}`);
  });

  it('filters by form, statuses, a date range and a search (FR-050)', async () => {
    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: READ });
    await screen.findByText('grace@example.com');
    await userEvent.selectOptions(screen.getByLabelText(en('entries.filter.form')), FORM_ID);
    await waitFor(() => expect(lastQuery().get('formId')).toBe(FORM_ID));
    const statuses = screen.getByRole('group', { name: en('entries.filter.status') });
    await userEvent.click(within(statuses).getByLabelText(en('entryStatus.new')));
    await userEvent.click(within(statuses).getByLabelText(en('entryStatus.spam')));
    await waitFor(() => expect(lastQuery().getAll('status')).toEqual(['new', 'spam']));
    await userEvent.type(screen.getByLabelText(en('entries.filter.from')), '2026-10-01');
    await waitFor(() => expect(lastQuery().get('submittedFrom')).toBe(new Date('2026-10-01T00:00:00').toISOString()));
    await userEvent.type(screen.getByLabelText(en('entries.filter.to')), '2026-10-31');
    await waitFor(() => expect(lastQuery().get('submittedTo')).toBe(new Date('2026-10-31T23:59:59.999').toISOString()));
    await userEvent.type(screen.getByLabelText(en('entries.filter.search')), 'ada');
    await waitFor(() => expect(lastQuery().get('q')).toBe('ada'));
  });

  it('shows older entries a step at a time, by the cursor the page answered', async () => {
    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: READ });
    await screen.findByText('grace@example.com');
    await userEvent.click(screen.getByRole('button', { name: en('entries.loadMore') }));
    await waitFor(() => expect(lastQuery().get('cursor')).toBe('next-page'));
    expect(await screen.findAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: en('entries.loadMore') })).toBeNull();
  });

  it('deletes the selected entries behind a dialog that says it is for good (US4-7)', async () => {
    postSpy.mockResolvedValue({ data: { deleted: 2 } });
    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: WRITE });
    await screen.findByText('grace@example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: en('entries.selectAll') }));
    await userEvent.click(screen.getByRole('button', { name: en('entries.deleteSelected', { count: 2 }) }));
    const dialog = await screen.findByRole('dialog', { name: en('entries.deleteDialog.title', { count: 2 }) });
    expect(within(dialog).getByText(en('entries.deleteDialog.body'))).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: en('entries.deleteDialog.confirm') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/delete`, { ids: [ENTRY_ID, OTHER_ENTRY_ID] }));
    await waitFor(() => expect(entryCalls().length).toBeGreaterThan(1));
  });

  it('offers no selection or delete without forms:entries_write', async () => {
    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: READ });
    await screen.findByText('grace@example.com');
    expect(screen.queryByRole('checkbox', { name: en('entries.selectAll') })).toBeNull();
  });

  it('offers the export only with forms:entries_export, and only once a form is chosen (FR-052)', async () => {
    const { unmount } = renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: READ });
    await screen.findByText('grace@example.com');
    expect(screen.queryByText(en('entries.export'))).toBeNull();
    unmount();

    renderForms(<EntriesListPage />, { path: '/forms/entries', pattern: '/forms/entries', permissions: EXPORT });
    await screen.findByText('grace@example.com');
    expect(screen.getByRole('button', { name: en('entries.export') })).toBeDisabled();
    expect(screen.getByText(en('entries.exportHint'))).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText(en('entries.filter.form')), FORM_ID);
    const link = await screen.findByRole('link', { name: en('entries.export') });
    expect(link.getAttribute('href')).toContain(`${API}/export?formId=${FORM_ID}`);
  });
});
