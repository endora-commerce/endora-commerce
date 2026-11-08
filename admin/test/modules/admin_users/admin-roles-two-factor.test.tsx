import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { apiClient } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';
import AdminRolesPage from '../../../../packages/modules/admin_users/src/admin/pages/AdminRolesPage';

/**
 * Issue #349 — the role editor's "requires two-step verification" checkbox now
 * changes sign-in, so the screen has to say what it does and when it cannot:
 *
 *  - with `mfa` absent the box is disabled, keeps showing a value that is
 *    already set, and says the requirement applies again once `mfa` is back
 *    (the backend refuses turning it on in that state anyway);
 *  - with `mfa` present it explains who is bound, and before a save that turns
 *    it on it shows how many holders will be signed out — the count the
 *    backend previews — and reports the number actually signed out after.
 */
vi.mock('@endora-commerce/admin-kit/lib', async () => {
  const actual = await vi.importActual<typeof import('@endora-commerce/admin-kit/lib')>(
    '@endora-commerce/admin-kit/lib',
  );
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

const ROLE = {
  id: '00000000-0000-4000-8000-0000000000aa',
  code: 'accounting',
  name: 'Accounting',
  permissions: ['orders:read'],
  requiresTwoFactor: false,
  updatedAt: '2026-11-07T00:00:00.000Z',
};

const bundle = {
  ...passthroughBundle('core', [
    'adminRoles.field.requires2fa',
    'adminRoles.save',
    'adminRoles.page.title',
    'adminRoles.info.saved',
  ]),
  ...passthroughBundle('admin_users', [
    'roles.twoFactor.help',
    'roles.twoFactor.mfaOff',
    'roles.twoFactor.confirmSignOut',
    'roles.twoFactor.signedOut',
  ]),
};

function mockApi(role: typeof ROLE, unprotected: number | null = 3, signedOut = 3): void {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/api/v1/admin/admin-roles') return { data: [role] } as never;
    if (url === '/api/v1/admin/permissions') return { data: [] } as never;
    if (url.endsWith('/two-factor-impact')) {
      return { data: { unprotectedAdministrators: unprotected } } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  vi.mocked(apiClient.put).mockImplementation(
    async () => ({ data: { ...role, requiresTwoFactor: true, signedOutAdministrators: signedOut } }) as never,
  );
}

async function renderPage(present: string[], role: typeof ROLE = ROLE): Promise<HTMLInputElement> {
  mockApi(role);
  renderWithI18n(
    withSession(
      <MemoryRouter>
        <AdminRolesPage />
      </MemoryRouter>,
      {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present, absent: present.includes('mfa') ? [] : ['mfa'] }),
      },
    ),
    bundle,
  );
  fireEvent.click(await screen.findByText('accounting'));
  return (await screen.findByLabelText(/adminRoles\.field\.requires2fa/)) as HTMLInputElement;
}

describe('AdminRolesPage — the two-factor requirement', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(apiClient.get).mockReset();
    vi.mocked(apiClient.put).mockReset();
  });

  it('disables the checkbox and says why while mfa is absent', async () => {
    const box = await renderPage(['admin_users', 'admin_roles']);
    expect(box.disabled).toBe(true);
    expect(screen.getByText('roles.twoFactor.mfaOff')).toBeTruthy();
    expect(screen.queryByText('roles.twoFactor.help')).toBeNull();
  });

  it('keeps showing a requirement that is already set while mfa is absent', async () => {
    const box = await renderPage(['admin_users', 'admin_roles'], { ...ROLE, requiresTwoFactor: true });
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
  });

  it('explains the requirement and confirms the sign-out count before saving it on', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const box = await renderPage(['admin_users', 'admin_roles', 'mfa']);
    expect(box.disabled).toBe(false);
    expect(screen.getByText('roles.twoFactor.help')).toBeTruthy();

    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'adminRoles.save' }));

    await waitFor(() => expect(apiClient.put).toHaveBeenCalled());
    expect(apiClient.get).toHaveBeenCalledWith('/api/v1/admin/admin-roles/accounting/two-factor-impact');
    expect(confirm).toHaveBeenCalledWith('roles.twoFactor.confirmSignOut');
    expect(await screen.findByText('roles.twoFactor.signedOut')).toBeTruthy();
  });

  it('saves nothing when the operator declines the sign-out', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const box = await renderPage(['admin_users', 'admin_roles', 'mfa']);
    fireEvent.click(box);
    fireEvent.click(screen.getByRole('button', { name: 'adminRoles.save' }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith(
      '/api/v1/admin/admin-roles/accounting/two-factor-impact',
    ));
    expect(apiClient.put).not.toHaveBeenCalled();
  });
});
