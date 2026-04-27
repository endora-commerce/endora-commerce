import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

const STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'quoted',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;

type RfqStatus = (typeof STATUSES)[number];

interface AdminRfqRow {
  id: string;
  organizationId: string;
  customerAccountId: string;
  assignedAdminUserId?: string;
  status: RfqStatus;
  items: Array<{ id: string; productName: string; quantity: number }>;
  submittedAt: string | null;
  quotedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

interface AdminRfqListResponse {
  data: AdminRfqRow[];
}

const OPEN_STATUSES: RfqStatus[] = ['submitted', 'in_review'];

const STATUS_VARIANT: Record<RfqStatus, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  draft: 'secondary',
  submitted: 'warning',
  in_review: 'warning',
  quoted: 'default',
  accepted: 'success',
  rejected: 'destructive',
  expired: 'secondary',
  cancelled: 'secondary',
};

export function RfqList(): ReactNode {
  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | RfqStatus | 'all'>('open');
  const [organizationId, setOrganizationId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all' && statusFilter !== 'open') {
        params.set('filter[status]', statusFilter);
      }
      if (organizationId) params.set('filter[organizationId]', organizationId);
      const path =
        '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<AdminRfqListResponse>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load RFQs.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClaim = useCallback(
    async (id: string): Promise<void> => {
      try {
        await apiClient.post<{ data: AdminRfqRow }>(
          `/api/v1/admin/quote-requests/${id}/claim`,
          {},
        );
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Claim failed.');
      }
    },
    [refresh],
  );

  const visible = useMemo(() => {
    if (statusFilter === 'open') return rows.filter((r) => OPEN_STATUSES.includes(r.status));
    return rows;
  }, [rows, statusFilter]);

  return (
    <>
      <PageHeader
        title="Quote requests"
        description="Triage incoming RFQs, claim them, send a quote, or decline."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rfq-status">Status</Label>
            <Select
              id="rfq-status"
              value={statusFilter}
              onChange={(e): void => setStatusFilter(e.target.value as 'open' | RfqStatus | 'all')}
            >
              <option value="open">Open (submitted + in_review)</option>
              <option value="all">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rfq-org">Organization ID (optional)</Label>
            <Input
              id="rfq-org"
              placeholder="UUID"
              value={organizationId}
              onChange={(e): void => setOrganizationId(e.target.value.trim())}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No RFQs match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>RFQ</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        to={`/quote-requests/${r.id}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {r.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                    </TableCell>
                    <TableCell>{r.items.length}</TableCell>
                    <TableCell>{formatDateTime(r.submittedAt)}</TableCell>
                    <TableCell>{formatDateTime(r.expiresAt)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.assignedAdminUserId ? r.assignedAdminUserId.slice(0, 8) : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {OPEN_STATUSES.includes(r.status) && !r.assignedAdminUserId ? (
                          <Button
                            type="button"
                            size="sm"
                            onClick={(): void => void handleClaim(r.id)}
                          >
                            Claim
                          </Button>
                        ) : null}
                        <Button asChild variant="outline" size="sm">
                          <Link to={`/quote-requests/${r.id}`}>
                            Open
                            <ArrowRight />
                          </Link>
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
