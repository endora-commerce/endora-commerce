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
import { ProductPicker } from '@/modules/catalog/components/ProductPicker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';

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
  businessId: string;
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
  const t = useTranslation('core');
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
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.load'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

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
      setInfo(t('rfq.detail.info.approved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.approve'));
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
      setInfo(t('rfq.detail.info.canceled'));
      setCancelReason('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.cancel'));
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <div className="b2b-page b2b-page--wide">
        <p style={{ padding: 32, color: 'var(--b2b-muted)' }}>{t('rfq.detail.loading')}</p>
      </div>
    );

  if (!rfq)
    return (
      <div className="b2b-page b2b-page--wide">
        <Alert variant="destructive">
          <AlertDescription>{error ?? t('rfq.detail.notFound')}</AlertDescription>
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
          <ArrowLeft size={14} style={{ marginRight: 4 }} /> {t('rfq.detail.backToList')}
        </Link>
      </Button>

      <PageHeader
        title={t('rfq.detail.title', { id: rfq.businessId })}
        description={t('rfq.detail.description', {
          orgId: rfq.organizationId.slice(0, 8),
          customerId: rfq.customerAccountId.slice(0, 8),
        })}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Badge variant={STATUS_VARIANT[rfq.status]}>{rfq.status}</Badge>
        {rfq.awaitingCustomerRevisionAcceptance ? (
          <Badge variant="warning">{t('rfq.detail.badge.awaitingRevision')}</Badge>
        ) : null}
        {rfq.cancellationReason ? (
          <Badge variant="destructive">{t('rfq.detail.badge.cancelReason', { reason: rfq.cancellationReason })}</Badge>
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
            <CardTitle>{t('rfq.detail.headerNote')}</CardTitle>
          </CardHeader>
          <CardContent>{rfq.headerNote}</CardContent>
        </Card>
      ) : null}

      <Card style={{ marginBottom: 16 }}>
        <CardHeader>
          <CardTitle>{t('rfq.detail.lineItems', { count: rfq.items.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('rfq.detail.column.product')}</TableHead>
                <TableHead>{t('rfq.detail.column.qty')}</TableHead>
                <TableHead>{t('rfq.detail.column.desired')}</TableHead>
                <TableHead>{t('rfq.detail.column.agreed')}</TableHead>
                <TableHead>{t('rfq.detail.column.lineTotal')}</TableHead>
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
                    {t('rfq.detail.totalLabel')}
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
            <CardTitle>{t('rfq.detail.actions')}</CardTitle>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {rfq.status === 'Pending' ? (
              <Button onClick={(): void => void approve()} disabled={busy}>
                <Check size={14} style={{ marginRight: 4 }} /> {t('rfq.detail.approve')}
              </Button>
            ) : null}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Label htmlFor="cancel-reason">{t('rfq.detail.cancelReason')}</Label>
                <Textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e): void => setCancelReason(e.target.value)}
                  placeholder={t('rfq.detail.cancelReasonPlaceholder')}
                  rows={2}
                />
              </div>
              <Button variant="destructive" onClick={(): void => void cancel()} disabled={busy}>
                <XCircle size={14} style={{ marginRight: 4 }} /> {t('rfq.detail.cancelRfq')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!isTerminal ? (
        <ModifyCard rfq={rfq} onSaved={refresh} setError={setError} setInfo={setInfo} />
      ) : null}

      {rfq.status === 'Approved' ? (
        <Card style={{ marginBottom: 16 }}>
          <CardHeader>
            <CardTitle>{t('rfq.detail.convert.title')}</CardTitle>
          </CardHeader>
          <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ fontSize: 13, color: 'var(--b2b-muted)', margin: 0 }}>
              {t('rfq.detail.convert.description')}
            </p>
            <div>
              <Button
                onClick={async (): Promise<void> => {
                  setBusy(true);
                  setError(null);
                  setInfo(null);
                  try {
                    const res = await apiClient.post<{ data: { cartId: string; checkoutUrl: string } }>(
                      `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
                      {},
                    );
                    setInfo(t('rfq.detail.convert.success', {
                      cartId: res.data.cartId.slice(0, 8),
                      url: res.data.checkoutUrl,
                    }));
                  } catch (err) {
                    setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.convert.error'));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy}
              >
                {t('rfq.detail.convert.placeOrder')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('rfq.detail.history.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {rfq.events.length === 0 ? (
            <p style={{ color: 'var(--b2b-muted)' }}>{t('rfq.detail.history.empty')}</p>
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

interface ModifyLineDraft {
  productId: string;
  quantity: string;
  agreedUnitPrice: string;
}

function ModifyCard({
  rfq,
  onSaved,
  setError,
  setInfo,
}: {
  rfq: AdminRfqDetail;
  onSaved: () => Promise<void>;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [headerNote, setHeaderNote] = useState(rfq.headerNote ?? '');
  const [lines, setLines] = useState<ModifyLineDraft[]>(
    rfq.items.map((it) => ({
      productId: it.productId,
      quantity: String(it.quantity),
      agreedUnitPrice: it.agreedUnitPrice !== null ? it.agreedUnitPrice.toFixed(2) : '',
    })),
  );
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const items = lines
        .filter((l) => l.productId.trim().length > 0 && Number(l.quantity) > 0)
        .map((l) => ({
          productId: l.productId.trim(),
          quantity: Number(l.quantity),
          ...(l.agreedUnitPrice.trim().length > 0
            ? { agreedUnitPrice: Number(l.agreedUnitPrice) }
            : {}),
        }));
      if (items.length === 0) {
        setError(t('rfq.detail.modify.error.atLeastOneLine'));
        setBusy(false);
        return;
      }
      await apiClient.patch(
        `/api/v1/admin/quote-requests/${rfq.id}`,
        { headerNote: headerNote.trim().length > 0 ? headerNote.trim() : null, items },
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo(t('rfq.detail.modify.info.saved'));
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.modify.error.save'));
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (idx: number, patch: Partial<ModifyLineDraft>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHeader>
        <CardTitle>{t('rfq.detail.modify.title')}</CardTitle>
      </CardHeader>
      <CardContent style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <Label htmlFor="modify-note">{t('rfq.detail.modify.headerNote')}</Label>
          <Textarea
            id="modify-note"
            value={headerNote}
            onChange={(e): void => setHeaderNote(e.target.value)}
            rows={2}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('rfq.detail.modify.productId')}</TableHead>
              <TableHead>{t('rfq.detail.modify.quantity')}</TableHead>
              <TableHead>{t('rfq.detail.modify.agreedUnitPrice')}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={i}>
                <TableCell>
                  <ProductPicker
                    mode="select"
                    value={l.productId || null}
                    onChange={(v): void => updateLine(i, { productId: v ?? '' })}
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e): void => updateLine(i, { quantity: e.target.value })}
                    style={{ width: 80, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={l.agreedUnitPrice}
                    onChange={(e): void => updateLine(i, { agreedUnitPrice: e.target.value })}
                    style={{ width: 100, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(): void => setLines((prev) => prev.filter((_, j) => j !== i))}
                  >
                    {t('rfq.detail.modify.remove')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={(): void =>
              setLines((prev) => [...prev, { productId: '', quantity: '1', agreedUnitPrice: '' }])
            }
          >
            {t('rfq.detail.modify.addLine')}
          </Button>
        </div>
        <div>
          <Button onClick={(): void => void save()} disabled={busy}>
            {t('rfq.detail.modify.saveRevision')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
