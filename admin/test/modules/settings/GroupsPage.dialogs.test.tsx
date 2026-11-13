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

vi.mock('../../../../packages/modules/settings/src/admin/api/settings-client', () => ({
  settingsClient: {
    listGroupsOnly: () => listSpy(),
    updateGroup: (...args: unknown[]) => updateSpy(...args),
    deleteGroup: (...args: unknown[]) => deleteSpy(...args),
    createGroup: vi.fn(),
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
  ]),
  ...passthroughBundle('core', ['common.action.cancel', 'common.action.save', 'common.confirm.title']),
};

beforeEach(() => {
  listSpy.mockReset();
  updateSpy.mockReset();
  deleteSpy.mockReset();
  listSpy.mockResolvedValue({
    groups: [{ code: 'seo', name: 'SEO', ownerModule: 'seo', settingCount: 2, isSystemProtected: false }],
  });
});

async function renderPage(): Promise<void> {
  renderWithI18n(<GroupsPage />, BUNDLE);
  await screen.findByText('SEO');
}

describe('GroupsPage — dialogs instead of native prompts (#313)', () => {
  it('renames in a dialog prefilled with the current name, refusing a blank one', async () => {
    const prompt = vi.spyOn(window, 'prompt');
    updateSpy.mockResolvedValue({});
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'groups.action.rename' }));
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
    await userEvent.click(screen.getByRole('button', { name: 'groups.action.rename' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.action.save' }));
    expect(await within(dialog).findByText('Name taken.')).toBeInTheDocument();
  });

  it('deletes only after the confirmation, which names the group', async () => {
    deleteSpy.mockResolvedValue(undefined);
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'groups.action.delete' }));
    const declined = await answerConfirm(false);
    expect(declined).toHaveTextContent('groups.deleteConfirm');
    expect(deleteSpy).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'groups.action.delete' }));
    await answerConfirm(true);
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('seo'));
  });
});
