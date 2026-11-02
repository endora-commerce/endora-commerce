import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { setMobileViewport } from '../../setup';
import { ENTRY_ID, en, entryDetail, renderForms } from './forms-fixtures';

/**
 * One entry (`specs/170-forms-module/` User Story 4, T074; US4-2, US4-3, FR-048, FR-049,
 * research R-16): opening it marks it read; its answers in the labels of the version it was sent
 * to, its consents with the texts shown, the page, language, channel, time and who sent it; a status
 * control whose change can be undone — refused with a sentence when the entry moved meanwhile;
 * notes with their author and time; a delete behind a dialog. Without `forms:entries_write` the
 * entry is read-only.
 */

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
const deleteSpy = vi.fn();

vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>('@endora-commerce/admin-kit/lib');
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

const { EntryDetailPage } = await import('../../../../packages/modules/forms/src/admin/pages/EntryDetailPage');

const API = `/api/v1/admin/forms/entries/${ENTRY_ID}`;
const READ = ['forms:read', 'forms:entries_read'];
const WRITE = [...READ, 'forms:entries_write'];

function renderEntry(permissions: string[] = WRITE) {
  return renderForms(<EntryDetailPage />, { path: `/forms/entries/${ENTRY_ID}`, pattern: '/forms/entries/:id', permissions });
}

beforeEach(() => {
  setMobileViewport(false);
  for (const spy of [getSpy, postSpy, patchSpy, deleteSpy]) spy.mockReset();
  postSpy.mockImplementation((path: string, body: unknown) => {
    if (path === `${API}/mark-read`) return Promise.resolve({ data: entryDetail({ status: 'read' }) });
    if (path === `${API}/notes`) {
      return Promise.resolve({
        data: { id: '00000000-0000-4000-8000-0000000a0001', body: (body as { body: string }).body, authorAdminUserId: null, createdAt: '2026-11-02T10:00:00.000Z' },
      });
    }
    return Promise.reject(new Error(`unexpected POST ${path}`));
  });
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/sales-channels')) {
      return Promise.resolve({ items: [{ id: entryDetail().salesChannelId, code: 'default', name: { 'en-US': 'Default store' }, active: true }] });
    }
    if (path === API) return Promise.resolve({ data: entryDetail({ status: 'read' }) });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('EntryDetailPage', () => {
  it('marks the entry read on open and tells it in its version’s labels (US4-2)', async () => {
    renderEntry(READ);
    const answers = await screen.findByRole('region', { name: en('entry.answers') });
    expect(postSpy).toHaveBeenCalledWith(`${API}/mark-read`, {});
    expect(within(answers).getByText('Name')).toBeTruthy();
    expect(within(answers).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(answers).getByText('Main 1, 30-001 Kraków')).toBeTruthy();
    expect(within(answers).getByText('doors, windows')).toBeTruthy();
    const consents = screen.getByRole('region', { name: en('entry.consents') });
    expect(within(consents).getByText('I accept the privacy policy')).toBeTruthy();
    expect(within(consents).getByText(en('entry.consentGiven'))).toBeTruthy();
    const context = screen.getByRole('region', { name: en('entry.context') });
    expect(within(context).getByText('/contact?ref=mail')).toBeTruthy();
    expect(within(context).getByText(en('entry.anonymous'))).toBeTruthy();
    expect(await within(context).findByText('Default store')).toBeTruthy();
  });

  it('changes the status, and undoes the change by re-issuing it (R-16)', async () => {
    patchSpy
      .mockResolvedValueOnce({ data: entryDetail({ status: 'closed' }) })
      .mockResolvedValueOnce({ data: entryDetail({ status: 'read' }) });
    renderEntry();
    await userEvent.selectOptions(await screen.findByLabelText(en('entry.status')), 'closed');
    await waitFor(() => expect(patchSpy).toHaveBeenCalledWith(`${API}/status`, { status: 'closed', expectedStatus: 'read' }));
    expect(await screen.findByText(en('entry.statusChanged', { status: en('entryStatus.closed') }))).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: en('entry.undo') }));
    await waitFor(() => expect(patchSpy).toHaveBeenLastCalledWith(`${API}/status`, { status: 'read', expectedStatus: 'closed' }));
    expect(await screen.findByText(en('entry.undone'))).toBeTruthy();
  });

  it('says so when the undo finds the entry moved meanwhile', async () => {
    patchSpy.mockResolvedValueOnce({ data: entryDetail({ status: 'spam' }) }).mockRejectedValueOnce(
      new ApiError(409, {
        error: {
          code: 'FORM_ENTRY_STATUS_CONFLICT',
          message: en('errors.FORM_ENTRY_STATUS_CONFLICT'),
          details: { status: 'closed' },
          requestId: 'req_1',
        },
      }),
    );
    renderEntry();
    await userEvent.selectOptions(await screen.findByLabelText(en('entry.status')), 'spam');
    await userEvent.click(await screen.findByRole('button', { name: en('entry.undo') }));
    expect(await screen.findByText(en('errors.FORM_ENTRY_STATUS_CONFLICT'))).toBeTruthy();
  });

  it('adds a note and shows it with its time (FR-049)', async () => {
    renderEntry();
    const notes = await screen.findByRole('region', { name: en('entry.notes') });
    expect(within(notes).getByText(en('entry.noNotes'))).toBeTruthy();
    await userEvent.type(within(notes).getByLabelText(en('entry.noteLabel')), 'Called back.');
    await userEvent.click(within(notes).getByRole('button', { name: en('entry.addNote') }));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith(`${API}/notes`, { body: 'Called back.' }));
    expect(await within(notes).findByText('Called back.')).toBeTruthy();
  });

  it('is read-only without forms:entries_write', async () => {
    renderEntry(READ);
    await screen.findByRole('region', { name: en('entry.answers') });
    expect(screen.queryByLabelText(en('entry.status'))).toBeNull();
    expect(screen.queryByLabelText(en('entry.noteLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('entry.delete') })).toBeNull();
    expect(screen.getByText(en('entryStatus.read'))).toBeTruthy();
  });

  it('deletes behind a dialog and goes back to the list (US4-7)', async () => {
    deleteSpy.mockResolvedValue(undefined);
    renderEntry();
    await userEvent.click(await screen.findByRole('button', { name: en('entry.delete') }));
    const dialog = await screen.findByRole('dialog', { name: en('entry.deleteDialog.title') });
    expect(within(dialog).getByText(en('entry.deleteDialog.body'))).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: en('entry.deleteDialog.confirm') }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(API));
    expect(await screen.findByText('entries list screen')).toBeTruthy();
  });

  it('says the entry is not there when it is missing or out of scope', async () => {
    postSpy.mockRejectedValue(
      new ApiError(404, { error: { code: 'FORM_ENTRY_NOT_FOUND', message: en('errors.FORM_ENTRY_NOT_FOUND'), requestId: 'req_2' } }),
    );
    renderEntry();
    expect(await screen.findByText(en('entry.notFound'))).toBeTruthy();
  });
});
