import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiClient, onUnauthorized } from './api-client.js';

/**
 * Admin auth context. The session lives in the `b2b_admin_session` httpOnly
 * cookie issued by `POST /api/v1/auth/admin/login` — a cookie distinct from the
 * storefront's `b2b_session` so an admin and a customer can be signed in at the
 * same time in one browser; this client polls
 * `GET /api/v1/admin/me` on mount to learn whether a session exists and to
 * fetch the current admin's role + permissions for permission-aware UI gates.
 *
 * ## Published by the kit since feature 091's P3
 *
 * `useAuth` is what a screen calls to gate a control the signed-in operator may
 * not use, so a module package that could not name it rendered every control
 * live to a read-only operator, who filled the form in and got a 403 on save.
 * It stayed in `admin/src` through Phase 1b for a reason that was a measurement
 * rather than a design question — 23 admin test files replaced this module at
 * its `@/lib/auth` path, and `vi.mock` keys on a module id, so moving it here
 * put the `useSurfaceVisibility` → `useAuth` seam inside the package where
 * those mocks cannot reach it. P3 is the merge request that pays that.
 *
 * ## `apiClient` comes from `./api-client.js`, not from the `./lib` barrel
 *
 * The three components P2 published take it from `../../lib/index.js`, because
 * a test outside the package substitutes their collaborator and `vi.mock` can
 * only name a subpath the `exports` map declares. That reasoning does not reach
 * this file, twice over. The collaborator a session test needs to substitute is
 * the **payload**, not the transport, and `initial` below is the prop for it —
 * the shape `ModulePresenceProvider` has published since feature 073. And this
 * file is itself a member of that barrel, so naming it would be a cycle — and P3
 * measured how that cycle resolves: a member importing `./index.js` under a
 * `vi.mock` factory that calls `importActual` gets the **real** module back, so
 * the stub is bypassed silently and the request goes out to whatever is
 * listening on the API origin. A seam that fails that way is worse than none.
 */

export interface AdminMe {
  adminUser: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    adminRoleId: string | null;
    twoFactorEnabled: boolean;
    status: 'active' | 'inactive';
    /** Feature 019 — Admin UI preferred language; null = no preference saved (default to English). */
    preferredLanguage: 'en' | 'pl' | null;
  };
  role: {
    id: string;
    code: string;
    name: string;
    permissions: string[];
  } | null;
  permissions: string[];
}

interface AuthState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  me: AdminMe | null;
  /** Last error from a login attempt, surfaced by LoginPage. */
  lastLoginError: string | null;
  /** Feature 042 — set when login returned `mfaRequired`; LoginPage then
   *  renders the second-step code screen. */
  mfaChallengeId: string | null;
}

interface AuthContextValue extends AuthState {
  login(email: string, password: string): Promise<void>;
  /** Feature 042 — complete the second step with a TOTP/recovery code. */
  verifyMfa(code: string): Promise<void>;
  /** Feature 042 — abandon the second step and return to the password form. */
  cancelMfa(): void;
  logout(): Promise<void>;
  hasPermission(code: string): boolean;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  /**
   * A session already in hand, which makes the provider start `authenticated`
   * and skip the boot fetch.
   *
   * The same prop `ModulePresenceProvider` has carried since feature 073, and
   * for the same two callers: a host that has the projection already, and a
   * test that wants the **real** provider — the real `hasPermission`, the real
   * context, the real `useSurfaceVisibility` reading it — over a session it
   * chose. Replacing the module instead is what P3 exists to stop; a permission
   * gate asserted against a stub of the predicate asserts nothing.
   */
  readonly initial?: AdminMe;
  readonly children: ReactNode;
}

export function AuthProvider({ initial, children }: AuthProviderProps): ReactNode {
  const [state, setState] = useState<AuthState>(
    initial === undefined
      ? {
          status: 'loading',
          me: null,
          lastLoginError: null,
          mfaChallengeId: null,
        }
      : {
          status: 'authenticated',
          me: initial,
          lastLoginError: null,
          mfaChallengeId: null,
        },
  );
  // Feature 042 — holds the pending challenge id across renders so `verifyMfa`
  // never reads a stale closure.
  const challengeRef = useRef<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: AdminMe }>('/api/v1/admin/me');
      setState({ status: 'authenticated', me: res.data, lastLoginError: null, mfaChallengeId: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: 'unauthenticated', me: null, lastLoginError: null, mfaChallengeId: null });
        return;
      }
      // Other errors — treat as unauthenticated so the user sees the login
      // page and can retry; the stack trace is left in the console for ops.
      // eslint-disable-next-line no-console
      console.error('Failed to load /admin/me', err);
      setState({ status: 'unauthenticated', me: null, lastLoginError: null, mfaChallengeId: null });
    }
  }, []);

  useEffect(() => {
    // A seeded provider has its session already; refetching would overwrite it
    // with whatever the transport answers, which for a test is nothing at all.
    // `refresh()` stays available, so a caller that seeds can still re-read.
    if (initial !== undefined) return;
    void refresh();
    // `initial` is a boot-time prop; re-running on its identity would refetch
    // on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setState((prev) =>
          prev.status === 'authenticated'
            ? {
                status: 'unauthenticated',
                me: null,
                lastLoginError: 'Your session expired. Please sign in again.',
                mfaChallengeId: null,
              }
            : prev,
        );
      }),
    [],
  );

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      try {
        const res = await apiClient.post<{
          data: { status: 'authenticated' | 'mfaRequired' | 'mfaSetupRequired'; challengeId?: string };
        }>('/api/v1/auth/admin/login', { email, password });
        const data = res.data;
        if (data.status === 'mfaRequired') {
          challengeRef.current = data.challengeId ?? null;
          setState((prev) => ({ ...prev, lastLoginError: null, mfaChallengeId: data.challengeId ?? null }));
          return;
        }
        if (data.status === 'mfaSetupRequired') {
          setState((prev) => ({
            ...prev,
            lastLoginError:
              'Two-factor authentication is required for your account. Please contact a platform administrator to finish setup.',
          }));
          return;
        }
        await refresh();
      } catch (err) {
        const message =
          err instanceof ApiError ? err.envelope.error.message : 'Sign-in failed.';
        setState((prev) => ({ ...prev, lastLoginError: message }));
      }
    },
    [refresh],
  );

  const verifyMfa = useCallback(
    async (code: string): Promise<void> => {
      const challengeId = challengeRef.current;
      if (!challengeId) return;
      try {
        await apiClient.post<{ data: { status: 'authenticated' } }>(
          '/api/v1/auth/admin/mfa/verify',
          { challengeId, code },
        );
        challengeRef.current = null;
        setState((prev) => ({ ...prev, mfaChallengeId: null, lastLoginError: null }));
        await refresh();
      } catch (err) {
        const message =
          err instanceof ApiError ? err.envelope.error.message : 'Verification failed.';
        setState((prev) => ({ ...prev, lastLoginError: message }));
      }
    },
    [refresh],
  );

  const cancelMfa = useCallback((): void => {
    challengeRef.current = null;
    setState((prev) => ({ ...prev, mfaChallengeId: null, lastLoginError: null }));
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post<void>('/api/v1/auth/admin/logout');
    } catch {
      // Ignore logout errors — we still drop local state so the user
      // returns to the login page.
    }
    setState({ status: 'unauthenticated', me: null, lastLoginError: null, mfaChallengeId: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      verifyMfa,
      cancelMfa,
      logout,
      refresh,
      hasPermission: (code: string): boolean => {
        const perms = state.me?.permissions ?? [];
        return perms.includes('*') || perms.includes(code);
      },
    }),
    [state, login, verifyMfa, cancelMfa, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
