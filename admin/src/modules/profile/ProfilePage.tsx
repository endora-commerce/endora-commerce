import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

/**
 * ProfilePage — feature 010 admin polish.
 *
 * Self-edit form for the logged-in admin user. Hits
 * `PATCH /api/v1/admin/me`, which any authenticated admin can call
 * without holding `admin_users:manage`. Linked from the avatar in the
 * top-right corner of the AppShell.
 */
export function ProfilePage(): ReactNode {
  const { me, refresh } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (me) {
      setFirstName(me.adminUser.firstName);
      setLastName(me.adminUser.lastName);
    }
  }, [me]);

  if (!me) {
    return <div className="b2b-page">Loading…</div>;
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setInfo(null);
    try {
      const body: Record<string, unknown> = {};
      if (firstName !== me.adminUser.firstName) body['firstName'] = firstName;
      if (lastName !== me.adminUser.lastName) body['lastName'] = lastName;
      if (password.trim().length > 0) body['password'] = password;
      if (Object.keys(body).length === 0) {
        setInfo('Nothing to save.');
        setSubmitting(false);
        return;
      }
      await apiClient.patch<unknown>('/api/v1/admin/me', body);
      setPassword('');
      setInfo('Profile updated.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-page">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">My profile</div>
          <div className="b2b-page-head__sub">
            Edit your name and rotate your password. Role and status are managed by an administrator with the <code className="b2b-mono">admin_users:manage</code> permission.
          </div>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}
      {info ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(142 50% 80%)',
          }}
        >
          {info}
        </div>
      ) : null}

      <form onSubmit={(e): void => { void handleSubmit(e); }}>
        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Identity</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-grid b2b-grid--cols-2">
              <div>
                <label className="b2b-label" htmlFor="me-email">Email</label>
                <input
                  id="me-email"
                  className="b2b-field"
                  value={me.adminUser.email}
                  disabled
                />
                <div className="b2b-help">Contact an administrator if you need to change your email.</div>
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-role">Role</label>
                <input
                  id="me-role"
                  className="b2b-field"
                  value={me.role?.name ?? '—'}
                  disabled
                />
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-first">First name</label>
                <input
                  id="me-first"
                  className="b2b-field"
                  value={firstName}
                  onChange={(e): void => setFirstName(e.target.value)}
                  required
                  maxLength={120}
                />
              </div>
              <div>
                <label className="b2b-label" htmlFor="me-last">Last name</label>
                <input
                  id="me-last"
                  className="b2b-field"
                  value={lastName}
                  onChange={(e): void => setLastName(e.target.value)}
                  required
                  maxLength={120}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Change password</h2></div>
          <div className="b2b-card__body">
            <div>
              <label className="b2b-label" htmlFor="me-pwd">New password</label>
              <input
                id="me-pwd"
                className="b2b-field"
                type="password"
                value={password}
                onChange={(e): void => setPassword(e.target.value)}
                minLength={12}
                maxLength={120}
                autoComplete="new-password"
                placeholder="Leave empty to keep current password"
              />
              <div className="b2b-help">Minimum 12 characters. Leave blank to keep your current password.</div>
            </div>
          </div>
        </div>

        <div className="b2b-row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="submit" className="b2b-btn b2b-btn--primary" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
