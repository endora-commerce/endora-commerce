import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import {
  ListPage,
  ModalDialog,
  RowActionMenu,
  RowActionMenuItem,
  RowActionMenuSeparator,
  StatusChangeControl,
  useConfirmDialog,
  type ListPageLoad,
} from '@endora-commerce/admin-kit/components';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { ApiError, apiClient, formatDateTime } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  EmptyState,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

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
interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  adminRoleId: string;
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

function describeApiError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.envelope.error.message : fallback;
}

/**
 * The Users list — the kit's `ListPage` (issue #1501, UX audit SHELL-14).
 *
 * - *New user* in the header opens the five-field create form in a dialog; it
 *   used to be drawn open above the table, pushing the list below the fold and
 *   competing with it (Hick, Von Restorff).
 * - The role is a value with a *Change…* dialog (`StatusChangeControl`, DS-18),
 *   not an unlabelled `<select>` that saved on `change` — a stray arrow key
 *   re-roled an account (WCAG 3.2.2, Paradox of the Active User).
 * - *Reset password*, *Deactivate* / *Reactivate* and *Remove* are the row's
 *   overflow menu, *Remove* last and set apart, and confirmed (Fitts: a
 *   destructive action gets distance, not a filled red button in every row).
 */
export default function AdminUsersPage(): ReactNode {
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [load, setLoad] = useState<ListPageLoad>({ kind: 'loading' });
  // An action's refusal, or the last reset that succeeded — above the rows.
  const [error, setError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // The account whose password is being reset, in a dialog.
  const [resetFor, setResetFor] = useState<AdminUser | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // A reload after a write keeps the rows on screen rather than flashing the skeleton.
    setLoad((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    try {
      // The list endpoint is paginated (default pageSize=50, max 200). Until
      // this page grows real pagination UI, we ask for the largest single
      // page so the visible behaviour matches the pre-server-search version.
      const [u, r] = await Promise.all([
        apiClient.get<{ data: AdminUser[] }>('/api/v1/admin/admin-users?pageSize=200'),
        apiClient.get<{ data: AdminRole[] }>('/api/v1/admin/admin-roles'),
      ]);
      setUsers(u.data);
      setRoles(r.data);
      setLoad({ kind: 'ready' });
    } catch (err) {
      setLoad({ kind: 'error', message: describeApiError(err, t('adminUsers.error.load')) });
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Throws on a refused create, so the dialog stays open and says why. */
  const handleCreate = useCallback(
    async (input: CreateUserInput): Promise<void> => {
      await apiClient.post<{ data: AdminUser }>('/api/v1/admin/admin-users', input);
      setCreating(false);
      await refresh();
    },
    [refresh],
  );

  /** Rejects on a refusal, which `StatusChangeControl` shows in its dialog. */
  const handleAssignRole = useCallback(
    async (userId: string, roleId: string): Promise<void> => {
      await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${userId}`, {
        adminRoleId: roleId,
      });
      await refresh();
    },
    [refresh],
  );

  const handleToggleStatus = useCallback(
    async (user: AdminUser): Promise<void> => {
      setError(null);
      setResetDone(null);
      try {
        await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${user.id}`, {
          status: user.status === 'active' ? 'inactive' : 'active',
        });
        await refresh();
      } catch (err) {
        setError(describeApiError(err, t('adminUsers.error.update')));
      }
    },
    [refresh, t],
  );

  /** Throws on a refused reset, so the dialog stays open and says why. */
  const handleResetPassword = useCallback(async (user: AdminUser, password: string): Promise<void> => {
    await apiClient.post<{ data: AdminUser }>(`/api/v1/admin/admin-users/${user.id}/password`, { password });
    setResetFor(null);
    setError(null);
    setResetDone(user.email);
  }, []);

  const handleRemove = useCallback(
    async (user: AdminUser): Promise<void> => {
      setError(null);
      setResetDone(null);
      // The request runs inside the dialog, so a refusal is read where the operator is looking.
      const ok = await confirm({
        message: t('adminUsers.confirmRemove', { email: user.email }),
        confirmLabel: t('adminUsers.remove'),
        destructive: true,
        action: () => apiClient.delete<void>(`/api/v1/admin/admin-users/${user.id}`),
        describeError: (err) => describeApiError(err, t('adminUsers.error.remove')),
      });
      if (ok) await refresh();
    },
    [refresh, t, confirm],
  );

  const newUserButton = (variant: 'default' | 'outline'): ReactNode => (
    <Button type="button" variant={variant} onClick={(): void => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('adminUsers.create.action')}
    </Button>
  );

  return (
    <>
      <ListPage
        title={t('adminUsers.page.title')}
        description={
          <>
            {t('adminUsers.page.descriptionPrefix')}{' '}
            <Link to="/admin-roles" className="underline underline-offset-2">
              {t('adminUsers.rolesLink')}
            </Link>
            .
          </>
        }
        actions={newUserButton('default')}
        load={load}
        onRetry={(): void => void refresh()}
        notice={
          error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : resetDone ? (
            <Alert variant="success">
              <AlertDescription>{t('adminUsers.resetPassword.done', { email: resetDone })}</AlertDescription>
            </Alert>
          ) : null
        }
      >
        {users.length === 0 ? (
          <EmptyState icon={<Users size={20} />} title={t('adminUsers.empty')} action={newUserButton('outline')} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('adminUsers.column.email')}</TableHead>
                <TableHead>{t('adminUsers.column.name')}</TableHead>
                <TableHead>{t('adminUsers.column.role')}</TableHead>
                <TableHead>{t('adminUsers.column.status')}</TableHead>
                <TableHead>{t('adminUsers.column.twoFactor')}</TableHead>
                <TableHead>{t('adminUsers.column.lastLogin')}</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const currentRole = roles.find((r) => r.id === u.adminRoleId);
                return (
                  // Anchor target for deep-links (e.g. the audit-log actor column).
                  <TableRow key={u.id} id={`admin-user-${u.id}`} className="scroll-mt-24">
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      {u.firstName} {u.lastName}
                    </TableCell>
                    <TableCell>
                      {/* An account always holds a role, so there is no "unassign":
                          the targets are every other role. */}
                      <StatusChangeControl
                        label={t('adminUsers.column.role')}
                        labelVisuallyHidden
                        dialogTitle={t('adminUsers.role.changeTitle', { email: u.email })}
                        current={u.adminRoleId ?? ''}
                        currentLabel={currentRole ? translateRoleName(t, currentRole) : t('adminUsers.unassigned')}
                        badgeVariant="outline"
                        options={roles.map((r) => ({ value: r.id, label: translateRoleName(t, r) }))}
                        onConfirm={(to): Promise<void> => handleAssignRole(u.id, to)}
                        errorMessage={(err): ReactNode => describeApiError(err, t('adminUsers.error.update'))}
                      />
                    </TableCell>
                    <TableCell>{t(`adminUsers.status.${u.status}`)}</TableCell>
                    <TableCell>{u.twoFactorEnabled ? t('adminUsers.twoFactorOn') : '—'}</TableCell>
                    <TableCell>{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell className="text-right">
                      <RowActionMenu label={t('adminUsers.rowActions', { email: u.email })}>
                        <RowActionMenuItem onSelect={(): void => setResetFor(u)}>
                          {t('adminUsers.resetPassword.action')}
                        </RowActionMenuItem>
                        <RowActionMenuItem onSelect={(): void => void handleToggleStatus(u)}>
                          {u.status === 'active' ? t('adminUsers.deactivate') : t('adminUsers.reactivate')}
                        </RowActionMenuItem>
                        <RowActionMenuSeparator />
                        <RowActionMenuItem destructive onSelect={(): void => void handleRemove(u)}>
                          {t('adminUsers.remove')}
                        </RowActionMenuItem>
                      </RowActionMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </ListPage>
      {creating ? (
        <CreateUserDialog roles={roles} onClose={(): void => setCreating(false)} onSubmit={handleCreate} />
      ) : null}
      {resetFor ? (
        <ResetPasswordDialog
          user={resetFor}
          onClose={(): void => setResetFor(null)}
          onSubmit={(password): Promise<void> => handleResetPassword(resetFor, password)}
        />
      ) : null}
      {confirmDialog}
    </>
  );
}

/**
 * Peer password reset (issue #252), in a dialog since issue #1501 — it was a
 * form expanded under the row, from before the kit had a dialog. The hint is
 * not decoration: resetting ends every session the target holds, and an
 * operator who resets their own account here is signed out by it.
 */
function ResetPasswordDialog({
  user,
  onClose,
  onSubmit,
}: {
  user: AdminUser;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const formId = useId();
  const hintId = `${formId}-hint`;
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(password);
    } catch (err) {
      setError(describeApiError(err, t('adminUsers.error.resetPassword')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('adminUsers.resetPassword.title', { email: user.email })}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      aria-describedby={hintId}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('adminUsers.resetPassword.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {t('adminUsers.resetPassword.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-3" onSubmit={(e): void => void submit(e)}>
        <p id={hintId} className="text-sm text-muted-foreground">
          {t('adminUsers.resetPassword.hint')}
        </p>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="space-y-1">
          <Label htmlFor={`${formId}-password`}>{t('adminUsers.field.password')}</Label>
          <Input
            id={`${formId}-password`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e): void => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </div>
      </form>
    </ModalDialog>
  );
}

/**
 * The create form — the five fields the inline card held, in a dialog. A
 * refused create keeps it open with the server's message and the typed values.
 */
function CreateUserDialog({
  roles,
  onClose,
  onSubmit,
}: {
  roles: AdminRole[];
  onClose: () => void;
  onSubmit: (input: CreateUserInput) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const formId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [adminRoleId, setAdminRoleId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim(), adminRoleId });
    } catch (err) {
      setError(describeApiError(err, t('adminUsers.error.create')));
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      title={t('adminUsers.create.title')}
      onClose={onClose}
      busy={busy}
      dismissOnScrim={false}
      widthClassName="max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={busy} aria-busy={busy}>
            {t('adminUsers.create.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} className="space-y-4" onSubmit={(e): void => void submit(e)}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={`${formId}-email`}>{t('adminUsers.column.email')}</Label>
            <Input
              id={`${formId}-email`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e): void => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-password`}>{t('adminUsers.field.password')}</Label>
            <Input
              id={`${formId}-password`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e): void => setPassword(e.target.value)}
              minLength={12}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-first`}>{t('adminUsers.field.firstName')}</Label>
            <Input
              id={`${formId}-first`}
              value={firstName}
              onChange={(e): void => setFirstName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`${formId}-last`}>{t('adminUsers.field.lastName')}</Label>
            <Input
              id={`${formId}-last`}
              value={lastName}
              onChange={(e): void => setLastName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor={`${formId}-role`}>{t('adminUsers.column.role')}</Label>
            <Select
              id={`${formId}-role`}
              value={adminRoleId}
              onChange={(e): void => setAdminRoleId(e.target.value)}
              required
            >
              <option value="" disabled>
                {t('adminUsers.chooseRole')}
              </option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {translateRoleName(t, r)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </form>
    </ModalDialog>
  );
}

function translateRoleName(t: Translate, role: AdminRole): string {
  const key = `adminRoles.seeded.${role.code}`;
  const label = t(key);
  return label === `core.${key}` ? role.name : label;
}
