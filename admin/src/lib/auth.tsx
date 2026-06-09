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

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    me: null,
    lastLoginError: null,
    mfaChallengeId: null,
  });
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
    void refresh();
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
