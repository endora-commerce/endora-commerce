import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
import { EntityChannelMembership } from '../sales_channels/components/EntityChannelMembership';

interface OrgMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt?: string | null;
  updatedAt?: string;
}

interface OrgDetail {
  id: string;
  name: string;
  taxId: string;
  status: 'pending_verification' | 'active' | 'suspended';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  members: OrgMember[];
  updatedAt?: string;
}

const STATUSES = ['pending_verification', 'active', 'suspended'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;
const ROLES = ['organization_admin', 'regular_user'] as const;

export function OrganizationDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<(typeof ROLES)[number]>('regular_user');
  const [directEmail, setDirectEmail] = useState('');
  const [directFirst, setDirectFirst] = useState('');
  const [directLast, setDirectLast] = useState('');
  const [directPassword, setDirectPassword] = useState('');
  const [directRole, setDirectRole] = useState<(typeof ROLES)[number]>('regular_user');

  const [editMember, setEditMember] = useState<OrgMember | null>(null);
  const [editFirst, setEditFirst] = useState('');
  const [editLast, setEditLast] = useState('');
  const [editEmail, setEditEmail] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`);
      setOrg(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setOrg(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (editMember) {
      setEditFirst(editMember.firstName);
      setEditLast(editMember.lastName);
      setEditEmail(editMember.email);
    }
  }, [editMember]);

  const handlePatch = useCallback(
    async (patch: {
      status?: string;
      vatStatus?: string;
      name?: string;
      expectedUpdatedAt?: string;
    }): Promise<void> => {
      if (!org?.updatedAt) return;
      try {
        await apiClient.patch<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`, {
          ...patch,
          expectedUpdatedAt: patch.expectedUpdatedAt ?? org.updatedAt,
        });
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          setError('Organization was modified elsewhere. Refreshing…');
          await refresh();
          setError(null);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
        }
      }
    },
    [id, org, refresh],
  );

  const inviteMember = useCallback(async (): Promise<void> => {
    if (!inviteEmail.trim()) return;
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members/invite`, {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      setInfo('Invitation sent.');
      setInviteEmail('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Invite failed.');
    }
  }, [id, inviteEmail, inviteRole, refresh]);

  const directAdd = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/organizations/${id}/members`, {
        email: directEmail.trim(),
        firstName: directFirst.trim(),
        lastName: directLast.trim(),
        password: directPassword,
        role: directRole,
      });
      setInfo('Member created.');
      setDirectEmail('');
      setDirectFirst('');
      setDirectLast('');
      setDirectPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Create failed.');
    }
  }, [id, directEmail, directFirst, directLast, directPassword, directRole, refresh]);

  const changeMemberRole = useCallback(
    async (memberId: string, role: string, expectedUpdatedAt?: string): Promise<void> => {
      setError(null);
      try {
        await apiClient.patch(`/api/v1/admin/organizations/${id}/members/${memberId}/role`, {
          role,
          ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
        });
        setInfo('Member updated.');
        await refresh();
      } catch (err) {
        if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
          setError('Member was modified concurrently. Refreshing…');
          await refresh();
          setError(null);
        } else {
          setError(err instanceof ApiError ? err.envelope.error.message : 'Role update failed.');
        }
      }
    },
    [id, refresh],
  );

  const saveMemberProfile = useCallback(async (): Promise<void> => {
    if (!editMember?.updatedAt) return;
    setError(null);
    try {
      await apiClient.patch(`/api/v1/admin/organizations/${id}/members/${editMember.id}`, {
        firstName: editFirst.trim(),
        lastName: editLast.trim(),
        email: editEmail.trim(),
        expectedUpdatedAt: editMember.updatedAt,
      });
      setInfo('Member profile saved.');
      setEditMember(null);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'VERSION_CONFLICT') {
        setError('Member was modified concurrently. Refreshing…');
        await refresh();
        setError(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
      }
    }
  }, [editMember, editFirst, editLast, editEmail, id, refresh]);

  const removeMember = useCallback(
    async (memberId: string): Promise<void> => {
      setError(null);
      try {
        await apiClient.delete(`/api/v1/admin/organizations/${id}/members/${memberId}`);
        setInfo('Member removed.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Remove failed.');
      }
    },
    [id, refresh],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!org)
    return (
      <Alert variant="warning">
        <AlertDescription>Organization not found.</AlertDescription>
      </Alert>
    );

  const adminCount = org.members.filter((m) => m.role === 'organization_admin').length;

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span>
            Tax ID <code className="font-mono text-xs">{org.taxId}</code>
            {org.updatedAt ? (
              <>
                {' '}
                · Updated{' '}
                <time dateTime={org.updatedAt}>{formatDateTime(org.updatedAt)}</time>
              </>
            ) : null}
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/organizations">
              <ArrowLeft />
              Back
            </Link>
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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ostatus">Account status</Label>
            <Select
              id="ostatus"
              value={org.status}
              onChange={(e): void =>
                void handlePatch({ status: e.target.value, expectedUpdatedAt: org.updatedAt })
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="vstatus">VAT status</Label>
            <Select
              id="vstatus"
              value={org.vatStatus}
              onChange={(e): void =>
                void handlePatch({ vatStatus: e.target.value, expectedUpdatedAt: org.updatedAt })
              }
            >
              {VAT_STATUSES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Registered address</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            {org.registeredAddress.street}
            <br />
            {org.registeredAddress.postalCode} {org.registeredAddress.city}
            <br />
            {org.registeredAddress.country}
          </p>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Invite member</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-64"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <Button type="button" onClick={() => void inviteMember()}>
            Send invite
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Direct add member</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="d-email">Email</Label>
            <Input
              id="d-email"
              type="email"
              value={directEmail}
              onChange={(e) => setDirectEmail(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-pw">Temporary password (≥12)</Label>
            <Input
              id="d-pw"
              type="password"
              value={directPassword}
              onChange={(e) => setDirectPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-fn">First name</Label>
            <Input id="d-fn" value={directFirst} onChange={(e) => setDirectFirst(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="d-ln">Last name</Label>
            <Input id="d-ln" value={directLast} onChange={(e) => setDirectLast(e.target.value)} />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="d-role">Role</Label>
            <Select
              id="d-role"
              value={directRole}
              onChange={(e) => setDirectRole(e.target.value as (typeof ROLES)[number])}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </div>
          <div className="md:col-span-2">
            <Button type="button" onClick={() => void directAdd()}>
              Create member
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          {editMember ? (
            <div className="mb-6 rounded-lg border border-border p-4">
              <h3 className="mb-3 text-sm font-medium">Edit member</h3>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-fn">First name</Label>
                  <Input
                    id="edit-fn"
                    value={editFirst}
                    onChange={(e) => setEditFirst(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-ln">Last name</Label>
                  <Input
                    id="edit-ln"
                    value={editLast}
                    onChange={(e) => setEditLast(e.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void saveMemberProfile()}>
                  Save
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditMember(null)}>
                  Cancel
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Changing email clears verified status until the user verifies again.
              </p>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead>2FA</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell>
                    {m.firstName} {m.lastName}
                  </TableCell>
                  <TableCell>
                    <Select
                      aria-label={`Role for ${m.email}`}
                      value={m.role}
                      onChange={(e): void =>
                        void changeMemberRole(
                          m.id,
                          e.target.value,
                          m.updatedAt ?? undefined,
                        )
                      }
                      className="max-w-[14rem]"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  </TableCell>
                  <TableCell>
                    {m.emailVerifiedAt ? formatDateTime(m.emailVerifiedAt) : '—'}
                  </TableCell>
                  <TableCell>
                    {m.lastLoginAt ? formatDateTime(m.lastLoginAt) : '—'}
                  </TableCell>
                  <TableCell>{m.twoFactorEnabled ? 'on' : '—'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditMember(m)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={
                        m.role === 'organization_admin' && adminCount <= 1
                      }
                      onClick={() => void removeMember(m.id)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EntityChannelMembership entityType="organization" entityId={id || null} />
    </>
  );
}
