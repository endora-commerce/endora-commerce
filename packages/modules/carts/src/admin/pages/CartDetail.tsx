import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, apiClient, formatDateTime, formatMoney } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * CartDetail (feature 027 US6).
 *
 * Read-only cart detail + audit feed + emergency Reject action. The
 * Reject button opens an inline form for the required reason; submit
 * disables until the reason is non-empty.
 *
 * Browser-verification note: needs eyes for layout + reject-form
 * interaction; the data flow is plain fetch + post.
 */

interface AdminCartLine {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  quantity: number;
  unitPrice: { amount: number; currency: string };
  lineTotal: { amount: number; currency: string };
}

interface AdminCartDetail {
  id: string;
  ownerDisplayName: string | null;
  organizationDisplayName: string | null;
  salesChannelCode: string | null;
  status: string;
  approvalStatus: string;
  items: AdminCartLine[];
  total: { amount: number; currency: string };
  discount: { code: string | null; amount: number; currency: string } | null;
  appliedPromotionCode: string | null;
  lastActivityAt: string;
  createdAt: string;
  convertedToQuoteRequestId: string | null;
  submittedForApprovalAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedByActor: string | null;
  rejectedReason: string | null;
}

interface AuditRow {
  id: string;
  occurredAt: string;
  actorType: string;
  actorDisplayName: string | null;
  action: string;
  fromState: string | null;
  toState: string | null;
  reason: string | null;
}

export default function CartDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const t = useTranslation('carts');
  const [cart, setCart] = useState<AdminCartDetail | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [detail, auditRes] = await Promise.all([
        apiClient.get<{ data: AdminCartDetail }>(`/api/v1/admin/carts/${id}`),
        apiClient.get<{ data: AuditRow[] }>(`/api/v1/admin/carts/${id}/audit`),
      ]);
      setCart(detail.data);
      setAudit(Array.isArray(auditRes.data) ? auditRes.data : []);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load cart.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReject = useCallback(async (): Promise<void> => {
    if (!id || rejectReason.trim().length === 0) return;
    setRejecting(true);
    setError(null);
    try {
      await apiClient.post(`/api/v1/admin/carts/${id}/reject`, { reason: rejectReason.trim() });
      setShowReject(false);
      setRejectReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to reject cart.');
    } finally {
      setRejecting(false);
    }
  }, [id, rejectReason, load]);

  if (loading) {
    return <p className="text-sm text-muted-foreground">{t('carts.loading')}</p>;
  }
  if (!cart) {
    return <Alert variant="destructive"><AlertDescription>{error ?? 'Cart not found.'}</AlertDescription></Alert>;
  }

  const isTerminal = cart.status === 'completed' || cart.status === 'rejected';

  return (
    <>
      <PageHeader
        title={t('carts.detail.title')}
        description={cart.id}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardContent className="pt-6 space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 text-sm">
            <div><Label>{t('carts.column.status')}</Label><Badge>{cart.status}</Badge></div>
            <div><Label>{t('carts.column.approval')}</Label><Badge>{cart.approvalStatus}</Badge></div>
            <div><Label>{t('carts.column.owner')}</Label><span>{cart.ownerDisplayName ?? '(anon)'}</span></div>
            <div><Label>{t('carts.column.org')}</Label><span>{cart.organizationDisplayName ?? '—'}</span></div>
            <div><Label>{t('carts.column.lastActivity')}</Label><span>{formatDateTime(cart.lastActivityAt)}</span></div>
            <div><Label>{t('carts.column.created')}</Label><span>{formatDateTime(cart.createdAt)}</span></div>
            {cart.appliedPromotionCode ? (
              <div><Label>{t('carts.column.coupon')}</Label><Badge variant="secondary">{cart.appliedPromotionCode}</Badge></div>
            ) : null}
            {cart.convertedToQuoteRequestId ? (
              <div><Label>{t('carts.column.convertedToQr')}</Label><span className="font-mono text-xs">{cart.convertedToQuoteRequestId.slice(0, 8)}</span></div>
            ) : null}
            {cart.rejectedReason ? (
              <div className="col-span-2 md:col-span-4">
                <Label>{t('carts.column.rejectedReason')}</Label>
                <p className="text-sm">{cart.rejectedReason} <span className="text-muted-foreground text-xs">— {cart.rejectedByActor}</span></p>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="pt-6">
          <h2 className="font-semibold mb-2">{t('carts.detail.lines')}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('carts.column.product')}</TableHead>
                <TableHead>{t('carts.column.qty')}</TableHead>
                <TableHead>{t('carts.column.unit')}</TableHead>
                <TableHead>{t('carts.column.line')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cart.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell className="tabular-nums">{it.quantity}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(it.unitPrice.amount, it.unitPrice.currency)}</TableCell>
                  <TableCell className="tabular-nums">{formatMoney(it.lineTotal.amount, it.lineTotal.currency)}</TableCell>
                </TableRow>
              ))}
              {cart.discount && cart.discount.amount > 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-right text-muted-foreground">
                    {t('carts.column.discount')}
                  </TableCell>
                  <TableCell className="tabular-nums text-ok">
                    −{formatMoney(cart.discount.amount, cart.discount.currency)}
                  </TableCell>
                </TableRow>
              ) : null}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-semibold">{t('carts.column.total')}</TableCell>
                <TableCell className="tabular-nums font-semibold">{formatMoney(cart.total.amount, cart.total.currency)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {!isTerminal ? (
        <Card className="mb-4">
          <CardContent className="pt-6">
            {showReject ? (
              <div className="space-y-2">
                <Label htmlFor="reason">{t('carts.reject.reasonLabel')}</Label>
                <Input
                  id="reason"
                  value={rejectReason}
                  onChange={(e): void => setRejectReason(e.target.value)}
                  placeholder={t('carts.reject.reasonPlaceholder')}
                  disabled={rejecting}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={(): void => {
                      void handleReject();
                    }}
                    disabled={rejecting || rejectReason.trim().length === 0}
                  >
                    {rejecting
                      ? t('carts.reject.submitting')
                      : t('carts.reject.confirm')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={(): void => {
                      setShowReject(false);
                      setRejectReason('');
                    }}
                    disabled={rejecting}
                  >
                    {t('carts.reject.cancel')}
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="destructive" onClick={(): void => setShowReject(true)}>
                {t('carts.reject.open')}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <h2 className="font-semibold mb-2">{t('carts.detail.audit')}</h2>
          {audit.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('carts.detail.auditEmpty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('carts.audit.when')}</TableHead>
                  <TableHead>{t('carts.audit.who')}</TableHead>
                  <TableHead>{t('carts.audit.action')}</TableHead>
                  <TableHead>{t('carts.audit.transition')}</TableHead>
                  <TableHead>{t('carts.audit.reason')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs">{formatDateTime(row.occurredAt)}</TableCell>
                    <TableCell className="text-xs">
                      <span className="text-muted-foreground">{row.actorType}</span>
                      {row.actorDisplayName ? ` · ${row.actorDisplayName}` : ''}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{row.action}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {row.fromState ?? '—'} → {row.toState ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs">{row.reason ?? ''}</TableCell>
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
