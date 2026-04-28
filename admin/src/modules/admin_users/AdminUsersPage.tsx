import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
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
      <PageHeader
        title="Users"
        description={
          <>
            Supplier employees with admin access. Manage permission bundles in{' '}
            <Link to="/admin-roles" className="underline underline-offset-2">
              Roles
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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Create user</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateUserForm roles={roles} onSubmit={handleCreate} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>2FA</TableHead>
                  <TableHead>Last login</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.email}</TableCell>
                    <TableCell>
                      {u.firstName} {u.lastName}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={u.adminRoleId ?? ''}
                        onChange={(e): void => void handleAssignRole(u.id, e.target.value)}
                      >
                        <option value="">— unassigned —</option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </Select>
                    </TableCell>
                    <TableCell>{u.status}</TableCell>
                    <TableCell>{u.twoFactorEnabled ? 'on' : '—'}</TableCell>
                    <TableCell>{formatDateTime(u.lastLoginAt)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(): void => void handleToggleStatus(u)}
                        >
                          {u.status === 'active' ? 'Deactivate' : 'Reactivate'}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={(): void => void handleRemove(u)}
                        >
                          <Trash2 />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
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
          <Label htmlFor="ne">Email</Label>
          <Input
            id="ne"
            type="email"
            value={email}
            onChange={(e): void => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="np">Password (min 12 chars)</Label>
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
          <Label htmlFor="nf">First name</Label>
          <Input
            id="nf"
            value={firstName}
            onChange={(e): void => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nl">Last name</Label>
          <Input
            id="nl"
            value={lastName}
            onChange={(e): void => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="nr">Role</Label>
          <Select
            id="nr"
            value={adminRoleId}
            onChange={(e): void => setAdminRoleId(e.target.value)}
          >
            <option value="">— assign later —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <Button type="submit">Create user</Button>
    </form>
  );
}
