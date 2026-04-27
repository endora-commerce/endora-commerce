import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, ShieldAlert } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

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
        await apiClient.put<{ data: AdminRole }>(`/api/v1/admin/admin-roles/${input.code}`, {
          code: input.code,
          name: input.name,
          permissions: input.permissions,
          requiresTwoFactor: input.requiresTwoFactor,
        });
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
      <PageHeader
        title="Roles"
        description={
          <>
            Permission bundles assigned in{' '}
            <Link to="/admin-users" className="underline underline-offset-2">
              Users
            </Link>
            .
          </>
        }
        actions={
          <Button onClick={(): void => setEditingCode(NEW_ROLE_KEY)}>
            <Plus />
            New role
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardContent className="pt-6">
              <ul className="space-y-1">
                {roles.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={(): void => setEditingCode(r.code)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        editingCode === r.code
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground',
                      )}
                    >
                      <span className="font-medium">{r.name}</span>
                      <span
                        className={cn(
                          'text-xs',
                          editingCode === r.code
                            ? 'text-primary-foreground/80'
                            : 'text-muted-foreground',
                        )}
                      >
                        {r.code}
                      </span>
                    </button>
                  </li>
                ))}
                {roles.length === 0 ? (
                  <li className="text-sm text-muted-foreground">No roles yet.</li>
                ) : null}
              </ul>
            </CardContent>
          </Card>

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
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Pick a role on the left or create a new one.
              </CardContent>
            </Card>
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
    <Card>
      <CardContent className="space-y-4 pt-6">
        {isWildcard ? (
          <Alert variant="warning">
            <ShieldAlert className="size-4" />
            <AlertTitle>Wildcard role</AlertTitle>
            <AlertDescription>
              This role uses the wildcard <code className="font-mono">*</code> permission
              (bootstrap admin). The matrix below is informational; saving the role will replace
              the wildcard with whatever the matrix shows.
            </AlertDescription>
          </Alert>
        ) : null}
        <form
          className="space-y-4"
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
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rcode">Code</Label>
              <Input
                id="rcode"
                value={code}
                onChange={(e): void => setCode(e.target.value)}
                disabled={!!props.role.code}
                required
                maxLength={64}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rname">Display name</Label>
              <Input
                id="rname"
                value={name}
                onChange={(e): void => setName(e.target.value)}
                required
                maxLength={160}
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <Checkbox
              checked={requiresTwoFactor}
              onChange={(e): void => setRequiresTwoFactor(e.target.checked)}
            />
            Requires two-factor authentication on assigned users
          </label>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Permissions</h3>
            {grouped.map(([module, perms]) => (
              <fieldset key={module} className="rounded-md border p-3">
                <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {module}
                </legend>
                <div className="space-y-1.5">
                  {perms.map((p) => (
                    <label
                      key={p.code}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Checkbox
                        checked={permissions.has(p.code)}
                        onChange={(e): void => {
                          setPermissions((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(p.code);
                            else next.delete(p.code);
                            return next;
                          });
                        }}
                      />
                      <code className="font-mono text-xs">{p.code}</code>
                      <span className="text-muted-foreground">— {p.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit">Save</Button>
            {props.onDelete ? (
              <Button type="button" variant="destructive" onClick={props.onDelete}>
                Delete role
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
