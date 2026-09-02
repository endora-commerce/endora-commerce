import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Info, Plus, ShieldAlert } from 'lucide-react';
import { missingPermissionRequirements } from '@endora-commerce/contracts';
import { ApiError, apiClient, cn } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  Checkbox,
  Input,
  Label,
  PageHeader,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { resolvePermissionLabel } from '../permission-label.js';

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
  /**
   * The modules whose presence keeps this code grantable — D-175 / T058.
   *
   * It is **not** `module`, which is a display grouping: `_lifecycle` files its
   * codes under `module: 'module_lifecycle'`, and a shared code such as
   * `integrations:manage` has two owners and one grouping. Only the grouping
   * used to be on the wire, which is why a reader seeing one module name
   * reasonably concluded there was one owner — and D-173 is the proof that a
   * careful reader got it wrong.
   */
  owners: string[];
  /** Codes a role holding this one also needs — advisory (D-175 / T057). */
  requires?: string[];
}

const NEW_ROLE_KEY = '__new__';

export default function AdminRolesPage(): ReactNode {
  const t = useTranslation('core');
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
      setError(err instanceof ApiError ? err.envelope.error.message : t('adminRoles.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        setInfo(t('adminRoles.info.saved', { code: input.code }));
        setEditingCode(input.code);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminRoles.error.save'));
      }
    },
    [refresh, t],
  );

  const handleDelete = useCallback(
    async (role: AdminRole): Promise<void> => {
      if (!confirm(t('adminRoles.confirmDelete', { name: role.name }))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/admin-roles/${role.id}`);
        setInfo(t('adminRoles.info.deleted', { code: role.code }));
        if (editingCode === role.code) setEditingCode(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminRoles.error.delete'));
      }
    },
    [refresh, editingCode, t],
  );

  return (
    <>
      <PageHeader
        title={t('adminRoles.page.title')}
        description={
          <>
            {t('adminRoles.page.descriptionPrefix')}{' '}
            <Link to="/admin-users" className="underline underline-offset-2">
              {t('adminRoles.usersLink')}
            </Link>
            .
          </>
        }
        actions={
          <Button onClick={(): void => setEditingCode(NEW_ROLE_KEY)}>
            <Plus />
            {t('adminRoles.newRole')}
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
        <p className="text-sm text-muted-foreground">{t('adminRoles.loading')}</p>
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
                      <span className="font-medium">{translateRoleName(t, r)}</span>
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
                  <li className="text-sm text-muted-foreground">{t('adminRoles.empty')}</li>
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
                {t('adminRoles.selectHint')}
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
  const t = useTranslation('core');
  // Not `t`: a permission label may live in the owning module's own namespace
  // since feature 091's Phase 3, and `t` is bound to one scope. See
  // `permission-label.ts` for why the lookup is over the merged bundle.
  const { language, bundle, fallbackBundle } = useTranslationContext();
  const [code, setCode] = useState(props.role.code);
  const [name, setName] = useState(props.role.name);
  const [permissions, setPermissions] = useState<Set<string>>(
    new Set(props.role.permissions.filter((p) => p !== '*')),
  );
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(props.role.requiresTwoFactor);
  // The platform_admin role is locked to full access — the toggle is forced on
  // and disabled so it can never be downgraded (mirrors the backend invariant).
  const isPlatformAdmin = props.role.code === 'platform_admin';
  const [wildcard, setWildcard] = useState(
    isPlatformAdmin || props.role.permissions.includes('*'),
  );

  const grouped = useMemo(() => {
    const byModule = new Map<string, PermissionRow[]>();
    for (const p of props.permissions) {
      const arr = byModule.get(p.module) ?? [];
      arr.push(p);
      byModule.set(p.module, arr);
    }
    return Array.from(byModule.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [props.permissions]);

  /**
   * What this selection is short of — D-175's advisory panel.
   *
   * `missingPermissionRequirements` is `@endora-commerce/contracts`', not a
   * derivation of this screen's: the same function answers the permission
   * inventory's sweep, so the panel and the check cannot come to disagree about
   * what a role is missing. It skips a requirement with no row here, so nothing
   * is ever offered that has no checkbox to tick.
   *
   * Advisory in the strict sense: it changes no submitted value and refuses no
   * save. A role the operator means to leave incomplete is saved incomplete.
   */
  const missing = useMemo(
    () => (wildcard ? [] : missingPermissionRequirements(permissions, props.permissions)),
    [wildcard, permissions, props.permissions],
  );

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <Alert variant="warning">
          <ShieldAlert className="size-4" />
          <AlertTitle>{t('adminRoles.wildcardTitle')}</AlertTitle>
          <AlertDescription className="space-y-2">
            <label className="inline-flex items-center gap-2 font-medium">
              <Checkbox
                checked={wildcard}
                disabled={isPlatformAdmin}
                onChange={(e): void => setWildcard(e.target.checked)}
              />
              {t('adminRoles.wildcardToggle')} <code className="font-mono">*</code>
            </label>
            <p>
              {isPlatformAdmin
                ? t('adminRoles.wildcardLocked')
                : `${t('adminRoles.wildcardPrefix')} ${t('adminRoles.wildcardSuffix')}`}
            </p>
          </AlertDescription>
        </Alert>
        <form
          className="space-y-4"
          onSubmit={(e: FormEvent): void => {
            e.preventDefault();
            props.onSave({
              code,
              name,
              permissions: wildcard ? ['*'] : Array.from(permissions),
              requiresTwoFactor,
            });
          }}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rcode">{t('adminRoles.field.code')}</Label>
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
              <Label htmlFor="rname">{t('adminRoles.field.displayName')}</Label>
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
            {t('adminRoles.field.requires2fa')}
          </label>

          <div className={cn('space-y-3', wildcard && 'pointer-events-none opacity-50')}>
            <h3 className="text-sm font-semibold">{t('adminRoles.permissionsHeading')}</h3>
            {missing.length > 0 ? (
              <Alert>
                <Info className="size-4" />
                <AlertTitle>{t('adminRoles.dependencies.title')}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p>{t('adminRoles.dependencies.description')}</p>
                  <div className="flex flex-wrap gap-2">
                    {missing.map((code) => (
                      <Button
                        key={code}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(): void =>
                          setPermissions((prev) => new Set(prev).add(code))
                        }
                      >
                        {t('adminRoles.dependencies.add', { code })}
                      </Button>
                    ))}
                    {missing.length > 1 ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={(): void =>
                          setPermissions((prev) => {
                            const next = new Set(prev);
                            for (const code of missing) next.add(code);
                            return next;
                          })
                        }
                      >
                        {t('adminRoles.dependencies.addAll')}
                      </Button>
                    ) : null}
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
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
                        checked={wildcard || permissions.has(p.code)}
                        disabled={wildcard}
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
                      <span className="text-muted-foreground">
                        —{' '}
                        {resolvePermissionLabel({
                          code: p.code,
                          fallbackLabel: p.label,
                          language,
                          bundle,
                          fallbackBundle,
                        })}
                      </span>
                      {p.requires?.length ? (
                        <span className="text-xs text-muted-foreground">
                          ({t('adminRoles.requires', { codes: p.requires.join(', ') })})
                        </span>
                      ) : null}
                      {ownersWorthShowing(p) ? (
                        <span className="text-xs text-muted-foreground">
                          ({t('adminRoles.owners', { modules: p.owners.join(', ') })})
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <div className="flex gap-2">
            <Button type="submit">{t('adminRoles.save')}</Button>
            {props.onDelete ? (
              <Button type="button" variant="destructive" onClick={props.onDelete}>
                {t('adminRoles.delete')}
              </Button>
            ) : null}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Whether this row's owner set says anything its display grouping does not —
 * T058.
 *
 * The model has three notions and only `module` was ever visible, so the fix is
 * to show `owners` where the two differ: a shared code kept alive by either of
 * two modules, or a code filed under a grouping that is no module id at all.
 * Rendering it on every row as well would bury the cases that matter under one
 * repeated word, which is how the distinction became invisible in the first
 * place.
 */
function ownersWorthShowing(row: PermissionRow): boolean {
  return row.owners.length > 1 || row.owners[0] !== row.module;
}

function translateRoleName(
  t: (key: string, params?: Record<string, string | number>) => string,
  role: Pick<AdminRole, 'code' | 'name'>,
): string {
  const key = `adminRoles.seeded.${role.code}`;
  const label = t(key);
  return label === `core.${key}` ? role.name : label;
}
