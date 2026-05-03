import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Organization → Sales reps assignment tab (feature 008 / T079).
 *
 * Lists every admin user currently assigned to the organization plus
 * an "Assign" form. Removal is a single delete. Used inline on the
 * Organization detail page; mount with
 *   <OrganizationSalesRepsTab organizationId={org.id} />.
 */

interface SalesRepRow {
  id: string;
  organizationId: string;
  adminUserId: string;
  displayName: string;
  email: string;
  assignedAt: string;
  assignedByAdminUserId: string | null;
}

export function OrganizationSalesRepsTab({
  organizationId,
}: {
  organizationId: string;
}): ReactNode {
  const [rows, setRows] = useState<SalesRepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [adminUserId, setAdminUserId] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: SalesRepRow[] }>(
        `/api/v1/admin/organizations/${organizationId}/sales-reps`,
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assign = async (): Promise<void> => {
    if (adminUserId.trim().length === 0) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.post(
        `/api/v1/admin/organizations/${organizationId}/sales-reps`,
        { adminUserId: adminUserId.trim() },
      );
      setInfo('Sales rep assigned.');
      setAdminUserId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Assign failed.');
    } finally {
      setBusy(false);
    }
  };

  const unassign = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.delete(
        `/api/v1/admin/organizations/${organizationId}/sales-reps/${id}`,
      );
      setInfo('Sales rep unassigned.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Unassign failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales representatives</CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {info ? (
          <Alert>
            <AlertDescription>{info}</AlertDescription>
          </Alert>
        ) : null}
        {rows.length === 0 && !loading ? (
          <p style={{ color: 'var(--b2b-muted)', fontSize: 13 }}>
            No sales reps assigned. Quote Requests from this organization are visible to every
            sales rep (unassigned-org fallback).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Assigned at</TableHead>
                <TableHead style={{ width: 60 }}></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.displayName}</TableCell>
                  <TableCell>{r.email}</TableCell>
                  <TableCell>{new Date(r.assignedAt).toLocaleDateString('pl-PL')}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(): void => void unassign(r.adminUserId)}
                      disabled={busy}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Label htmlFor="rep-id">Assign new sales rep (admin user UUID)</Label>
            <Input
              id="rep-id"
              value={adminUserId}
              onChange={(e): void => setAdminUserId(e.target.value)}
              placeholder="00000000-…"
            />
          </div>
          <Button onClick={(): void => void assign()} disabled={busy}>
            <UserPlus size={14} style={{ marginRight: 4 }} /> Assign
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
