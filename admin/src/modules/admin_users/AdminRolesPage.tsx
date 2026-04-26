import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';

/**
 * Admin Roles editor (T193 / FR-080..FR-083). One page per Role with a
 * permission-matrix checkbox grid grouped by module. Save = PUT
 * `/admin/admin-roles/:code` (upsert). Delete refuses if any user is
 * still assigned (backend returns 409 ADMIN_ROLE_IN_USE — surfaced as a
 * banner here).
 */

interface AdminRole {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  requiresTwoFactor: boolean;
  updatedAt: string;
}

interface PermissionRow {
  code: string;
  module: string;
  label: string;
}

const NEW_ROLE_KEY = '__new__';

export function AdminRolesPage(): ReactNode {
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [r, p] = await Promise.all([
        apiClient.get<{ data: AdminRole[] }>('/api/v1/admin/admin-roles'),
        apiClient.get<{ data: PermissionRow[] }>('/api/v1/admin/permissions'),
      ]);
      setRoles(r.data);
      setPermissions(p.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const editing = useMemo(() => {
    if (editingCode === NEW_ROLE_KEY) {
      return { id: '', code: '', name: '', permissions: [], requiresTwoFactor: false } as Omit<
        AdminRole,
        'updatedAt'
      >;
    }
    if (editingCode == null) return null;
    const found = roles.find((r) => r.code === editingCode);
    return found ?? null;
  }, [editingCode, roles]);

  const handleSave = useCallback(
    async (input: {
      originalCode: string | null;
      code: string;
      name: string;
      permissions: string[];
      requiresTwoFactor: boolean;
    }): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminRole }>(
          `/api/v1/admin/admin-roles/${input.code}`,
          {
            code: input.code,
            name: input.name,
            permissions: input.permissions,
            requiresTwoFactor: input.requiresTwoFactor,
          },
        );
        setInfo(`Saved role ${input.code}.`);
        setEditingCode(input.code);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (role: AdminRole): Promise<void> => {
      if (!confirm(`Delete role "${role.name}"?`)) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/admin-roles/${role.id}`);
        setInfo(`Deleted role ${role.code}.`);
        if (editingCode === role.code) setEditingCode(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Delete failed.');
      }
    },
    [refresh, editingCode],
  );

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Roles</h1>
          <p>
            Permission bundles assigned in <Link to="/admin-users">Users</Link>.
          </p>
        </div>
        <button className="btn btn--primary" type="button" onClick={(): void => setEditingCode(NEW_ROLE_KEY)}>
          New role
        </button>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16 }}>
          <div className="card">
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
              {roles.map((r) => (
                <li key={r.id}>
                  <button
                    className={
                      'btn ' + (editingCode === r.code ? 'btn--primary' : '')
                    }
                    type="button"
                    style={{ width: '100%', justifyContent: 'flex-start', textAlign: 'left' }}
                    onClick={(): void => setEditingCode(r.code)}
                  >
                    {r.name} <span className="muted">{r.code}</span>
                  </button>
                </li>
              ))}
              {roles.length === 0 ? <li className="muted">No roles yet.</li> : null}
            </ul>
          </div>

          {editing ? (
            <RoleEditor
              key={editingCode}
              role={editing}
              permissions={permissions}
              onSave={(input): void =>
                void handleSave({
                  originalCode: editingCode === NEW_ROLE_KEY ? null : editingCode,
                  code: input.code,
                  name: input.name,
                  permissions: input.permissions,
                  requiresTwoFactor: input.requiresTwoFactor,
                })
              }
              onDelete={
                editingCode !== NEW_ROLE_KEY
                  ? (): void => void handleDelete(editing as AdminRole)
                  : null
              }
            />
          ) : (
            <div className="card muted">Pick a role on the left or create a new one.</div>
          )}
        </div>
      )}
    </>
  );
}

interface RoleEditorProps {
  role: Omit<AdminRole, 'updatedAt'>;
  permissions: PermissionRow[];
  onSave: (input: {
    code: string;
    name: string;
    permissions: string[];
    requiresTwoFactor: boolean;
  }) => void;
  onDelete: (() => void) | null;
}

function RoleEditor(props: RoleEditorProps): ReactNode {
  const [code, setCode] = useState(props.role.code);
  const [name, setName] = useState(props.role.name);
  const [permissions, setPermissions] = useState<Set<string>>(
    new Set(props.role.permissions.filter((p) => p !== '*')),
  );
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(props.role.requiresTwoFactor);
  const isWildcard = props.role.permissions.includes('*');

  const grouped = useMemo(() => {
    const byModule = new Map<string, PermissionRow[]>();
    for (const p of props.permissions) {
      const arr = byModule.get(p.module) ?? [];
      arr.push(p);
      byModule.set(p.module, arr);
    }
    return Array.from(byModule.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [props.permissions]);

  return (
    <div className="card">
      {isWildcard ? (
        <div className="alert alert--warning">
          This role uses the wildcard <code>*</code> permission (bootstrap admin). The matrix
          below is informational; saving the role will replace the wildcard with whatever the
          matrix shows.
        </div>
      ) : null}
      <form
        onSubmit={(e: FormEvent): void => {
          e.preventDefault();
          props.onSave({
            code,
            name,
            permissions: Array.from(permissions),
            requiresTwoFactor,
          });
        }}
      >
        <div className="field">
          <label htmlFor="rcode">Code</label>
          <input
            id="rcode"
            className="input"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            disabled={!!props.role.code}
            required
            maxLength={64}
          />
        </div>
        <div className="field">
          <label htmlFor="rname">Display name</label>
          <input
            id="rname"
            className="input"
            value={name}
            onChange={(e): void => setName(e.target.value)}
            required
            maxLength={160}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={requiresTwoFactor}
              onChange={(e): void => setRequiresTwoFactor(e.target.checked)}
            />{' '}
            Requires two-factor authentication on assigned users
          </label>
        </div>

        <h3 style={{ fontSize: '1rem' }}>Permissions</h3>
        {grouped.map(([module, perms]) => (
          <fieldset
            key={module}
            style={{ border: '1px solid var(--color-border)', padding: 12, marginBottom: 12 }}
          >
            <legend style={{ fontWeight: 600 }}>{module}</legend>
            {perms.map((p) => (
              <label key={p.code} style={{ display: 'block', padding: '2px 0' }}>
                <input
                  type="checkbox"
                  checked={permissions.has(p.code)}
                  onChange={(e): void => {
                    setPermissions((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(p.code);
                      else next.delete(p.code);
                      return next;
                    });
                  }}
                />{' '}
                <code>{p.code}</code> — {p.label}
              </label>
            ))}
          </fieldset>
        ))}

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn--primary" type="submit">
            Save
          </button>
          {props.onDelete ? (
            <button className="btn btn--danger" type="button" onClick={props.onDelete}>
              Delete role
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
