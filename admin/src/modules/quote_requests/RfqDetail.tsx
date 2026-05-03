import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, XCircle } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Admin Quote Request detail (feature 008 / T043). Renders status,
 * line items, change history, and exposes Approve / Cancel actions
 * for Pending and Created from admin RFQs. The modify pane (US3) is
 * accessible through the same approve/cancel scaffold once added.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

interface AdminRfqItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  variantLabel: string | null;
  quantity: number;
  desiredUnitPrice: number | null;
  agreedUnitPrice: number | null;
  lineNote: string | null;
  lineCurrency: string;
  discountPercent: number | null;
}

interface AdminRfqEvent {
  id: string;
  eventType: string;
  actorAdminUserId: string | null;
  actorCustomerAccountId: string | null;
  actorRoleLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface AdminRfqDetail {
  id: string;
  organizationId: string;
  customerAccountId: string;
  createdByAdminUserId: string | null;
  assignedAdminUserId: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  currentRevisionNumber: number;
  headerNote: string | null;
  cancellationReason: string | null;
  items: AdminRfqItem[];
  events: AdminRfqEvent[];
  submittedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  expiredAt: string | null;
  expiresAt: string | null;
  convertedOrderId: string | null;
  updatedAt: string;
  version: number;
}

const TERMINAL: RfqStatus[] = ['Approved', 'Completed', 'Canceled', 'Expired'];

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

export function RfqDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const [rfq, setRfq] = useState<AdminRfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${id}`,
      );
      setRfq(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const approve = async (): Promise<void> => {
    if (!rfq) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/approve`,
        {},
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo('Quote Request approved.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Approve failed.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!rfq) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const body = cancelReason.trim().length > 0 ? { reason: cancelReason.trim() } : {};
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/cancel`,
        body,
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo('Quote Request canceled.');
      setCancelReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Cancel failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="b2b-page b2b-page--wide">
        <p style={{ padding: 32, color: 'var(--b2b-muted)' }}>Loading…</p>
      </div>
    );

  if (!rfq)
    return (
      <div className="b2b-page b2b-page--wide">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Quote Request not found.'}</AlertDescription>
        </Alert>
      </div>
    );

  const isTerminal = TERMINAL.includes(rfq.status);
  const total = rfq.items.every((it) => it.agreedUnitPrice !== null)
    ? rfq.items.reduce((s, it) => s + (it.agreedUnitPrice ?? 0) * it.quantity, 0)
    : null;

  return (
    <div className="b2b-page b2b-page--wide">
      <Button asChild variant="ghost" size="sm" style={{ marginBottom: 8 }}>
        <Link to="/quote-requests">
          <ArrowLeft size={14} style={{ marginRight: 4 }} /> Back to list
        </Link>
      </Button>

      <PageHeader
        title={`Quote Request ${rfq.id.slice(0, 8)}`}
        description={`Organization ${rfq.organizationId.slice(0, 8)} · Customer ${rfq.customerAccountId.slice(0, 8)}`}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge variant={STATUS_VARIANT[rfq.status]}>{rfq.status}</Badge>
        {rfq.awaitingCustomerRevisionAcceptance ? (
          <Badge variant="warning">Awaiting customer acceptance of revision</Badge>
        ) : null}
        {rfq.cancellationReason ? (
          <Badge variant="destructive">Cancel reason: {rfq.cancellationReason}</Badge>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive" style={{ marginBottom: 16 }}>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="default" style={{ marginBottom: 16 }}>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}

      {rfq.headerNote ? (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader>
            <CardTitle>Header note</CardTitle>
          </CardHeader>
          <CardContent>{rfq.headerNote}</CardContent>
        </Card>
      ) : null}

      <Card style={{ marginBottom: 16 }}>
        <CardHeader>
          <CardTitle>Line items ({rfq.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Desired</TableHead>
                <TableHead>Agreed</TableHead>
                <TableHead>Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.items.map((it) => {
                const lineTotal =
                  it.agreedUnitPrice !== null
                    ? it.agreedUnitPrice * it.quantity
                    : it.desiredUnitPrice !== null
                      ? it.desiredUnitPrice * it.quantity
                      : null;
                return (
                  <TableRow key={it.id}>
                    <TableCell>
                      <strong>{it.productName}</strong>
                      {it.variantLabel ? <small> ({it.variantLabel})</small> : null}
                      {it.lineNote ? <div style={{ fontSize: 11, color: 'var(--b2b-muted)' }}>{it.lineNote}</div> : null}
                    </TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell>{it.desiredUnitPrice !== null ? it.desiredUnitPrice.toFixed(2) : '—'}</TableCell>
                    <TableCell>{it.agreedUnitPrice !== null ? it.agreedUnitPrice.toFixed(2) : '—'}</TableCell>
                    <TableCell>
                      {lineTotal !== null
                        ? `${lineTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${it.lineCurrency}`
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
              {total !== null ? (
                <TableRow>
                  <TableCell colSpan={4} style={{ textAlign: 'right', fontWeight: 600 }}>
                    Total
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
                    {rfq.items[0]?.lineCurrency}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isTerminal ? (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rfq.status === 'Pending' ? (
              <Button onClick={(): void => void approve()} disabled={busy}>
                <Check size={14} style={{ marginRight: 4 }} /> Approve
              </Button>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Label htmlFor="cancel-reason">Cancellation reason (optional)</Label>
                <Textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e): void => setCancelReason(e.target.value)}
                  placeholder="What should we tell the customer?"
                  rows={2}
                />
              </div>
              <Button variant="destructive" onClick={(): void => void cancel()} disabled={busy}>
                <XCircle size={14} style={{ marginRight: 4 }} /> Cancel RFQ
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Change history</CardTitle>
        </CardHeader>
        <CardContent>
          {rfq.events.length === 0 ? (
            <p style={{ color: 'var(--b2b-muted)' }}>No events.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {rfq.events.map((e) => (
                <li
                  key={e.id}
                  style={{ padding: '8px 0', borderBottom: '1px dashed var(--b2b-border, #e5e7eb)' }}
                >
                  <div style={{ fontSize: 11, color: 'var(--b2b-muted)' }}>
                    {formatDateTime(e.createdAt)}
                    {e.actorRoleLabel ? ` · ${e.actorRoleLabel}` : null}
                  </div>
                  <div style={{ fontWeight: 500 }}>{e.eventType}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
