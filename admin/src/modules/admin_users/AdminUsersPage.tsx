import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Admin Users page (T193 / FR-080..FR-083). Lists every active admin user,
 * lets the operator create new ones and reassign role / status. Role
 * editing lives on a sibling page (`/admin-roles`) — this view only picks
 * an existing role from the dropdown.
 */

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  adminRoleId: string | null;
  twoFactorEnabled: boolean;
  status: 'active' | 'inactive';
  lastLoginAt: string | null;
}

interface AdminRole {
  id: string;
  code: string;
  name: string;
}

export function AdminUsersPage(): ReactNode {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [u, r] = await Promise.all([
        apiClient.get<{ data: AdminUser[] }>('/api/v1/admin/admin-users'),
        apiClient.get<{ data: AdminRole[] }>('/api/v1/admin/admin-roles'),
      ]);
      setUsers(u.data);
      setRoles(r.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleCreate = useCallback(
    async (input: {
      email: string;
      password: string;
      firstName: string;
      lastName: string;
      adminRoleId: string | null;
    }): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminUser }>('/api/v1/admin/admin-users', {
          email: input.email,
          password: input.password,
          firstName: input.firstName,
          lastName: input.lastName,
          ...(input.adminRoleId ? { adminRoleId: input.adminRoleId } : {}),
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
      }
    },
    [refresh],
  );

  const handleAssignRole = useCallback(
    async (userId: string, roleId: string): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${userId}`, {
          adminRoleId: roleId === '' ? null : roleId,
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Update failed.');
      }
    },
    [refresh],
  );

  const handleToggleStatus = useCallback(
    async (user: AdminUser): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${user.id}`, {
          status: user.status === 'active' ? 'inactive' : 'active',
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Update failed.');
      }
    },
    [refresh],
  );

  const handleRemove = useCallback(
    async (user: AdminUser): Promise<void> => {
      if (!confirm(`Remove ${user.email}? They will no longer be able to sign in.`)) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/admin-users/${user.id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Remove failed.');
      }
    },
    [refresh],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>
            Supplier employees with admin access. Manage permission bundles in{' '}
            <Link to="/admin-roles">Roles</Link>.
          </p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Create user</h2>
        <CreateUserForm roles={roles} onSubmit={handleCreate} />
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Status</th>
              <th>2FA</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>
                  {u.firstName} {u.lastName}
                </td>
                <td>
                  <select
                    className="input"
                    value={u.adminRoleId ?? ''}
                    onChange={(e): void => void handleAssignRole(u.id, e.target.value)}
                  >
                    <option value="">— unassigned —</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>{u.status}</td>
                <td>{u.twoFactorEnabled ? 'on' : '—'}</td>
                <td>{formatDateTime(u.lastLoginAt)}</td>
                <td>
                  <button
                    className="btn"
                    type="button"
                    onClick={(): void => void handleToggleStatus(u)}
                  >
                    {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                  </button>{' '}
                  <button
                    className="btn btn--danger"
                    type="button"
                    onClick={(): void => void handleRemove(u)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function CreateUserForm({
  roles,
  onSubmit,
}: {
  roles: AdminRole[];
  onSubmit: (input: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    adminRoleId: string | null;
  }) => Promise<void>;
}): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [adminRoleId, setAdminRoleId] = useState<string>('');

  return (
    <form
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          email,
          password,
          firstName,
          lastName,
          adminRoleId: adminRoleId || null,
        }).then(() => {
          setEmail('');
          setPassword('');
          setFirstName('');
          setLastName('');
          setAdminRoleId('');
        });
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label htmlFor="ne">Email</label>
          <input
            id="ne"
            className="input"
            type="email"
            value={email}
            onChange={(e): void => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="np">Password (min 12 chars)</label>
          <input
            id="np"
            className="input"
            type="password"
            value={password}
            onChange={(e): void => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="nf">First name</label>
          <input
            id="nf"
            className="input"
            value={firstName}
            onChange={(e): void => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="nl">Last name</label>
          <input
            id="nl"
            className="input"
            value={lastName}
            onChange={(e): void => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="nr">Role</label>
          <select
            id="nr"
            className="input"
            value={adminRoleId}
            onChange={(e): void => setAdminRoleId(e.target.value)}
          >
            <option value="">— assign later —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button className="btn btn--primary" type="submit">
        Create user
      </button>
    </form>
  );
}
