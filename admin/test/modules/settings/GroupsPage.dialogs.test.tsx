import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { answerConfirm } from '../../helpers/confirm-dialog';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * Issue #313 — the setting-groups screen renames a group in a one-field dialog
 * instead of `prompt()`, and confirms a delete in the kit's `ConfirmDialog`
 * instead of `confirm()`.
 */

installOffsetParentShim();

const listSpy = vi.fn();
const updateSpy = vi.fn();
const deleteSpy = vi.fn();
const createSpy = vi.fn();

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    listGroupsOnly: () => listSpy(),
    updateGroup: (...args: unknown[]) => updateSpy(...args),
    deleteGroup: (...args: unknown[]) => deleteSpy(...args),
    createGroup: (...args: unknown[]) => createSpy(...args),
  },
}));

const { GroupsPage } = await import('../../../../packages/modules/settings/src/admin/pages/GroupsPage');

const BUNDLE = {
  ...passthroughBundle('settings', [
    'groups.action.rename',
    'groups.action.delete',
    'groups.deleteConfirm',
    'groups.renameDialog.title',
    'groups.renameDialog.name',
    'groups.renameDialog.nameMissing',
    'groups.renameDialog.failed',
    'groups.newGroup.title',
    'groups.newGroup.action',
    'groups.newGroup.codeLabel',
    'groups.newGroup.nameLabel',
    'groups.newGroup.create',
    'groups.newGroup.codeMissing',
    'groups.newGroup.nameMissing',
    'groups.rowActions',
    'groups.action.protected',
    'groups.list.empty',
  ]),
  ...passthroughBundle('core', ['common.action.cancel', 'common.action.save', 'common.confirm.title']),
};

beforeEach(() => {
  listSpy.mockReset();
  updateSpy.mockReset();
  deleteSpy.mockReset();
  createSpy.mockReset();
  listSpy.mockResolvedValue({
    groups: [{ code: 'seo', name: 'SEO', ownerModule: 'seo', settingCount: 2, isSystemProtected: false }],
  });
});

async function renderPage(): Promise<void> {
  renderWithI18n(<GroupsPage />, BUNDLE);
  await screen.findByText('SEO');
}

/** Opens the row's overflow menu and picks an item (issue #1501, SHELL-14). */
async function rowAction(item: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'groups.rowActions' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('GroupsPage — dialogs instead of native prompts (#313)', () => {
  it('renames in a dialog prefilled with the current name, refusing a blank one', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    updateSpy.mockResolvedValue({});
    await renderPage();
    await rowAction('groups.action.rename');
    const dialog = await screen.findByRole('dialog', { name: 'groups.renameDialog.title' });
    const field = within(dialog).getByRole('textbox', { name: 'groups.renameDialog.name' });
    expect(field).toHaveValue('SEO');

    await userEvent.clear(field);
    await userEvent.type(field, '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.save' }));
    expect(within(dialog).getByText('groups.renameDialog.nameMissing')).toBeInTheDocument();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(updateSpy).not.toHaveBeenCalled();

    await userEvent.clear(field);
    await userEvent.type(field, '  Search engines ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.save' }));
    await waitFor(() => expect(updateSpy).toHaveBeenCalledWith('seo', { name: 'Search engines' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(prompt).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server refusal', async () => {
    updateSpy.mockRejectedValue(new ApiError(409, { error: { code: 'VALIDATION_FAILED', message: 'Name taken.' } }));
    await renderPage();
    await rowAction('groups.action.rename');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.save' }));
    expect(await within(dialog).findByText('Name taken.')).toBeInTheDocument();
  });

  it('deletes only after the confirmation, which names the group', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await rowAction('groups.action.delete');
    const declined = await answerConfirm(false);
    expect(declined).toHaveTextContent('groups.deleteConfirm');
    expect(deleteSpy).not.toHaveBeenCalled();

    await rowAction('groups.action.delete');
    await answerConfirm(true);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('seo'));
  });
});

describe('GroupsPage — the list comes first (issue #1501, SHELL-14)', () => {
  it('draws no create form above the list, and no row button but the actions menu', async () => {
    await renderPage();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'groups.action.delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'groups.action.rename' })).toBeNull();
    expect(screen.getByRole('button', { name: 'groups.newGroup.action' })).toBeInTheDocument();
  });

  it('creates a group in a dialog with labelled fields, refusing blanks inline', async () => {
    createSpy.mockResolvedValue({});
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'groups.newGroup.action' }));
    const dialog = await screen.findByRole('dialog', { name: 'groups.newGroup.title' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'groups.newGroup.create' }));
    expect(within(dialog).getByText('groups.newGroup.codeMissing')).toBeInTheDocument();
    expect(createSpy).not.toHaveBeenCalled();

    await userEvent.type(within(dialog).getByRole('textbox', { name: 'groups.newGroup.codeLabel' }), ' marketing ');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'groups.newGroup.nameLabel' }), 'Marketing');
    await userEvent.click(within(dialog).getByRole('button', { name: 'groups.newGroup.create' }));
    await waitFor(() => expect(createSpy).toHaveBeenCalledWith({ code: 'marketing', name: 'Marketing' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('keeps the create dialog open with the server refusal and the typed values', async () => {
    createSpy.mockRejectedValue(new ApiError(409, { error: { code: 'VALIDATION_FAILED', message: 'Code taken.' } }));
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'groups.newGroup.action' }));
    const dialog = await screen.findByRole('dialog', { name: 'groups.newGroup.title' });
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'groups.newGroup.codeLabel' }), 'seo');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'groups.newGroup.nameLabel' }), 'SEO 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'groups.newGroup.create' }));
    expect(await within(dialog).findByText('Code taken.')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'groups.newGroup.codeLabel' })).toHaveValue('seo');
  });

  it('disables the actions of a system-protected group and says why', async () => {
    listSpy.mockResolvedValue({
      groups: [{ code: 'general', name: 'General', ownerModule: 'settings', settingCount: 9, isSystemProtected: true }],
    });
    renderWithI18n(<GroupsPage />, BUNDLE);
    await screen.findByText('General');
    const trigger = screen.getByRole('button', { name: 'groups.rowActions' });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('title', 'groups.action.protected');
  });

  it('offers the create action from the empty state', async () => {
    listSpy.mockResolvedValue({ groups: [] });
    renderWithI18n(<GroupsPage />, BUNDLE);
    expect(await screen.findByText('groups.list.empty')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'groups.newGroup.action' })).toHaveLength(2);
  });
});
