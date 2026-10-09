import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

/**
 * IdleLogout signs the admin out after the configured inactivity window
 * (`admin.idle_logout_minutes`, default 60), re-arming on user activity.
 *
 * The window arrives on the session — `idleLogoutMinutes` on
 * `GET /api/v1/admin/me` — and not through `/api/v1/admin/settings/:code`,
 * which requires `settings:read`: an administrator whose role lacks it was
 * refused there on every sign-in and held to the default whatever the operator
 * had configured.
 */

const logoutSpy = vi.fn();
let sessionIdleLogoutMinutes: number | null | undefined;
vi.mock('../../../packages/admin-shell/src/lib/auth', () => ({
  useAuth: (): {
    status: string;
    me: { idleLogoutMinutes?: number | null };
    logout: () => void;
  } => ({
    status: 'authenticated',
    // `undefined` leaves the key off, which is what an older backend sends.
    me: sessionIdleLogoutMinutes === undefined ? {} : { idleLogoutMinutes: sessionIdleLogoutMinutes },
    logout: logoutSpy,
  }),
}));

// The transport, replaced so that any request the component makes is seen. It
// must make none: the settings endpoint is the read this component gave up.
const requestSpy = vi.fn();
vi.mock('../../../packages/admin-shell/src/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('../../../packages/admin-shell/src/lib/api-client')>('../../../packages/admin-shell/src/lib/api-client');
  const seen = (...args: unknown[]): Promise<never> => {
    requestSpy(...args);
    return Promise.reject(new Error('IdleLogout must not call the API'));
  };
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: seen, post: seen, put: seen, patch: seen, delete: seen },
  };
});

const { IdleLogout } = await import('../../../packages/admin-shell/src/components/IdleLogout');

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('IdleLogout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logoutSpy.mockReset();
    requestSpy.mockReset();
    // Configured to 2 minutes to prove the session's value is honoured.
    sessionIdleLogoutMinutes = 2;
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs out after the idle minutes the session carries, without calling the API', async () => {
    await act(async () => {
      render(<IdleLogout />);
    });
    await flushMicrotasks();

    expect(requestSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2 * 60_000 - 1_000);
    });
    expect(logoutSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });

  it('re-arms the timer on user activity', async () => {
    await act(async () => {
      render(<IdleLogout />);
    });
    await flushMicrotasks();

    // 1.5 min idle, then activity resets the 2-min countdown.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    act(() => {
      window.dispatchEvent(new Event('keydown'));
    });
    // Another 1.5 min — total 3 min elapsed, but only 1.5 since the reset.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(logoutSpy).not.toHaveBeenCalled();

    // Cross the 2-min mark since the reset.
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(logoutSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an older backend that omits the field', undefined],
    ['a backend that could not resolve the setting', null],
    ['a value that is not a positive number', 0],
  ])('falls back to 60 minutes for %s', async (_label, value) => {
    sessionIdleLogoutMinutes = value;
    await act(async () => {
      render(<IdleLogout />);
    });
    await flushMicrotasks();

    act(() => {
      vi.advanceTimersByTime(60 * 60_000 - 1_000);
    });
    expect(logoutSpy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).not.toHaveBeenCalled();
  });
});
