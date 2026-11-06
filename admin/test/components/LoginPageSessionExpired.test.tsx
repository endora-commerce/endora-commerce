import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * Issue #813 follow-up — a session that expires while the administrator works
 * (the API client's 401 trap, `onUnauthorized`) lands on the sign-in screen
 * under a "Session expired" title. The title comes from a structured reason the
 * provider sets, not from the wording of the message: the `/expired/i` test on
 * the text is gone. A later sign-in attempt clears the reason with the message.
 *
 * The real `AuthProvider` is driven over a stubbed transport, as in
 * `LoginPageFederatedHandover.test.tsx`; the 401 trap's listener set is
 * captured so the test can fire it.
 */
const get = vi.fn();
const post = vi.fn();
const unauthorized = new Set<() => void>();

vi.mock('../../../packages/admin-kit/src/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../packages/admin-kit/src/lib/api-client')>()),
  apiClient: {
    get: (path: string) => get(path),
    post: (path: string, body?: unknown) => post(path, body),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  onUnauthorized: (listener: () => void) => {
    unauthorized.add(listener);
    return (): void => {
      unauthorized.delete(listener);
    };
  },
}));
vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/lib')>()),
  ...(await import('../../../packages/admin-kit/src/lib/auth')),
}));

const { ApiError } = await import('../../../packages/admin-kit/src/lib/api-client');
const { AuthProvider, useAuth } = await import('../../../packages/admin-kit/src/lib/auth');
const { LoginPage } = await import('../../../packages/admin-shell/src/components/LoginPage');

function Screen(): ReactElement {
  const { status } = useAuth();
  return status === 'unauthenticated' ? <LoginPage /> : <p>Signed in</p>;
}

const SESSION_EXPIRED = 'Your session expired. Please sign in again.';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  unauthorized.clear();
  window.history.replaceState(null, '', '/');
  get.mockImplementation(async (path: string) => {
    if (path === '/api/v1/admin/me') {
      return {
        data: {
          adminUser: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' },
          role: { code: 'super_admin' },
          permissions: ['*'],
        },
      };
    }
    throw new Error(`unexpected GET ${path}`);
  });
});

async function expireSession(): Promise<void> {
  render(
    <AuthProvider>
      <Screen />
    </AuthProvider>,
  );
  await screen.findByText('Signed in');
  act(() => {
    for (const listener of unauthorized) listener();
  });
}

describe('LoginPage — a session that expired while signed in', () => {
  it('titles the notice "Session expired"', async () => {
    await expireSession();

    expect(await screen.findByText(SESSION_EXPIRED)).toBeTruthy();
    expect(screen.getByText('Session expired')).toBeTruthy();
    expect(screen.queryByText('Sign-in failed')).toBeNull();
  });

  it('titles the next failed password attempt "Sign-in failed"', async () => {
    post.mockRejectedValue(
      new ApiError(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } }),
    );
    await expireSession();
    await screen.findByText(SESSION_EXPIRED);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByLabelText('Email').closest('form')!);

    expect(await screen.findByText('Invalid email or password.')).toBeTruthy();
    expect(screen.getByText('Sign-in failed')).toBeTruthy();
    expect(screen.queryByText('Session expired')).toBeNull();
  });
});
