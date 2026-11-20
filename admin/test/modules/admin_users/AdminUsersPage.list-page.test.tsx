import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { installOffsetParentShim } from '../../helpers/layout-shim';

/**
 * The Users list (issue #1501, UX audit SHELL-14): the list comes first and
 * *New user* in the header opens the create form in a dialog; the role is a
 * value with a *Change…* dialog instead of an unlabelled select that saved on
 * `change` (DS-18); *Reset password*, *Deactivate* and *Remove* sit in the
 * row's overflow menu, *Remove* last and confirmed — no filled red button in
 * every row.
 */

installOffsetParentShim();

const getSpy = vi.fn();
const postSpy = vi.fn();
const patchSpy = vi.fn();
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
      patch: (...args: unknown[]) => patchSpy(...args),
      delete: (...args: unknown[]) => deleteSpy(...args),
    },
  };
});

const { default: AdminUsersPage } = await import(
  '../../../../packages/modules/admin_users/src/admin/pages/AdminUsersPage'
);
const { ApiError } = await import('@endora-commerce/admin-kit/lib');

const USER = {
  id: 'u-1',
  email: 'anna@example.test',
  firstName: 'Anna',
  lastName: 'Nowak',
  adminRoleId: 'r-admin',
  twoFactorEnabled: false,
  status: 'active',
  lastLoginAt: null,
};
const ROLES = [
  { id: 'r-admin', code: 'administrator', name: 'Administrator' },
  { id: 'r-support', code: 'custom_support', name: 'Support' },
];

const BUNDLE = passthroughBundle('core', [
  'adminUsers.page.title',
  'adminUsers.create.title',
  'adminUsers.create.action',
  'adminUsers.create.submit',
  'adminUsers.column.email',
  'adminUsers.column.role',
  'adminUsers.field.password',
  'adminUsers.field.firstName',
  'adminUsers.field.lastName',
  'adminUsers.chooseRole',
  'adminUsers.rowActions',
  'adminUsers.remove',
  'adminUsers.deactivate',
  'adminUsers.confirmRemove',
  'adminUsers.role.changeTitle',
  'adminUsers.resetPassword.action',
  'adminUsers.resetPassword.submit',
  'adminUsers.resetPassword.title',
  'adminUsers.resetPassword.done',
  'common.action.cancel',
  'common.statusChange.change',
  'common.statusChange.continue',
  'common.statusChange.confirm',
]);

function mount(): void {
  renderWithI18n(
    <MemoryRouter>
      <AdminUsersPage />
    </MemoryRouter>,
    BUNDLE,
  );
}

async function rowAction(item: string): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'adminUsers.rowActions' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: item }));
}

beforeEach(() => {
  getSpy.mockReset();
  postSpy.mockReset();
  patchSpy.mockReset();
  deleteSpy.mockReset();
  getSpy.mockImplementation((path: string) => {
    if (path.startsWith('/api/v1/admin/admin-users')) return Promise.resolve({ data: [USER] });
    if (path.startsWith('/api/v1/admin/admin-roles')) return Promise.resolve({ data: ROLES });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  postSpy.mockResolvedValue({ data: USER });
  patchSpy.mockResolvedValue({ data: USER });
  deleteSpy.mockResolvedValue(undefined);
});

describe('AdminUsersPage — the list comes first (SHELL-14)', () => {
  it('draws no create form, no role select and no row buttons but the actions menu', async () => {
    mount();
    await screen.findByText('anna@example.test');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'adminUsers.remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'adminUsers.create.action' })).toBeInTheDocument();
  });

  it('creates a user in a dialog from the header button', async () => {
    mount();
    await screen.findByText('anna@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'adminUsers.create.action' }));
    const dialog = await screen.findByRole('dialog', { name: 'adminUsers.create.title' });
    await userEvent.type(within(dialog).getByLabelText('adminUsers.column.email'), 'jan@example.test');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.password'), 'a-long-password-1');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.firstName'), 'Jan');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.lastName'), 'Kowalski');
    await userEvent.selectOptions(within(dialog).getByLabelText('adminUsers.column.role'), 'r-support');
    await userEvent.click(within(dialog).getByRole('button', { name: 'adminUsers.create.submit' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users', {
        email: 'jan@example.test',
        password: 'a-long-password-1',
        firstName: 'Jan',
        lastName: 'Kowalski',
        adminRoleId: 'r-support',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps the create dialog open with the server refusal', async () => {
    postSpy.mockRejectedValue(new ApiError(409, { error: { code: 'VALIDATION_FAILED', message: 'Email already used.' } }));
    mount();
    await screen.findByText('anna@example.test');
    await userEvent.click(screen.getByRole('button', { name: 'adminUsers.create.action' }));
    const dialog = await screen.findByRole('dialog', { name: 'adminUsers.create.title' });
    await userEvent.type(within(dialog).getByLabelText('adminUsers.column.email'), 'anna@example.test');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.password'), 'a-long-password-1');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.firstName'), 'Anna');
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.lastName'), 'Nowak');
    await userEvent.selectOptions(within(dialog).getByLabelText('adminUsers.column.role'), 'r-admin');
    await userEvent.click(within(dialog).getByRole('button', { name: 'adminUsers.create.submit' }));
    expect(await within(dialog).findByText('Email already used.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('adminUsers.column.email')).toHaveValue('anna@example.test');
  });

  it('changes the role only through the labelled Change… dialog, never on a pick', async () => {
    mount();
    await screen.findByText('anna@example.test');
    const change = screen.getByRole('button', { name: 'common.statusChange.change adminUsers.column.role' });
    await userEvent.click(change);
    const dialog = await screen.findByRole('dialog', { name: 'adminUsers.role.changeTitle' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Support' }));
    expect(patchSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'common.statusChange.continue' }));
    await userEvent.click(await screen.findByRole('button', { name: 'common.statusChange.confirm' }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users/u-1', { adminRoleId: 'r-support' }),
    );
  });

  it('removes a user from the row menu only after the confirmation', async () => {
    mount();
    await screen.findByText('anna@example.test');
    await rowAction('adminUsers.remove');
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('adminUsers.confirmRemove');
    expect(deleteSpy).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'adminUsers.remove' }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users/u-1'));
  });

  it('resets a password in a dialog opened from the row menu', async () => {
    mount();
    await screen.findByText('anna@example.test');
    await rowAction('adminUsers.resetPassword.action');
    const dialog = await screen.findByRole('dialog', { name: 'adminUsers.resetPassword.title' });
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.password'), 'another-long-pass');
    await userEvent.click(within(dialog).getByRole('button', { name: 'adminUsers.resetPassword.submit' }));
    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users/u-1/password', { password: 'another-long-pass' }),
    );
    expect(await screen.findByText('adminUsers.resetPassword.done')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Issue #1499 (UX audit SALES-17, DEC-12 a): the reset is said beside the
  // header's "New user", in a region mounted before it has text, not as a
  // success banner above the rows.
  it('says a reset password beside "New user", with no success banner', async () => {
    mount();
    await screen.findByText('anna@example.test');
    const newUser = screen.getByRole('button', { name: 'adminUsers.create.action' });
    const region = Array.from(newUser.parentElement!.children).find((el) => el.getAttribute('role') === 'status');
    expect(region?.textContent).toBe('');
    await rowAction('adminUsers.resetPassword.action');
    const dialog = await screen.findByRole('dialog', { name: 'adminUsers.resetPassword.title' });
    await userEvent.type(within(dialog).getByLabelText('adminUsers.field.password'), 'another-long-pass');
    await userEvent.click(within(dialog).getByRole('button', { name: 'adminUsers.resetPassword.submit' }));
    await waitFor(() => expect(region).toHaveTextContent('adminUsers.resetPassword.done'));
    expect(document.querySelector('[data-slot="alert"][data-variant="success"]')).toBeNull();
  });

  it('toggles the status from the row menu', async () => {
    mount();
    await screen.findByText('anna@example.test');
    await rowAction('adminUsers.deactivate');
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/api/v1/admin/admin-users/u-1', { status: 'inactive' }),
    );
  });
});
