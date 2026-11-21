import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { StickyFormActions, useConfirmDialog } from '@endora-commerce/admin-kit/components';
import { AlertTriangle, ChevronDown, ChevronRight, Info, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { missingPermissionRequirements } from '@endora-commerce/contracts';
import {
  ApiError,
  apiClient,
  cn,
  useModulePresence,
  useUnsavedChangesPrompt,
} from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  EditorSection,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  SettingRow,
  Switch,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { resolvePermissionLabel } from '../permission-label.js';
import {
  groupPermissions,
  groupSelection,
  humanizeModuleId,
  setGroupSelection,
  type PermissionGroup,
} from '../role-editor-model.js';

interface AdminRole {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  requiresTwoFactor: boolean;
  /**
   * Issue #948 — present while the flag is set and not applied (`mfa` has no
   * encryption key), as the Settings read's `notice`.
   */
  twoFactorNotice?: { code: string; message: string };
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

type Translate = (key: string, params?: Record<string, string | number>) => string;

const NEW_ROLE_KEY = '__new__';

export default function AdminRolesPage(): ReactNode {
  const t = useTranslation('core');
  const tu = useTranslation('admin_users');
  const { confirm, confirmDialog } = useConfirmDialog();
  // Issue #349 — the two-factor flag is enforced by `mfa` at sign-in, so the
  // editor offers it only while `mfa` is present.
  const mfaPresent = useModulePresence().isPresent('mfa');
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [permissions, setPermissions] = useState<PermissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A deletion closes the editor, so it is said beside "New role" in a region
  // mounted before it has text — not a success banner (issue #1499, DEC-12 a).
  const { props: statusProps, show: showStatus, clear: clearStatus } = useInlineStatus();
  // Issue #1449 (DS-19) — a save's refusal and outcome are said in the editor's save bar,
  // beside the Save that caused them, not in the page banner above the role list.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveInfo, setSaveInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Issue #1521 — the open editor's draft differs from the stored role; opening
  // another role would drop it, so that asks first.
  const [editorDirty, setEditorDirty] = useState(false);
  const [editingCode, setEditingCodeState] = useState<string | null>(null);
  const setEditingCode = useCallback((next: string | null): void => {
    setSaveError(null);
    setSaveInfo(null);
    setEditingCodeState(next);
  }, []);
  const openEditor = useCallback(
    async (next: string): Promise<void> => {
      if (next === editingCode) return;
      if (
        editorDirty &&
        !(await confirm({
          message: t('adminRoles.discardChanges.confirm'),
          confirmLabel: t('form.unsavedChanges.discard'),
          cancelLabel: t('form.unsavedChanges.stay'),
          destructive: true,
        }))
      ) {
        return;
      }
      clearStatus();
      setEditingCode(next);
    },
    [clearStatus, setEditingCode, editingCode, editorDirty, confirm, t],
  );

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
      setSaveError(null);
      setSaveInfo(null);
      setSaving(true);
      try {
        // Issue #349 — turning the requirement on signs out the holders who
        // have no second factor, so say how many before the save.
        const previous = roles.find((r) => r.code === input.originalCode);
        if (mfaPresent && input.requiresTwoFactor && previous?.requiresTwoFactor !== true) {
          const impact = await apiClient.get<{ data: { unprotectedAdministrators: number | null } }>(
            `/api/v1/admin/admin-roles/${input.code}/two-factor-impact`,
          );
          const count = impact.data.unprotectedAdministrators ?? 0;
          if (
            count > 0 &&
            !(await confirm({ message: tu('roles.twoFactor.confirmSignOut', { count }), destructive: true }))
          ) {
            return;
          }
        }
        const saved = await apiClient.put<{ data: AdminRole & { signedOutAdministrators: number } }>(
          `/api/v1/admin/admin-roles/${input.code}`,
          {
            code: input.code,
            name: input.name,
            permissions: input.permissions,
            requiresTwoFactor: input.requiresTwoFactor,
          },
        );
        const signedOut = saved.data.signedOutAdministrators;
        setEditingCode(input.code);
        setSaveInfo(
          signedOut > 0
            ? tu('roles.twoFactor.signedOut', { code: input.code, count: signedOut })
            : t('adminRoles.info.saved', { code: input.code }),
        );
        await refresh();
      } catch (err) {
        setSaveError(err instanceof ApiError ? err.envelope.error.message : t('adminRoles.error.save'));
      } finally {
        setSaving(false);
      }
    },
    [refresh, t, tu, roles, mfaPresent, confirm, setEditingCode],
  );

  const handleDelete = useCallback(
    async (role: AdminRole): Promise<void> => {
      const ok = await confirm({
        message: t('adminRoles.confirmDelete', { name: role.name }),
        confirmLabel: t('common.action.delete'),
        destructive: true,
      });
      if (!ok) return;
      clearStatus();
      try {
        await apiClient.delete<void>(`/api/v1/admin/admin-roles/${role.id}`);
        showStatus(t('adminRoles.info.deleted', { code: role.code }));
        if (editingCode === role.code) setEditingCode(null);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminRoles.error.delete'));
      }
    },
    [refresh, editingCode, t, confirm, setEditingCode, clearStatus, showStatus],
  );

  return (
    <>
      <PageHeader
        title={t('adminRoles.page.title')}
        actions={
          <div className="flex items-center gap-3">
            <InlineStatus {...statusProps} />
            <Button onClick={(): void => void openEditor(NEW_ROLE_KEY)}>
              <Plus />
              {t('adminRoles.newRole')}
            </Button>
          </div>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('adminRoles.loading')}</p>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardContent>
              <ul className="space-y-1">
                {roles.map((r) => {
                  const current = editingCode === r.code;
                  return (
                    <li key={r.id}>
                      {/* Issue #1521 — the open role is marked with a muted fill and a rule, not a
                          second filled primary block competing with "New role" (Von Restorff). */}
                      <button
                        type="button"
                        aria-current={current ? 'true' : undefined}
                        onClick={(): void => void openEditor(r.code)}
                        className={cn(
                          'flex w-full flex-col items-start gap-0.5 rounded-md border-l-2 px-3 py-2 text-left text-sm transition-colors',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          current
                            ? 'border-primary bg-muted text-foreground'
                            : 'border-transparent hover:bg-muted/60',
                        )}
                      >
                        <span className="font-medium">{translateRoleName(t, r)}</span>
                        <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
                      </button>
                    </li>
                  );
                })}
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
              title={editingCode === NEW_ROLE_KEY ? t('adminRoles.newRole') : translateRoleName(t, editing)}
              permissions={permissions}
              mfaPresent={mfaPresent}
              saving={saving}
              saveError={saveError}
              saveInfo={saveInfo}
              onDirtyChange={setEditorDirty}
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
              <CardContent className="text-sm text-muted-foreground">
                {t('adminRoles.selectHint')}
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {confirmDialog}
    </>
  );
}

interface RoleEditorProps {
  role: Omit<AdminRole, 'updatedAt'>;
  /** The role's name as the list shows it, or "New role". */
  title: string;
  permissions: PermissionRow[];
  /** Whether `mfa` is present — the two-factor flag is offered only then. */
  mfaPresent: boolean;
  /** A save is in flight: Save is disabled so it cannot be sent twice. */
  saving: boolean;
  onSave: (input: {
    code: string;
    name: string;
    permissions: string[];
    requiresTwoFactor: boolean;
  }) => void;
  onDelete: (() => void) | null;
  /** Told whenever the draft starts or stops differing from the stored role. */
  onDirtyChange: (dirty: boolean) => void;
  /** The last save's refusal, said in the save bar. */
  saveError: string | null;
  /** The last save's outcome, said in the save bar. */
  saveInfo: string | null;
}

/**
 * One role, as one card of sections (issue #1521, UX audit SHELL-13; DS-03):
 * the card's header names the role and carries Delete, the whole form away
 * from Save (Fitts); *Details* holds the code, the name and the two-factor
 * switch; *Permissions* holds the full-access switch and, when it is off, a
 * filter and one collapsible section per module. Save is the one primary, in
 * the sticky bar at the end of the form (DS-19).
 */
function RoleEditor(props: RoleEditorProps): ReactNode {
  const t = useTranslation('core');
  const tu = useTranslation('admin_users');
  // Not `t`: a permission label may live in the owning module's own namespace
  // since feature 091's Phase 3, and `t` is bound to one scope. See
  // `permission-label.ts` for why the lookup is over the merged bundle.
  const { language, bundle, fallbackBundle } = useTranslationContext();
  const fieldId = useId();
  const filterRef = useRef<HTMLInputElement>(null);
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
  const [filter, setFilter] = useState('');
  // A group opens by default when the stored role holds one of its codes, or
  // while a filter is typed; the operator's own open/close wins over both.
  // Read from the stored role, not the draft, so unticking a group's last code
  // does not fold it away under the pointer.
  const [initiallyOpen] = useState<ReadonlySet<string>>(() => {
    const held = new Set(props.role.permissions);
    return new Set(props.permissions.filter((p) => held.has(p.code)).map((p) => p.module));
  });
  const [openState, setOpenState] = useState<ReadonlyMap<string, boolean>>(new Map());

  const permissionLabel = useCallback(
    (row: PermissionRow): string =>
      resolvePermissionLabel({ code: row.code, fallbackLabel: row.label, language, bundle, fallbackBundle }),
    [language, bundle, fallbackBundle],
  );
  // The module's own name (`module.name` in its bundle), as the e-mail list and the
  // organization roles tab name modules; words from the id when a module names itself nowhere.
  const moduleLabel = useCallback(
    (moduleId: string): string =>
      bundle[moduleId]?.['module.name'] ?? fallbackBundle?.[moduleId]?.['module.name'] ?? humanizeModuleId(moduleId),
    [bundle, fallbackBundle],
  );
  const rowsByCode = useMemo(() => new Map(props.permissions.map((p) => [p.code, p])), [props.permissions]);
  const labelOfCode = useCallback(
    (permissionCode: string): string => {
      const row = rowsByCode.get(permissionCode);
      return row ? permissionLabel(row) : permissionCode;
    },
    [rowsByCode, permissionLabel],
  );

  const groups = useMemo(
    () => groupPermissions(props.permissions, { moduleLabel, permissionLabel, filter }),
    [props.permissions, moduleLabel, permissionLabel, filter],
  );
  const filtering = filter.trim() !== '';

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
  const selectedCount = props.permissions.filter((p) => permissions.has(p.code)).length;

  // Issue #1449 — the draft against the stored role, for the bar's "Unsaved changes".
  const storedPermissions = props.role.permissions.filter((p) => p !== '*');
  const dirty =
    code !== props.role.code ||
    name !== props.role.name ||
    requiresTwoFactor !== props.role.requiresTwoFactor ||
    wildcard !== (isPlatformAdmin || props.role.permissions.includes('*')) ||
    permissions.size !== storedPermissions.length ||
    storedPermissions.some((p) => !permissions.has(p));

  const { onDirtyChange } = props;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => (): void => onDirtyChange(false), [onDirtyChange]);
  useUnsavedChangesPrompt(dirty && !props.saving);

  const toggleCodes = (codes: readonly string[], on: boolean): void =>
    setPermissions((prev) => setGroupSelection(prev, codes, on));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <CardTitle>{props.title}</CardTitle>
          {props.role.code ? (
            <p className="font-mono text-xs text-muted-foreground">{props.role.code}</p>
          ) : null}
        </div>
        {props.onDelete ? (
          // Issue #1449 / #1521 — Delete sits in the editor's header, the whole form away from
          // Save (Fitts: a destructive action gets distance, not proximity), and outlined so the
          // one filled button in the editor is Save (Von Restorff).
          <Button type="button" variant="outline" size="sm" onClick={props.onDelete}>
            <Trash2 aria-hidden="true" />
            {t('adminRoles.delete')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        <form
          className="space-y-(--section-gap)"
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
          <EditorSection as="h3" title={t('adminRoles.section.details')}>
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label={t('adminRoles.field.code')} id={`${fieldId}-code`}>
                <Input
                  value={code}
                  onChange={(e): void => setCode(e.target.value)}
                  disabled={!!props.role.code}
                  required
                  maxLength={64}
                  className="font-mono"
                />
              </FormField>
              <FormField label={t('adminRoles.field.displayName')} id={`${fieldId}-name`}>
                <Input
                  value={name}
                  onChange={(e): void => setName(e.target.value)}
                  required
                  maxLength={160}
                />
              </FormField>
            </div>
            <SettingRow
              label={t('adminRoles.field.requires2fa')}
              description={props.mfaPresent ? tu('roles.twoFactor.help') : tu('roles.twoFactor.mfaOff')}
            >
              <Switch
                checked={requiresTwoFactor}
                disabled={!props.mfaPresent}
                onCheckedChange={setRequiresTwoFactor}
              />
            </SettingRow>
            {props.mfaPresent && props.role.twoFactorNotice ? (
              <p
                role="status"
                className="flex items-start gap-1 text-xs font-medium text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                <span>
                  {props.role.twoFactorNotice.code === 'encryption_key_missing'
                    ? tu('roles.twoFactor.notice.encryption_key_missing')
                    : props.role.twoFactorNotice.message}
                </span>
              </p>
            ) : null}
          </EditorSection>

          <EditorSection
            as="h3"
            title={t('adminRoles.permissionsHeading')}
            action={
              wildcard ? null : (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t('adminRoles.permissions.count', { selected: selectedCount, total: props.permissions.length })}
                </span>
              )
            }
          >
            {/* Issue #1521 — full access is a state, so a switch (DEC-04); its warning is shown
                only while it is on, instead of a warning banner around the control at all times. */}
            <SettingRow
              label={t('adminRoles.wildcardToggle')}
              hint={isPlatformAdmin ? t('adminRoles.wildcardLocked') : t('adminRoles.wildcard.hint')}
            >
              <Switch checked={wildcard} disabled={isPlatformAdmin} onCheckedChange={setWildcard} />
            </SettingRow>

            {wildcard ? (
              <Alert variant="warning">
                <ShieldAlert className="size-4" aria-hidden="true" />
                <AlertDescription>{t('adminRoles.wildcard.onWarning')}</AlertDescription>
              </Alert>
            ) : (
              <>
                {missing.length > 0 ? (
                  <Alert>
                    <Info className="size-4" aria-hidden="true" />
                    <AlertTitle>{t('adminRoles.dependencies.title')}</AlertTitle>
                    <AlertDescription className="space-y-2">
                      <p>{t('adminRoles.dependencies.hint')}</p>
                      <div className="flex flex-wrap gap-2">
                        {missing.map((missingCode) => (
                          <Button
                            key={missingCode}
                            type="button"
                            size="sm"
                            variant="outline"
                            title={missingCode}
                            onClick={(): void => toggleCodes([missingCode], true)}
                          >
                            {t('adminRoles.dependencies.add', { label: labelOfCode(missingCode) })}
                          </Button>
                        ))}
                        {missing.length > 1 ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={(): void => toggleCodes(missing, true)}
                          >
                            {t('adminRoles.dependencies.addAll')}
                          </Button>
                        ) : null}
                      </div>
                    </AlertDescription>
                  </Alert>
                ) : null}

                <Input
                  ref={filterRef}
                  type="search"
                  value={filter}
                  onChange={(e): void => setFilter(e.target.value)}
                  aria-label={t('adminRoles.filter.label')}
                  placeholder={t('adminRoles.filter.placeholder')}
                  className="max-w-sm"
                />

                {groups.length === 0 && filtering ? (
                  <EmptyState
                    variant="no-results"
                    onClearFilters={(): void => setFilter('')}
                    focusAfterClear={filterRef}
                  />
                ) : (
                  <div className="divide-y divide-border border-y border-border">
                    {groups.map((group) => (
                      <PermissionGroupSection
                        key={group.module}
                        group={group}
                        selected={permissions}
                        open={openState.get(group.module) ?? (filtering || initiallyOpen.has(group.module))}
                        onOpenChange={(next): void =>
                          setOpenState((prev) => new Map(prev).set(group.module, next))
                        }
                        onToggle={toggleCodes}
                        permissionLabel={permissionLabel}
                        labelOfCode={labelOfCode}
                        moduleLabel={moduleLabel}
                        t={t}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </EditorSection>

          {/* Issue #1449 (DS-19) — the one Save stays in view over a long permission list. */}
          <StickyFormActions
            desktop="sticky"
            dirty={dirty}
            error={props.saveError}
            status={props.saveInfo}
            primary={
              <Button type="submit" disabled={props.saving} aria-busy={props.saving || undefined}>
                {t('adminRoles.save')}
              </Button>
            }
          />
        </form>
      </CardContent>
    </Card>
  );
}

interface PermissionGroupSectionProps {
  group: PermissionGroup;
  selected: ReadonlySet<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (codes: readonly string[], on: boolean) => void;
  permissionLabel: (row: PermissionRow) => string;
  labelOfCode: (code: string) => string;
  moduleLabel: (moduleId: string) => string;
  t: Translate;
}

/**
 * One module's permissions: a heading that opens and closes the list, a
 * "3 / 7" count and a tri-state checkbox that ticks or clears every row shown
 * (Hick: an operator decides per module first, then per permission).
 * The checkbox and the count act on the rows the filter leaves.
 */
function PermissionGroupSection(props: PermissionGroupSectionProps): ReactNode {
  const { group, t } = props;
  const listId = useId();
  const codes = group.rows.map((row) => row.code);
  const selection = groupSelection(codes, props.selected);
  return (
    <EditorSection
      as="h4"
      divider={false}
      className="space-y-2 py-2"
      title={
        <button
          type="button"
          aria-expanded={props.open}
          aria-controls={listId}
          onClick={(): void => props.onOpenChange(!props.open)}
          className={cn(
            'inline-flex min-h-8 items-center gap-1.5 rounded-sm text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {props.open ? (
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          )}
          {group.label}
        </button>
      }
      action={
        <span className="flex items-center gap-3">
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('adminRoles.group.count', { selected: selection.selected, total: selection.total })}
          </span>
          <Checkbox
            aria-label={t('adminRoles.group.selectAll', { module: group.label })}
            checked={selection.state === 'all'}
            ref={(el): void => {
              if (el) el.indeterminate = selection.state === 'some';
            }}
            onChange={(e): void => props.onToggle(codes, e.target.checked)}
          />
        </span>
      }
    >
      <ul id={listId} hidden={!props.open} className="divide-y divide-border pb-1 pl-6">
        {group.rows.map((row) => (
          <PermissionRowItem
            key={row.code}
            row={row}
            checked={props.selected.has(row.code)}
            onToggle={(on): void => props.onToggle([row.code], on)}
            label={props.permissionLabel(row)}
            labelOfCode={props.labelOfCode}
            moduleLabel={props.moduleLabel}
            t={t}
          />
        ))}
      </ul>
    </EditorSection>
  );
}

interface PermissionRowItemProps {
  row: PermissionRow;
  checked: boolean;
  onToggle: (on: boolean) => void;
  label: string;
  labelOfCode: (code: string) => string;
  moduleLabel: (moduleId: string) => string;
  t: Translate;
}

/**
 * One permission: its label is the checkbox's name, and the code, what it
 * needs and which modules keep it grantable are one muted second line that
 * describes it. The whole row is the click target (Fitts).
 */
function PermissionRowItem(props: PermissionRowItemProps): ReactNode {
  const { row, t } = props;
  const id = useId();
  const labelId = `${id}-label`;
  const detailId = `${id}-detail`;
  return (
    <li className="py-2">
      <label className="flex cursor-pointer items-start gap-3">
        <Checkbox
          className="mt-0.5"
          checked={props.checked}
          aria-labelledby={labelId}
          aria-describedby={detailId}
          onChange={(e): void => props.onToggle(e.target.checked)}
        />
        <span className="min-w-0 space-y-0.5">
          <span id={labelId} className="block text-sm">
            {props.label}
          </span>
          <span id={detailId} className="block text-xs text-muted-foreground">
            <code className="font-mono">{row.code}</code>
            {row.requires?.length ? (
              <>
                {' · '}
                {t('adminRoles.requires', { permissions: row.requires.map(props.labelOfCode).join(', ') })}
              </>
            ) : null}
            {ownersWorthShowing(row) ? (
              <>
                {' · '}
                {t('adminRoles.owners', { modules: row.owners.map(props.moduleLabel).join(', ') })}
              </>
            ) : null}
          </span>
        </span>
      </label>
    </li>
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

function translateRoleName(t: Translate, role: Pick<AdminRole, 'code' | 'name'>): string {
  const key = `adminRoles.seeded.${role.code}`;
  const label = t(key);
  return label === `core.${key}` ? role.name : label;
}
