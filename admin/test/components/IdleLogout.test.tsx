import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

/**
 * IdleLogout signs the admin out after the configured inactivity window
 * (`admin.idle_logout_minutes`, default 60), re-arming on user activity.
 */

const logoutSpy = vi.fn();
vi.mock('@/lib/auth', () => ({
  useAuth: (): { status: string; logout: () => void } => ({
    status: 'authenticated',
    logout: logoutSpy,
  }),
}));

// The component builds the setting read itself since feature 091's P6 — it no
// longer imports `settings`' admin API client, so the seam a test can isolate
// is `apiClient`, and the URL it is called with is the behavioural twin of the
// source-level assertions in `test/modules/p6-client-exits.test.ts`.
const getSpy = vi.fn();
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: (...args: unknown[]) => getSpy(...args) },
  };
});

const { IdleLogout } = await import('../../src/components/IdleLogout');

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
    getSpy.mockReset();
    // Configured to 2 minutes to prove the setting value is honoured.
    getSpy.mockResolvedValue({ globalValue: 2, defaultValue: 60 });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('logs out after the configured idle minutes', async () => {
    await act(async () => {
      render(<IdleLogout />);
    });
    await flushMicrotasks();

    expect(getSpy).toHaveBeenCalledWith('/api/v1/admin/settings/admin.idle_logout_minutes');

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
});
