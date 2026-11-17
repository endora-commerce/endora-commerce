import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Issue #1481 (UX audit 2026-11-17, SHELL-05) — the sign-in screen's own words.
 *
 * A failure that carries no backend sentence (the network dropped, the answer
 * was not an error envelope) used to be worded by the kit's `AuthProvider` in
 * English it hard-coded. The provider now reports a reason and the screen
 * words it from its pre-auth copy, where every other sign-in sentence lives.
 * The MFA step's own labels moved there too, and its code field is described
 * by the error it caused.
 */
const get = vi.fn();
const post = vi.fn();

vi.mock('../../../packages/admin-kit/src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../packages/admin-kit/src/lib/api-client')>()),
  apiClient: {
    get: (path: string) => get(path),
    post: (path: string, body?: unknown) => post(path, body),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));
vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/lib')>()),
  ...(await import('../../../packages/admin-kit/src/lib/auth')),
}));

const { ApiError } = await import('../../../packages/admin-kit/src/lib/api-client');
const { AuthProvider, useAuth } = await import('../../../packages/admin-kit/src/lib/auth');
const { LoginPage } = await import('../../../packages/admin-shell/src/components/LoginPage');
const { loginCopy } = await import('../../../packages/admin-shell/src/i18n/preauth-login-copy');

function Screen(): ReactElement {
  const { status } = useAuth();
  return status === 'unauthenticated' ? <LoginPage /> : <p>Signed in</p>;
}

async function signInWithPassword(): Promise<void> {
  render(
    <AuthProvider>
      <Screen />
    </AuthProvider>,
  );
  const email = await screen.findByLabelText(loginCopy.email);
  fireEvent.change(email, { target: { value: 'a@example.com' } });
  fireEvent.change(screen.getByLabelText(loginCopy.password), { target: { value: 'secret' } });
  fireEvent.submit(email.closest('form')!);
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockRejectedValue(new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'No session.' } }));
});

describe('LoginPage — failures the backend did not word', () => {
  it('words a failed password step from the pre-auth copy', async () => {
    post.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await signInWithPassword();
    expect(loginCopy.signInFailedLine).toBeTypeOf('string');
    expect(await screen.findByText(loginCopy.signInFailedLine)).toBeTruthy();
    expect(screen.getByText(loginCopy.failed)).toBeTruthy();
  });

  it('words a failed code step from the pre-auth copy and ties it to the field', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/admin/login') return { data: { status: 'mfaRequired', challengeId: 'chal-1' } };
      throw new TypeError('Failed to fetch');
    });
    await signInWithPassword();

    expect(await screen.findByText(loginCopy.mfaTitle)).toBeTruthy();
    expect(screen.getByText(loginCopy.mfaDescription)).toBeTruthy();
    const code = screen.getByLabelText(loginCopy.mfaCodeLabel) as HTMLInputElement;
    expect(code.getAttribute('autocomplete')).toBe('one-time-code');
    expect(code.getAttribute('aria-invalid')).toBeNull();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form')!);

    expect(loginCopy.verificationFailedLine).toBeTypeOf('string');
    const line = await screen.findByText(loginCopy.verificationFailedLine);
    const field = screen.getByLabelText(loginCopy.mfaCodeLabel);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect((field.getAttribute('aria-describedby') ?? '').split(' ')).toContain(line.id);
    expect(screen.getByRole('button', { name: loginCopy.mfaSubmit })).toBeTruthy();
    expect(screen.getByRole('button', { name: loginCopy.mfaBack })).toBeTruthy();
  });

  it('still shows the backend sentence when there is one', async () => {
    post.mockRejectedValueOnce(
      new ApiError(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }),
    );
    await signInWithPassword();
    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(screen.queryByText(loginCopy.signInFailedLine)).toBeNull();
  });
});
