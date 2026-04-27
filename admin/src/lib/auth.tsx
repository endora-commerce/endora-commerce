import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, apiClient } from './api-client.js';

/**
 * Admin auth context. The session lives in the `b2b_session` httpOnly cookie
 * issued by `POST /api/v1/auth/admin/login`; this client polls
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
}

interface AuthContextValue extends AuthState {
  login(email: string, password: string): Promise<void>;
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
  });

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: AdminMe }>('/api/v1/admin/me');
      setState({ status: 'authenticated', me: res.data, lastLoginError: null });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setState({ status: 'unauthenticated', me: null, lastLoginError: null });
        return;
      }
      // Other errors — treat as unauthenticated so the user sees the login
      // page and can retry; the stack trace is left in the console for ops.
      // eslint-disable-next-line no-console
      console.error('Failed to load /admin/me', err);
      setState({ status: 'unauthenticated', me: null, lastLoginError: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      try {
        await apiClient.post<{ data: unknown }>('/api/v1/auth/admin/login', {
          email,
          password,
        });
        await refresh();
      } catch (err) {
        const message =
          err instanceof ApiError ? err.envelope.error.message : 'Sign-in failed.';
        setState((prev) => ({ ...prev, lastLoginError: message }));
      }
    },
    [refresh],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post<void>('/api/v1/auth/admin/logout');
    } catch {
      // Ignore logout errors — we still drop local state so the user
      // returns to the login page.
    }
    setState({ status: 'unauthenticated', me: null, lastLoginError: null });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      refresh,
      hasPermission: (code: string): boolean => {
        const perms = state.me?.permissions ?? [];
        return perms.includes('*') || perms.includes(code);
      },
    }),
    [state, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
