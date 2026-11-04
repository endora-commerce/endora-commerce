import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { History, Plus, Trash2 } from 'lucide-react';
import type {
  OrganizationPermissionCatalogueResponse,
  OrganizationRoleView,
} from '@endora-commerce/contracts';
import { ApiError, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { organizationRolesClient } from '../api/roles.js';

/**
 * The operator's *Roles* tab of an Organization (`specs/170-organization-roles/`
 * US 7, FR-060, FR-061, FR-066; `contracts/operator-api.md` §5).
 *
 * The same rules as the storefront's role screens: *Administrator* holds every
 * permission and is not edited, *Member* takes permission changes only, a custom
 * role is created, edited and deleted — and a role somebody holds is deleted only
 * with a role to move its holders to. Every refusal (protected role, taken name,
 * stale version, role limit) is the server's, shown as it answered it. The tab
 * links to the Organization's history, where each change is audited against the
 * Organization (research R-32).
 */

type Catalogue = OrganizationPermissionCatalogueResponse['data'];

/** Either code reads the roles; the routes gate the same way (`requireAdminAny`). */
const READ_ROLES: [string, string] = ['organizations:read-roles', 'organizations:manage-roles'];
const MANAGE_ROLES = 'organizations:manage-roles';

/**
 * The gate, as `OrganizationSalesRepsTab`'s: a wrapper rather than an early
 * return, so *hidden* means *nothing requested* — no `403` logged for an
 * operator without the codes, no `404` for a personal Organization, whose role
 * routes answer that (the storefront offers it no role screen either).
 */
export function OrganizationRolesTab(props: {
  organizationId: string;
  isPersonal: boolean;
  /** Called after a role was created, edited or deleted, so the screen can re-read what depends on roles. */
  onRolesChanged?: () => void;
}): ReactNode {
  const isVisible = useSurfaceVisibility();
  if (props.isPersonal) return null;
  if (!isVisible({ module: 'organizations', requiredPermission: READ_ROLES })) return null;
  return (
    <OrganizationRolesPanel
      organizationId={props.organizationId}
      canManage={isVisible({ module: 'organizations', requiredPermission: MANAGE_ROLES })}
      {...(props.onRolesChanged ? { onRolesChanged: props.onRolesChanged } : {})}
    />
  );
}

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; role: OrganizationRoleView }
  | { mode: 'view'; role: OrganizationRoleView };

function OrganizationRolesPanel({
  organizationId,
  canManage,
  onRolesChanged,
}: {
  organizationId: string;
  canManage: boolean;
  onRolesChanged?: () => void;
}): ReactNode {
  const t = useTranslation('organizations');
  const isVisible = useSurfaceVisibility();
  const [roles, setRoles] = useState<OrganizationRoleView[]>([]);
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<OrganizationRoleView | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, perms] = await Promise.all([
        organizationRolesClient.list(organizationId),
        organizationRolesClient.catalogue(organizationId),
      ]);
      setRoles(list.data);
      setCatalogue(perms.data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.envelope.error.message : t('roles.error.load'));
    } finally {
      setLoading(false);
    }
  }, [organizationId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const afterWrite = useCallback(
    async (message: string): Promise<void> => {
      setInfo(message);
      setEditor(null);
      setDeleting(null);
      await refresh();
      onRolesChanged?.();
    },
    [refresh, onRolesChanged],
  );

  // The link is offered only to an operator who may open the audit log, so it
  // never leads to a 403. Gated on the code alone: naming the audit module here
  // would be a cross-module id `check:admin-zones` refuses, and that module is
  // `nonDeactivatable`, so its presence cannot close anyway.
  const showHistory = isVisible({ requiredPermission: 'audit_log:read' });
  const hasCustom = roles.some((r) => r.kind === 'custom');

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>
            <h2 className="text-base font-semibold">{t('roles.tab.title')}</h2>
          </CardTitle>
          <CardDescription>{t('roles.tab.description')}</CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {showHistory ? (
            <Button asChild variant="outline" size="sm">
              <Link to={`/audit-log?objectType=organization&objectId=${encodeURIComponent(organizationId)}`}>
                <History aria-hidden="true" />
                {t('roles.tab.history')}
              </Link>
            </Button>
          ) : null}
          {canManage ? (
            <Button type="button" size="sm" onClick={(): void => setEditor({ mode: 'create' })} disabled={loading || catalogue === null}>
              <Plus aria-hidden="true" />
              {t('roles.action.create')}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="status" aria-live="polite" className="text-sm">
          {loading ? <span className="text-muted-foreground">{t('roles.loading')}</span> : null}
          {info && !loading ? (
            <Alert variant="success">
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        {loadError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              {loadError}
              <Button type="button" variant="outline" size="sm" onClick={(): void => void refresh()}>
                {t('roles.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {!loadError && roles.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('roles.list.column.name')}</TableHead>
                <TableHead className="text-right">{t('roles.list.column.members')}</TableHead>
                <TableHead className="text-right">{t('roles.list.column.invitations')}</TableHead>
                <TableHead>{t('roles.list.column.permissions')}</TableHead>
                {canManage ? (
                  <TableHead className="text-right">
                    <span className="sr-only">{t('roles.action.edit')}</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {roles.map((role) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  canManage={canManage}
                  onOpen={(): void => setEditor({ mode: canManage ? 'edit' : 'view', role })}
                  onDelete={(): void => setDeleting(role)}
                />
              ))}
            </TableBody>
          </Table>
        ) : null}
        {!loading && !loadError && !hasCustom ? (
          <p className="text-sm text-muted-foreground">{t('roles.list.empty')}</p>
        ) : null}
      </CardContent>

      {editor && catalogue ? (
        <RoleEditorDialog
          organizationId={organizationId}
          state={editor}
          catalogue={catalogue}
          onClose={(): void => setEditor(null)}
          onSaved={(created): Promise<void> => afterWrite(created ? t('roles.info.created') : t('roles.info.saved'))}
        />
      ) : null}
      {deleting ? (
        <DeleteRoleDialog
          organizationId={organizationId}
          role={deleting}
          roles={roles}
          onClose={(): void => setDeleting(null)}
          onDeleted={(): Promise<void> => afterWrite(t('roles.info.deleted'))}
        />
      ) : null}
    </Card>
  );
}

function RoleRow({
  role,
  canManage,
  onOpen,
  onDelete,
}: {
  role: OrganizationRoleView;
  canManage: boolean;
  onOpen: () => void;
  onDelete: () => void;
}): ReactNode {
  const t = useTranslation('organizations');
  const isAdministrator = role.kind === 'administrator';
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          {isAdministrator ? (
            <span className="font-medium">{role.name}</span>
          ) : (
            <Button type="button" variant="link" className="h-auto p-0 font-medium" onClick={onOpen}>
              {role.name}
            </Button>
          )}
          <Badge variant={role.kind === 'custom' ? 'outline' : 'secondary'}>
            {role.kind === 'custom' ? t('roles.kind.custom') : t('roles.kind.predefined')}
          </Badge>
        </div>
        {role.description ? <p className="mt-1 text-xs text-muted-foreground">{role.description}</p> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">{role.memberCount}</TableCell>
      <TableCell className="text-right tabular-nums">{role.pendingInvitationCount}</TableCell>
      <TableCell className="tabular-nums">
        {isAdministrator ? t('roles.list.allPermissions') : role.permissions.length}
      </TableCell>
      {canManage ? (
        <TableCell className="space-x-2 text-right">
          {isAdministrator ? null : (
            <Button type="button" variant="secondary" size="sm" onClick={onOpen}>
              {t('roles.action.edit')}
            </Button>
          )}
          {role.kind === 'custom' ? (
            <Button type="button" variant="outline" size="sm" onClick={onDelete}>
              <Trash2 aria-hidden="true" />
              {t('roles.action.delete')}
            </Button>
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function RoleEditorDialog({
  organizationId,
  state,
  catalogue,
  onClose,
  onSaved,
}: {
  organizationId: string;
  state: EditorState;
  catalogue: Catalogue;
  onClose: () => void;
  onSaved: (created: boolean) => Promise<void>;
}): ReactNode {
  const t = useTranslation('organizations');
  const common = useTranslation('core');
  const fieldId = useId();
  const role = state.mode === 'create' ? null : state.role;
  const readOnly = state.mode === 'view';
  const namesEditable = !readOnly && (role === null || role.kind === 'custom');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [granted, setGranted] = useState<ReadonlySet<string>>(() => new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Catalogue order, so the request lists codes the way the editor shows them.
  const orderedGrants = useMemo(
    () => catalogue.groups.flatMap((g) => g.permissions.map((p) => p.code)).filter((code) => granted.has(code)),
    [catalogue, granted],
  );

  const toggle = (code: string, on: boolean): void => {
    setGranted((current) => {
      const next = new Set(current);
      if (on) next.add(code);
      else next.delete(code);
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (role === null) {
        const trimmedDescription = description.trim();
        await organizationRolesClient.create(organizationId, {
          name: name.trim(),
          ...(trimmedDescription ? { description: trimmedDescription } : {}),
          permissions: orderedGrants,
        });
        await onSaved(true);
      } else {
        await organizationRolesClient.update(organizationId, role.id, {
          expectedVersion: role.version,
          ...(role.kind === 'custom'
            ? { name: name.trim(), description: description.trim() === '' ? null : description.trim() }
            : {}),
          permissions: orderedGrants,
        });
        await onSaved(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('roles.error.save'));
      setBusy(false);
    }
  };

  const title = readOnly && role ? role.name : role === null ? t('roles.editor.createTitle') : t('roles.editor.editTitle');
  const canSave = !busy && (!namesEditable || name.trim().length > 0);

  return (
    <ModalDialog
      title={title}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={readOnly}
      widthClassName="max-w-2xl"
      footer={
        readOnly ? (
          <Button type="button" variant="outline" onClick={onClose}>
            {common('common.action.close')}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              {t('roles.action.cancel')}
            </Button>
            <Button type="button" onClick={(): void => void save()} disabled={!canSave}>
              {busy ? t('roles.action.saving') : t('roles.action.save')}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {role?.kind === 'member' ? <p className="text-sm text-muted-foreground">{t('roles.editor.memberNotice')}</p> : null}
        {readOnly && role?.description ? <p className="text-sm text-muted-foreground">{role.description}</p> : null}
        {namesEditable ? (
          <>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-name`}>{t('roles.editor.field.name')}</Label>
              <Input
                id={`${fieldId}-name`}
                value={name}
                maxLength={80}
                required
                onChange={(e): void => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-description`}>{t('roles.editor.field.description')}</Label>
              <Textarea
                id={`${fieldId}-description`}
                value={description}
                maxLength={500}
                rows={2}
                onChange={(e): void => setDescription(e.target.value)}
              />
            </div>
          </>
        ) : null}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">{t('roles.editor.field.permissions')}</h3>
          {catalogue.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('roles.editor.noPermissions')}</p>
          ) : (
            catalogue.groups.map((group) => (
              <fieldset key={group.moduleId} className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-sm font-medium">{group.moduleLabel}</legend>
                {group.permissions.map((permission) => {
                  const id = `${fieldId}-${permission.code}`;
                  return (
                    <div key={permission.code} className="flex items-start gap-3 py-1">
                      <Checkbox
                        id={id}
                        className="mt-0.5"
                        checked={granted.has(permission.code)}
                        disabled={readOnly || busy}
                        aria-describedby={`${id}-description`}
                        onChange={(e): void => toggle(permission.code, e.target.checked)}
                      />
                      <div className="space-y-0.5">
                        <Label htmlFor={id} className="font-normal">
                          {permission.label}
                        </Label>
                        <p id={`${id}-description`} className="text-xs text-muted-foreground">
                          {permission.description}
                          {permission.memberDefault ? (
                            <span className="block">{t('roles.editor.memberDefault')}</span>
                          ) : null}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </fieldset>
            ))
          )}
        </div>
      </div>
    </ModalDialog>
  );
}

function DeleteRoleDialog({
  organizationId,
  role,
  roles,
  onClose,
  onDeleted,
}: {
  organizationId: string;
  role: OrganizationRoleView;
  roles: readonly OrganizationRoleView[];
  onClose: () => void;
  onDeleted: () => Promise<void>;
}): ReactNode {
  const t = useTranslation('organizations');
  const fieldId = useId();
  const held = role.memberCount + role.pendingInvitationCount > 0;
  const candidates = roles.filter((r) => r.id !== role.id);
  const [replacement, setReplacement] = useState<string>(
    () => candidates.find((r) => r.kind === 'member')?.id ?? candidates[0]?.id ?? '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await organizationRolesClient.remove(organizationId, role.id, {
        expectedVersion: role.version,
        ...(held ? { replacementRoleId: replacement } : {}),
      });
      await onDeleted();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('roles.error.delete'));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('roles.delete.title')}
      onClose={onClose}
      busy={busy}
      aria-describedby={`${fieldId}-question`}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('roles.action.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={(): void => void confirm()}
            disabled={busy || (held && replacement === '')}
          >
            <Trash2 aria-hidden="true" />
            {t('roles.delete.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <p id={`${fieldId}-question`} className="text-sm">
          {t('roles.delete.description', { name: role.name })}
        </p>
        {held ? (
          <>
            <p className="text-sm">
              {t('roles.delete.held', {
                members: String(role.memberCount),
                invitations: String(role.pendingInvitationCount),
              })}
            </p>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-replacement`}>{t('roles.delete.replacement')}</Label>
              <Select
                id={`${fieldId}-replacement`}
                value={replacement}
                disabled={busy}
                onChange={(e): void => setReplacement(e.target.value)}
              >
                {candidates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
      </div>
    </ModalDialog>
  );
}
