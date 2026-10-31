import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * A federated sign-in that ends at the second factor lands on the Admin UI with
 * the pending challenge in the address fragment (`#mfa-challenge=<id>`); one
 * that is refused lands on `/login?error=<sentence>`. The sign-in screen picks
 * either up on load: the challenge opens the code form exactly as the password
 * step does, the sentence is shown on the password form, and both are taken out
 * of the address bar once read.
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

  it('shows the sentence a refused federated sign-in came back with', async () => {
    const sentence =
      'Two-step verification is required for your account. Please contact a platform administrator to finish setup.';
    window.history.replaceState(null, '', `/login?error=${encodeURIComponent(sentence)}`);

    render(
      <AuthProvider>
        <Screen />
      </AuthProvider>,
    );

    expect(await screen.findByText(sentence)).toBeTruthy();
    expect(window.location.search).toBe('');
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
