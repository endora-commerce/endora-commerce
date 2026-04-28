import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FileDown } from 'lucide-react';
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

interface AdminInvoice {
  id: string;
  orderId: string;
  kind: 'proforma' | 'invoice' | 'correction';
  number: string;
  issuedAt: string;
  currency: string;
  total: number;
  status: 'pending' | 'ready' | 'cancelled';
  pdfReady: boolean;
}

const STATUSES = ['pending', 'ready', 'cancelled'] as const;

const STATUS_VARIANT: Record<AdminInvoice['status'], 'default' | 'secondary' | 'success' | 'warning' | 'destructive'> = {
  pending: 'warning',
  ready: 'success',
  cancelled: 'destructive',
};

export function InvoicesList(): ReactNode {
  const [rows, setRows] = useState<AdminInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'' | (typeof STATUSES)[number]>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status) params.set('filter[status]', status);
      const path =
        '/api/v1/admin/invoices' + (params.toString() ? `?${params.toString()}` : '');
      const res = await apiClient.get<{ data: AdminInvoice[] }>(path);
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const baseUrl = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '';

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Read-only. Generation is driven by order events; PDF re-download is per-order."
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6">
          <div className="space-y-2 md:max-w-xs">
            <Label htmlFor="istatus">Status</Label>
            <Select
              id="istatus"
              value={status}
              onChange={(e): void => setStatus(e.target.value as typeof status)}
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
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invoices match the current filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell className="font-medium">{i.number}</TableCell>
                    <TableCell>{i.kind}</TableCell>
                    <TableCell>{formatDateTime(i.issuedAt)}</TableCell>
                    <TableCell>
                      <Link
                        to={`/orders/${i.orderId}`}
                        className="font-mono text-xs underline underline-offset-2"
                      >
                        {i.orderId.slice(0, 8)}
                      </Link>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {i.total.toFixed(2)} {i.currency}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[i.status]}>{i.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {i.pdfReady ? (
                        <Button asChild variant="outline" size="sm">
                          <a
                            href={`${baseUrl}/api/v1/orders/${i.orderId}/invoice`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FileDown />
                            PDF
                          </a>
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">not ready</span>
                      )}
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
