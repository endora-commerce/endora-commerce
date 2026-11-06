import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * A federated sign-in that ends at the second factor lands on the Admin UI with
 * the pending challenge in the address fragment (`#mfa-challenge=<id>`); one
 * that is refused lands on `/login?error=<code>` (`federatedSignInErrorCodeSchema`,
 * issue #813). The sign-in screen picks either up on load: the challenge opens
 * the code form exactly as the password step does, the code is worded on the
 * password form from the screen's own copy, and both are taken out of the
 * address bar once read. Anything else in `?error=` — a crafted link, or a
 * sentence an older backend sent — is never printed: it reads as the generic
 * sign-in failure.
 *
 * The real `AuthProvider` is driven over a stubbed transport, as in
 * `LoginPageThrottled.test.tsx`.
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
// The shell names the session through the kit's barrel; this file drives the kit's
// source `AuthProvider`, so the barrel's two auth bindings are that same module.
vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/lib')>()),
  ...(await import('../../../packages/admin-kit/src/lib/auth')),
}));

const { ApiError } = await import('../../../packages/admin-kit/src/lib/api-client');
const { AuthProvider, useAuth } = await import('../../../packages/admin-kit/src/lib/auth');
const { LoginPage } = await import('../../../packages/admin-shell/src/components/LoginPage');

function Screen(): ReactElement | null {
  const { status } = useAuth();
  return status === 'unauthenticated' ? <LoginPage /> : null;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (path: string) => {
    if (path === '/api/v1/admin/me') {
      throw new ApiError(401, { error: { code: 'UNAUTHORIZED', message: 'Admin session required.' } });
    }
    throw new Error(`unexpected GET ${path}`);
  });
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('LoginPage — handover from a federated sign-in', () => {
  it('opens the code form for a pending challenge and verifies against it', async () => {
    window.history.replaceState(null, '', '/#mfa-challenge=challenge-1');
    post.mockResolvedValue({ data: { status: 'authenticated' } });

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    const input = await screen.findByLabelText('Authentication code');
    expect(window.location.hash).toBe('');

    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/v1/auth/admin/mfa/verify', {
        challengeId: 'challenge-1',
        code: '123456',
      }),
    );
  });

  it('words the code a refused federated sign-in came back with', async () => {
    window.history.replaceState(null, '', '/login?error=no_matching_account');

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    expect(
      await screen.findByText('No account matches this provider. Please contact an administrator.'),
    ).toBeTruthy();
    expect(screen.getByText('Sign-in failed')).toBeTruthy();
    expect(screen.queryByText('no_matching_account')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('titles an expired sign-in attempt as expired', async () => {
    window.history.replaceState(null, '', '/login?error=sign_in_expired');

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    expect(await screen.findByText('This sign-in attempt has expired.')).toBeTruthy();
    expect(screen.getByText('Session expired')).toBeTruthy();
  });

  it.each([
    ['a forged sentence', 'Your account is suspended. Call +48 000 000 000 to restore it.'],
    ['a sentence an older backend sent', 'This sign-in attempt has expired.'],
    ['an unknown code', 'not_a_contract_code'],
  ])('never prints %s from ?error=, and reads it as the generic failure', async (_label, forged) => {
    window.history.replaceState(null, '', `/login?error=${encodeURIComponent(forged)}`);

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    expect(await screen.findByText('Sign-in failed')).toBeTruthy();
    expect(screen.queryByText(forged)).toBeNull();
    expect(screen.queryByText('Session expired')).toBeNull();
    expect(screen.getByRole('alert').textContent).not.toContain(forged);
    expect(window.location.search).toBe('');
  });

  it('drops the federated refusal once the administrator signs in with a password', async () => {
    window.history.replaceState(null, '', '/login?error=no_matching_account');
    post.mockRejectedValue(
      new ApiError(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }),
    );

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    await screen.findByText('No account matches this provider. Please contact an administrator.');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(
      screen.queryByText('No account matches this provider. Please contact an administrator.'),
    ).toBeNull();
  });

  it('starts on the password form when the address carries neither', async () => {
    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );
    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
  });
});
