import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { AppLanguageContext } from '../../../../packages/admin-shell/src/i18n/app-language-context';
import enBundle from '../../../../packages/modules/_i18n/i18n/en.json';

/**
 * The profile screen asks for the current password before it sends a new one.
 *
 * `PATCH /api/v1/admin/me` refuses a `password` that arrives without
 * `currentPassword`, so the screen that calls it has to collect one — and has
 * to put the refusal on the field it is about. The bundle is the shipped
 * English one rather than a passthrough, so a label this screen asks for and
 * the bundle does not carry fails here instead of rendering a raw key.
 */

const patchSpy = vi.fn();
const refreshSpy = vi.fn(async () => {});

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

// One object for the whole file: the screen re-seeds its name fields whenever
// `me` changes identity, which is what the real provider's stable state gives it.
const ME = {
  adminUser: { email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
  role: { name: 'Operator' },
};

vi.mock('../../../../packages/admin-shell/src/lib/auth', () => ({
  useAuth: () => ({ me: ME, refresh: refreshSpy }),
}));

const { ApiError } = await import('../../../../packages/admin-shell/src/lib/api-client');
const { ProfilePage } = await import(
  '../../../../packages/admin-shell/src/modules/profile/ProfilePage'
);

function renderProfile(): void {
  renderWithI18n(
    <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
      <ProfilePage />
    </AppLanguageContext.Provider>,
    { core: enBundle as Record<string, string> },
  );
}

function type(label: string, value: string): HTMLInputElement {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

function submit(): void {
  fireEvent.submit(document.querySelector('form')!);
}

describe('ProfilePage — changing the password asks for the current one', () => {
  beforeEach(() => {
    patchSpy.mockReset();
    patchSpy.mockResolvedValue({ data: {} });
    refreshSpy.mockClear();
  });

  it('labels both password fields for a password manager', () => {
    renderProfile();
    const current = screen.getByLabelText('Current password') as HTMLInputElement;
    const next = screen.getByLabelText('New password') as HTMLInputElement;
    expect(current.type).toBe('password');
    expect(current.getAttribute('autocomplete')).toBe('current-password');
    expect(next.getAttribute('autocomplete')).toBe('new-password');
  });

  it('sends the current password with the new one', async () => {
    renderProfile();
    type('Current password', 'the-current-pass-123!');
    type('New password', 'a-new-strong-pass-456!');
    submit();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith('/api/v1/admin/me', {
      password: 'a-new-strong-pass-456!',
      currentPassword: 'the-current-pass-123!',
    });
    // Neither secret stays in the form once it has been used.
    await waitFor(() =>
      expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe(''),
    );
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });

  it('saves a name change without asking for or sending any password', async () => {
    renderProfile();
    type('First name', 'Augusta');
    submit();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith('/api/v1/admin/me', { firstName: 'Augusta' });
  });

  it('does not send a current password typed without a new one', async () => {
    renderProfile();
    type('First name', 'Augusta');
    type('Current password', 'the-current-pass-123!');
    submit();
    await waitFor(() => expect(patchSpy).toHaveBeenCalledTimes(1));
    expect(patchSpy).toHaveBeenCalledWith('/api/v1/admin/me', { firstName: 'Augusta' });
  });

  it('refuses to submit a new password without the current one, on the field', async () => {
    renderProfile();
    type('New password', 'a-new-strong-pass-456!');
    submit();
    const current = screen.getByLabelText('Current password');
    await waitFor(() => expect(current.getAttribute('aria-invalid')).toBe('true'));
    expect(patchSpy).not.toHaveBeenCalled();
    const message = document.getElementById(current.getAttribute('aria-describedby')!);
    expect(message?.textContent).toBe('Enter your current password to set a new one.');
    expect(message?.getAttribute('role')).toBe('alert');
  });

  it('shows a wrong current password on its field, with the sentence the API sent', async () => {
    patchSpy.mockRejectedValue(
      new ApiError(403, {
        error: {
          code: 'CURRENT_PASSWORD_INVALID',
          message: 'The current password is incorrect.',
        },
      }),
    );
    renderProfile();
    type('Current password', 'not-the-current-pass');
    type('New password', 'a-new-strong-pass-456!');
    submit();
    const current = screen.getByLabelText('Current password');
    await waitFor(() => expect(current.getAttribute('aria-invalid')).toBe('true'));
    const message = document.getElementById(current.getAttribute('aria-describedby')!);
    expect(message?.textContent).toBe('The current password is incorrect.');
    // The new password is kept so the administrator only retypes the wrong field.
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(
      'a-new-strong-pass-456!',
    );
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('clears the field error once the current password is edited', async () => {
    renderProfile();
    type('New password', 'a-new-strong-pass-456!');
    submit();
    const current = screen.getByLabelText('Current password');
    await waitFor(() => expect(current.getAttribute('aria-invalid')).toBe('true'));
    type('Current password', 'x');
    expect(current.getAttribute('aria-invalid')).toBeNull();
  });
});
