import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

interface OrgMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  emailVerifiedAt: string | null;
  twoFactorEnabled: boolean;
}

interface OrgDetail {
  id: string;
  name: string;
  taxId: string;
  status: 'pending_verification' | 'active' | 'suspended';
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge';
  registeredAddress: { street: string; city: string; postalCode: string; country: string };
  members: OrgMember[];
}

const STATUSES = ['pending_verification', 'active', 'suspended'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;

export function OrganizationDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const handlePatch = useCallback(
    async (patch: { status?: string; vatStatus?: string }): Promise<void> => {
      try {
        await apiClient.patch<{ data: OrgDetail }>(`/api/v1/admin/organizations/${id}`, patch);
        setInfo('Saved.');
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Save failed.');
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

  return (
    <>
      <PageHeader
        title={org.name}
        description={
          <span>
            Tax ID <code className="font-mono text-xs">{org.taxId}</code>
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
              onChange={(e): void => void handlePatch({ status: e.target.value })}
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
              onChange={(e): void => void handlePatch({ vatStatus: e.target.value })}
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

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>2FA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.email}</TableCell>
                  <TableCell>
                    {m.firstName} {m.lastName}
                  </TableCell>
                  <TableCell>{m.role}</TableCell>
                  <TableCell>
                    {m.emailVerifiedAt ? formatDateTime(m.emailVerifiedAt) : '—'}
                  </TableCell>
                  <TableCell>{m.twoFactorEnabled ? 'on' : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
