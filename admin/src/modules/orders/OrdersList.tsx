import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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

interface AdminOrderRow {
  id: string;
  status: string;
  paymentStatus: string;
  organizationId: string;
  total: number;
  currency: string;
  placedAt: string;
}

const STATUSES = ['new', 'confirmed', 'in_fulfilment', 'shipped', 'completed', 'cancelled'] as const;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  new: 'warning',
  confirmed: 'default',
  in_fulfilment: 'default',
  shipped: 'default',
  completed: 'success',
  cancelled: 'destructive',
};

export function OrdersList(): ReactNode {
  const [rows, setRows] = useState<AdminOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | (typeof STATUSES)[number]>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminOrderRow[] }>('/api/v1/admin/orders');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;

  return (
    <>
      <PageHeader title="Orders" description="All orders across organizations." />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="space-y-2 md:max-w-xs">
            <Label htmlFor="ostatus">Status</Label>
            <Select
              id="ostatus"
              value={statusFilter}
              onChange={(e): void => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="">All</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Placed</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Payment</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>{formatDateTime(o.placedAt)}</TableCell>
                    <TableCell>
                      <Link
                        to={`/orders/${o.id}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {o.id.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {o.organizationId.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[o.status] ?? 'secondary'}>{o.status}</Badge>
                    </TableCell>
                    <TableCell>{o.paymentStatus}</TableCell>
                    <TableCell className="tabular-nums">
                      {o.total.toFixed(2)} {o.currency}
                    </TableCell>
                    <TableCell>
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/orders/${o.id}`}>
                          Open
                          <ArrowRight />
                        </Link>
                      </Button>
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
