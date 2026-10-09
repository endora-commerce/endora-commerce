import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { AppLanguageContext } from '../../../../packages/admin-shell/src/i18n/app-language-context';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * Changing the password does not sign the administrator out of the profile
 * screen.
 *
 * `PATCH /api/v1/admin/me` revokes every other session of the account and
 * keeps the one the request was made from. So the screen has nothing to
 * recover from: it re-reads the account over the same session, stays where it
 * is, and tells the administrator what happened to the other sessions.
 */

const patchSpy = vi.fn();
const refreshSpy = vi.fn(async () => {});
const logoutSpy = vi.fn(async () => {});

vi.mock('../../../../packages/admin-shell/src/lib/api-client', async () => {
  const actual = await vi.importActual('../../../../packages/admin-shell/src/lib/api-client');
  return {
    ...(actual as Record<string, unknown>),
    apiClient: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: (path: string, body: unknown) => patchSpy(path, body),
      delete: vi.fn(),
    },
  };
});

const ME = {
  adminUser: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  role: { name: 'Operator' },
};

vi.mock('../../../../packages/admin-shell/src/lib/auth', () => ({
  useAuth: () => ({ me: ME, refresh: refreshSpy, logout: logoutSpy }),
}));

const { ProfilePage } = await import(
  '../../../../packages/admin-shell/src/modules/profile/ProfilePage'
);

const PASSWORD_CHANGED = (enBundle as Record<string, string>)['profile.info.passwordChanged']!;
const PROFILE_UPDATED = (enBundle as Record<string, string>)['profile.info.updated']!;

function renderProfile(): void {
  renderWithI18n(
    <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
      <ProfilePage />
    </AppLanguageContext.Provider>,
    { core: enBundle as Record<string, string> },
  );
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('ProfilePage — a password change keeps this session', () => {
  beforeEach(() => {
    patchSpy.mockReset();
    patchSpy.mockResolvedValue({ data: {} });
    refreshSpy.mockClear();
    logoutSpy.mockClear();
  });

  it('stays on the screen, re-reads the account and says the other sessions were signed out', async () => {
    expect(PASSWORD_CHANGED).toMatch(/other session/);
    renderProfile();
    type('Current password', 'the-current-pass-123!');
    type('New password', 'a-new-strong-pass-456!');
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByText(PASSWORD_CHANGED)).toBeTruthy());
    // One request, and the account re-read over the same session.
    expect(patchSpy).toHaveBeenCalledTimes(1);
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    // No sign-out, and the form is still there to be used again.
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect((screen.getByLabelText('First name') as HTMLInputElement).value).toBe('Ada');
  });

  it('does not claim sessions were signed out when only the name changed', async () => {
    renderProfile();
    type('First name', 'Augusta');
    fireEvent.submit(document.querySelector('form')!);

    await waitFor(() => expect(screen.getByText(PROFILE_UPDATED)).toBeTruthy());
    expect(screen.queryByText(PASSWORD_CHANGED)).toBeNull();
  });
});
