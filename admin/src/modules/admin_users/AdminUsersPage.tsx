import { Fragment, useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

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
  const t = useTranslation('core');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Which row has its reset form open, and the last reset that succeeded.
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
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
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('adminUsers.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

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
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminUsers.error.create'));
      }
    },
    [refresh, t],
  );

  const handleAssignRole = useCallback(
    async (userId: string, roleId: string): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${userId}`, {
          adminRoleId: roleId === '' ? null : roleId,
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminUsers.error.update'));
      }
    },
    [refresh, t],
  );

  const handleToggleStatus = useCallback(
    async (user: AdminUser): Promise<void> => {
      try {
        await apiClient.patch<{ data: AdminUser }>(`/api/v1/admin/admin-users/${user.id}`, {
          status: user.status === 'active' ? 'inactive' : 'active',
        });
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminUsers.error.update'));
      }
    },
    [refresh, t],
  );

  const handleResetPassword = useCallback(
    async (user: AdminUser, password: string): Promise<void> => {
      setError(null);
      setResetDone(null);
      try {
        await apiClient.post<{ data: AdminUser }>(
          `/api/v1/admin/admin-users/${user.id}/password`,
          { password },
        );
        setResetFor(null);
        setResetDone(user.email);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.envelope.error.message
            : t('adminUsers.error.resetPassword'),
        );
      }
    },
    [t],
  );

  const handleRemove = useCallback(
    async (user: AdminUser): Promise<void> => {
      if (!confirm(t('adminUsers.confirmRemove', { email: user.email }))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/admin-users/${user.id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('adminUsers.error.remove'));
      }
    },
    [refresh, t],
  );

  return (
    <>
      <PageHeader
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
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {resetDone ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>
            {t('adminUsers.resetPassword.done', { email: resetDone })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('adminUsers.create.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateUserForm roles={roles} onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('adminUsers.loading')}</p>
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
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  // Anchor target for deep-links (e.g. the audit-log actor column).
                  <Fragment key={u.id}>
                    <TableRow id={`admin-user-${u.id}`} className="scroll-mt-24">
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell>
                        {u.firstName} {u.lastName}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={u.adminRoleId ?? ''}
                          onChange={(e): void => void handleAssignRole(u.id, e.target.value)}
                        >
                          <option value="">{t('adminUsers.unassigned')}</option>
                          {roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {translateRoleName(t, r)}
                            </option>
                          ))}
                        </Select>
                      </TableCell>
                      <TableCell>{t(`adminUsers.status.${u.status}`)}</TableCell>
                      <TableCell>{u.twoFactorEnabled ? t('adminUsers.twoFactorOn') : '—'}</TableCell>
                      <TableCell>{formatDateTime(u.lastLoginAt)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(): void =>
                              setResetFor((current) => (current === u.id ? null : u.id))
                            }
                            aria-expanded={resetFor === u.id}
                            aria-controls={`admin-user-reset-${u.id}`}
                          >
                            <KeyRound />
                            {t('adminUsers.resetPassword.action')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(): void => void handleToggleStatus(u)}
                          >
                            {u.status === 'active' ? t('adminUsers.deactivate') : t('adminUsers.reactivate')}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(): void => void handleRemove(u)}
                          >
                            <Trash2 />
                            {t('adminUsers.remove')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {resetFor === u.id ? (
                      <TableRow>
                        <TableCell colSpan={7} id={`admin-user-reset-${u.id}`}>
                          <ResetPasswordForm
                            user={u}
                            onCancel={(): void => setResetFor(null)}
                            onSubmit={(password): Promise<void> =>
                              handleResetPassword(u, password)
                            }
                          />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Peer password reset (issue #252). Inline rather than in a modal: the admin
 * design system has no dialog primitive, and Principle IX says reuse before
 * adding one. The hint is not decoration — resetting ends every session the
 * target holds, and an operator who resets their own account here is signed
 * out by it.
 */
function ResetPasswordForm({
  user,
  onCancel,
  onSubmit,
}: {
  user: AdminUser;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [password, setPassword] = useState('');

  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit(password).then(() => setPassword(''));
      }}
    >
      <p className="text-sm font-medium">
        {t('adminUsers.resetPassword.title', { email: user.email })}
      </p>
      <p className="text-sm text-muted-foreground">{t('adminUsers.resetPassword.hint')}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor={`reset-${user.id}`}>{t('adminUsers.field.password')}</Label>
          <Input
            id={`reset-${user.id}`}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e): void => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </div>
        <Button type="submit" size="sm">
          {t('adminUsers.resetPassword.submit')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          {t('adminUsers.resetPassword.cancel')}
        </Button>
      </div>
    </form>
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
  const t = useTranslation('core');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [adminRoleId, setAdminRoleId] = useState<string>('');

  return (
    <form
      className="space-y-4"
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
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="ne">{t('adminUsers.column.email')}</Label>
          <Input
            id="ne"
            type="email"
            value={email}
            onChange={(e): void => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np">{t('adminUsers.field.password')}</Label>
          <Input
            id="np"
            type="password"
            value={password}
            onChange={(e): void => setPassword(e.target.value)}
            minLength={12}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nf">{t('adminUsers.field.firstName')}</Label>
          <Input
            id="nf"
            value={firstName}
            onChange={(e): void => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nl">{t('adminUsers.field.lastName')}</Label>
          <Input
            id="nl"
            value={lastName}
            onChange={(e): void => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="nr">{t('adminUsers.column.role')}</Label>
          <Select
            id="nr"
            value={adminRoleId}
            onChange={(e): void => setAdminRoleId(e.target.value)}
          >
            <option value="">{t('adminUsers.assignLater')}</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {translateRoleName(t, r)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Button type="submit">{t('adminUsers.create.title')}</Button>
    </form>
  );
}

function translateRoleName(
  t: (key: string, params?: Record<string, string | number>) => string,
  role: AdminRole,
): string {
  const key = `adminRoles.seeded.${role.code}`;
  const label = t(key);
  return label === `core.${key}` ? role.name : label;
}
