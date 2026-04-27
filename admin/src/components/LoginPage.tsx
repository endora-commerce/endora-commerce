import { useState, type FormEvent, type ReactNode } from 'react';
import { useAuth } from '../lib/auth.js';

/**
 * Admin login screen. Rendered by the App component when no session is
 * active; on success the AuthProvider re-fetches `/admin/me` and the
 * AppShell takes over.
 *
 * To bootstrap the first administrator, run from the repository root:
 *   pnpm --filter backend run admin:create -- \
 *     --email=admin@example.com --password=… --first-name=… --last-name=…
 */
export function LoginPage(): ReactNode {
  const { login, lastLoginError, status } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div
        className="card"
        style={{ width: 'min(420px, 100%)', margin: 0 }}
      >
        <h1 style={{ marginTop: 0, fontSize: '1.25rem' }}>B2B Admin · sign in</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Use the email + password issued by your platform administrator.
        </p>
        {lastLoginError ? (
          <div className="alert alert--error" style={{ marginBottom: 12 }}>
            {lastLoginError}
          </div>
        ) : null}
        <form
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            setSubmitting(true);
            void login(email, password).finally(() => setSubmitting(false));
          }}
        >
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e): void => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e): void => setPassword(e.target.value)}
            />
          </div>
          <button
            className="btn btn--primary"
            type="submit"
            disabled={submitting || status === 'loading'}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="muted" style={{ marginTop: 16, fontSize: '0.85rem' }}>
          No account yet? Run{' '}
          <code>pnpm --filter backend run admin:create</code> from the repository
          root to bootstrap the first administrator.
        </p>
      </div>
    </div>
  );
}
