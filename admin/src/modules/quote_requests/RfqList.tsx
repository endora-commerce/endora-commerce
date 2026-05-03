import { useCallback, useEffect, useState, type ReactNode } from 'react';
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

/**
 * Admin Quote Requests list (feature 008 / T042). Surfaces every RFQ
 * the caller is authorized to see (assignment-scoped server-side) and
 * deep-links to the detail view for approve / cancel / modify actions.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

type AssignmentScope = 'mine' | 'unassigned' | 'all';

interface AdminRfqRow {
  id: string;
  organizationId: string;
  organizationName?: string;
  customerAccountId: string;
  customerDisplayName?: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  lineCount: number;
  totalAtCustomerPrice: number | null;
  totalAtAgreedPrice: number | null;
  currency: string;
  submittedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
  version: number;
}

interface AdminRfqListResponse {
  data: AdminRfqRow[];
}

const STATUS_VARIANT: Record<
  RfqStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  'Created from admin': 'warning',
  Pending: 'warning',
  Approved: 'success',
  Completed: 'default',
  Canceled: 'destructive',
  Expired: 'secondary',
};

export function RfqList(): ReactNode {
  const [rows, setRows] = useState<AdminRfqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | RfqStatus>('all');
  const [scope, setScope] = useState<AssignmentScope>('mine');
  const [organizationId, setOrganizationId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (scope) params.set('assignmentScope', scope);
      if (organizationId) params.set('organizationId', organizationId);
      const path =
        '/api/v1/admin/quote-requests' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<AdminRfqListResponse>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, scope, organizationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="b2b-page b2b-page--wide">
      <PageHeader title="Quote Requests" description="Customer enquiries waiting on a response." />

      <Card>
        <CardContent className="b2b-stack" style={{ gap: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 180px 1fr auto',
              gap: 12,
              alignItems: 'end',
            }}
          >
            <div>
              <Label htmlFor="rfq-scope">Visibility</Label>
              <Select
                id="rfq-scope"
                value={scope}
                onChange={(e): void => setScope(e.target.value as AssignmentScope)}
              >
                <option value="mine">My organizations</option>
                <option value="unassigned">Unassigned organizations</option>
                <option value="all">All (platform admin)</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rfq-status">Status</Label>
              <Select
                id="rfq-status"
                value={statusFilter}
                onChange={(e): void => setStatusFilter(e.target.value as 'all' | RfqStatus)}
              >
                <option value="all">All</option>
                <option value="Pending">Pending</option>
                <option value="Created from admin">Created from admin</option>
                <option value="Approved">Approved</option>
                <option value="Completed">Completed</option>
                <option value="Canceled">Canceled</option>
                <option value="Expired">Expired</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="rfq-org">Organization id (optional)</Label>
              <Input
                id="rfq-org"
                value={organizationId}
                onChange={(e): void => setOrganizationId(e.target.value)}
                placeholder="UUID"
              />
            </div>
            <Button variant="default" onClick={(): void => void refresh()} disabled={loading}>
              Refresh
            </Button>
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>RFQ</TableHead>
                <TableHead>Organization</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Lines</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead style={{ width: 80 }}></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={8} style={{ textAlign: 'center', color: 'var(--b2b-muted)' }}>
                    No Quote Requests match the current filter.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <code>{r.id.slice(0, 8)}</code>
                  </TableCell>
                  <TableCell>{r.organizationName ?? r.organizationId.slice(0, 8)}</TableCell>
                  <TableCell>{r.customerDisplayName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge>
                    {r.awaitingCustomerRevisionAcceptance ? (
                      <Badge variant="warning" style={{ marginLeft: 4 }}>
                        Awaiting customer
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.lineCount}</TableCell>
                  <TableCell>
                    {formatTotal(r)}
                  </TableCell>
                  <TableCell>{formatDateTime(r.updatedAt)}</TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link to={`/quote-requests/${r.id}`}>
                        Open <ArrowRight size={14} style={{ marginLeft: 4 }} />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function formatTotal(r: AdminRfqRow): string {
  const total = r.totalAtAgreedPrice ?? r.totalAtCustomerPrice;
  if (total === null) return '—';
  return `${total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${r.currency}`;
}
