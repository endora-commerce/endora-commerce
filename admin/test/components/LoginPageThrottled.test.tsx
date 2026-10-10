import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/**
 * The sign-in screen shows the sentence the backend answers with when an
 * administrator account is throttled — `429 ADMIN_AUTHENTICATION_THROTTLED`.
 *
 * The screen has no translation bundle of its own: it renders before a session
 * exists, and the bundles are served to a session. The sentence it shows is
 * `error.message` from the envelope, which the backend has already written in
 * the language the browser asked for. So what has to hold here is that a 429
 * reaches the screen as that sentence, on the password form and on the code
 * form alike, and is not replaced by a generic one.
 *
 * The real `AuthProvider` is driven, over a stubbed transport: the path under
 * test is the provider turning the refusal into `lastLoginError`, which a stub
 * of `useAuth` would assert nothing about.
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
// The screen's `useAuth` and the provider below have to be one module, or the
// screen reads a context nobody provides.
vi.mock(
  '../../../packages/admin-shell/src/lib/auth',
  async () => await import('../../../packages/admin-kit/src/lib/auth'),
);

const { ApiError } = await import('../../../packages/admin-kit/src/lib/api-client');
const { AuthProvider, useAuth } = await import('../../../packages/admin-kit/src/lib/auth');
const { LoginPage } = await import('../../../packages/admin-shell/src/components/LoginPage');

const THROTTLED_SENTENCE =
  'Dla tego konta wpisano zbyt wiele błędnych haseł lub kodów, dlatego kolejne próby są wstrzymane. Odczekaj kilka minut i spróbuj ponownie.';

function throttled(): InstanceType<typeof ApiError> {
  return new ApiError(429, {
    error: {
      code: 'ADMIN_AUTHENTICATION_THROTTLED',
      message: THROTTLED_SENTENCE,
      details: { retryAfterSeconds: 60 },
      requestId: 'req_test',
    },
  });
}

function Screen(): ReactElement | null {
  const { status } = useAuth();
  return status === 'unauthenticated' ? <LoginPage /> : null;
}

async function renderSignedOut(): Promise<void> {
  render(
    <AuthProvider>
      <Screen />
    </AuthProvider>,
  );
  await screen.findByLabelText('Email');
}

function submitPassword(): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'operator@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-password' } });
  fireEvent.submit(screen.getByLabelText('Email').closest('form')!);
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

describe('LoginPage — a throttled account', () => {
  it('shows the backend sentence on the password form and stays on it', async () => {
    post.mockRejectedValue(throttled());
    await renderSignedOut();

    submitPassword();

    expect(await screen.findByText(THROTTLED_SENTENCE)).toBeTruthy();
    expect(screen.getByText('Sign-in failed')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(post).toHaveBeenCalledWith('/api/v1/auth/admin/login', {
      email: 'operator@example.com',
      password: 'a-password',
    });
    // Still the password form, usable again once the delay has passed.
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.queryByText('Two-step verification')).toBeNull();
  });

  it('shows the backend sentence on the code form when the second step is throttled', async () => {
    post.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/admin/login') {
        return { data: { status: 'mfaRequired', challengeId: 'challenge-1' } };
      }
      throw throttled();
    });
    await renderSignedOut();

    submitPassword();
    const code = await screen.findByLabelText('Authentication code');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form')!);

    expect(await screen.findByText(THROTTLED_SENTENCE)).toBeTruthy();
    expect(post).toHaveBeenLastCalledWith('/api/v1/auth/admin/mfa/verify', {
      challengeId: 'challenge-1',
      code: '123456',
    });
    // The challenge is kept: a refused attempt spends none of its budget, so
    // the same form works once the delay has passed.
    expect(screen.getByText('Two-step verification')).toBeTruthy();
  });
});
