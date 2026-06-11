import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { Check, ClipboardList, Copy, FileText, History, PencilLine, XCircle } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Textarea } from '@/components/ui/textarea';
import { ProductPicker } from '@/modules/catalog/components/ProductPicker';
import { Section } from '@/modules/orders/Section';
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
 * Admin Quote Request detail (feature 008 / T043). Restructured to mirror the
 * Order detail view: a PageHeader (back + title + status badge) above a single
 * tabbed Card whose body is a set of titled Sections — Overview (status +
 * actions, organization, customer, line items), Modify (negotiation), and
 * History — omitting the Order-only payment/delivery/comments tabs that do not
 * apply to a Quote Request.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

type RfqTab = 'overview' | 'modify' | 'history';

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

interface RfqOrganization {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string;
  vatStatus: string;
}
interface RfqCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface AdminRfqDetail {
  id: string;
  /** Customer-facing business ID (feature: quote-request businessId). */
  businessId?: string;
  organizationId: string;
  customerAccountId: string;
  organization?: RfqOrganization | null;
  customer?: RfqCustomer | null;
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
  createdAt: string;
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<RfqTab>('overview');

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
      setCancelOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.cancel'));
    } finally {
      setBusy(false);
    }
  };

  const convert = async (): Promise<void> => {
    if (!rfq) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.post<{ data: { cartId: string; checkoutUrl: string } }>(
        `/api/v1/quote-requests/${rfq.id}/convert-to-order`,
        {},
      );
      setInfo(
        t('rfq.detail.convert.success', {
          cartId: res.data.cartId.slice(0, 8),
          url: res.data.checkoutUrl,
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.convert.error'));
    } finally {
      setBusy(false);
    }
  };

  const copyId = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    const ref = rfq.businessId ?? rfq.id;
    try {
      await navigator.clipboard.writeText(ref);
      setInfo(t('rfq.detail.copied', { id: ref }));
    } catch {
      setError(t('rfq.detail.copyError'));
    }
  }, [rfq, t]);

  if (loading) return <p className="text-sm text-muted-foreground">{t('rfq.detail.loading')}</p>;

  if (!rfq)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? t('rfq.detail.notFound')}</AlertDescription>
      </Alert>
    );

  const displayId = rfq.businessId ?? rfq.id.slice(0, 8);
  const isTerminal = TERMINAL.includes(rfq.status);
  const total = rfq.items.every((it) => it.agreedUnitPrice !== null)
    ? rfq.items.reduce((s, it) => s + (it.agreedUnitPrice ?? 0) * it.quantity, 0)
    : null;
  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';

  return (
    <>
      <PageHeader
        back={{ label: t('rfq.list.title'), to: '/quote-requests' }}
        title={
          <>
            <button
              type="button"
              onClick={(): void => void copyId()}
              title={t('rfq.detail.copyHint')}
              className="inline-flex items-center gap-1.5 hover:opacity-80"
            >
              {t('rfq.detail.title', { id: displayId })}
              <Copy className="size-3.5 opacity-60" />
            </button>
            <Badge variant={STATUS_VARIANT[rfq.status]} className="text-xs font-medium">
              {rfq.status}
            </Badge>
            {rfq.awaitingCustomerRevisionAcceptance ? (
              <Badge variant="warning" className="text-xs font-medium">
                {t('rfq.detail.badge.awaitingRevision')}
              </Badge>
            ) : null}
          </>
        }
        description={
          <span>
            {t('rfq.detail.meta.created', { date: formatDateTime(rfq.createdAt) })}
            {rfq.submittedAt
              ? ` · ${t('rfq.detail.meta.submitted', { date: formatDateTime(rfq.submittedAt) })}`
              : ''}{' '}
            <code className="font-mono text-xs">({rfq.id})</code>
          </span>
        }
        actions={
          rfq.status === 'Approved' ? (
            <Button variant="outline" size="sm" className="bg-card" onClick={(): void => void convert()} disabled={busy}>
              <FileText />
              {t('rfq.detail.convert.placeOrder')}
            </Button>
          ) : null
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

      {rfq.cancellationReason ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {t('rfq.detail.badge.cancelReason', { reason: rfq.cancellationReason })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4 overflow-hidden">
        <div style={{ padding: '4px 4px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
            <div className="b2b-tabs" role="tablist">
              <TabBtn
                id="overview"
                label={t('rfq.detail.tabs.overview')}
                icon={<ClipboardList size={14} />}
                active={tab}
                onChange={setTab}
              />
              {!isTerminal ? (
                <TabBtn
                  id="modify"
                  label={t('rfq.detail.tabs.modify')}
                  icon={<PencilLine size={14} />}
                  active={tab}
                  onChange={setTab}
                />
              ) : null}
              <TabBtn
                id="history"
                label={t('rfq.detail.tabs.history')}
                icon={<History size={14} />}
                active={tab}
                onChange={setTab}
              />
            </div>
          </div>
        </div>

        <CardContent className="divide-y divide-border pt-6 [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {tab === 'overview' ? (
            <>
              {!isTerminal ? (
                <Section title={t('rfq.detail.sections.status')}>
                  <div className="flex flex-wrap items-center gap-2">
                    {rfq.status === 'Pending' ? (
                      <Button onClick={(): void => void approve()} disabled={busy}>
                        <Check size={14} className="mr-1" /> {t('rfq.detail.approve')}
                      </Button>
                    ) : null}
                    <Button
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      onClick={(): void => setCancelOpen(true)}
                      disabled={busy}
                    >
                      <XCircle size={14} className="mr-1" /> {t('rfq.detail.cancelRfq')}
                    </Button>
                  </div>
                </Section>
              ) : null}

              <div className="grid gap-6 md:grid-cols-2">
                <Section title={t('rfq.detail.sections.organization')}>
                  {rfq.organization ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{rfq.organization.name}</p>
                      {rfq.organization.legalName &&
                      rfq.organization.legalName !== rfq.organization.name ? (
                        <p className="text-muted-foreground">{rfq.organization.legalName}</p>
                      ) : null}
                      <p className="text-muted-foreground">
                        {t('rfq.detail.org.taxId')}: <strong>{rfq.organization.taxId}</strong>
                      </p>
                      <p className="text-muted-foreground">
                        {t('rfq.detail.org.vat')}:{' '}
                        {t(`rfq.detail.vatStatus.${rfq.organization.vatStatus}`)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-xs">{rfq.organizationId}</code>
                    </p>
                  )}
                </Section>
                <Section title={t('rfq.detail.sections.customer')}>
                  {rfq.customer ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {`${rfq.customer.firstName ?? ''} ${rfq.customer.lastName ?? ''}`.trim() ||
                          rfq.customer.email}
                      </p>
                      <p className="text-muted-foreground">
                        <a className="underline underline-offset-2" href={`mailto:${rfq.customer.email}`}>
                          {rfq.customer.email}
                        </a>
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-xs">{rfq.customerAccountId}</code>
                    </p>
                  )}
                </Section>
              </div>

              {rfq.headerNote ? (
                <Section title={t('rfq.detail.sections.buyerNote')}>
                  <p className="text-sm">{rfq.headerNote}</p>
                </Section>
              ) : null}

              <Section title={t('rfq.detail.sections.items')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('rfq.detail.column.product')}</TableHead>
                      <TableHead>{t('rfq.detail.column.qty')}</TableHead>
                      <TableHead>{t('rfq.detail.column.desired')}</TableHead>
                      <TableHead>{t('rfq.detail.column.agreed')}</TableHead>
                      <TableHead className="text-right">{t('rfq.detail.column.lineTotal')}</TableHead>
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
                            {it.lineNote ? (
                              <div className="text-xs text-muted-foreground">{it.lineNote}</div>
                            ) : null}
                          </TableCell>
                          <TableCell>{it.quantity}</TableCell>
                          <TableCell className="tabular-nums">
                            {it.desiredUnitPrice !== null ? it.desiredUnitPrice.toFixed(2) : '—'}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {it.agreedUnitPrice !== null ? it.agreedUnitPrice.toFixed(2) : '—'}
                          </TableCell>
                          <TableCell className="tabular-nums text-right">
                            {lineTotal !== null
                              ? `${lineTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${it.lineCurrency}`
                              : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  {total !== null ? (
                    <tfoot className="border-t [&_td]:p-2 [&_th]:p-2">
                      <tr>
                        <th colSpan={4} className="text-right font-semibold">
                          {t('rfq.detail.totalLabel')}
                        </th>
                        <td className="tabular-nums text-right font-semibold">
                          {total.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} {currency}
                        </td>
                      </tr>
                    </tfoot>
                  ) : null}
                </Table>
              </Section>
            </>
          ) : null}

          {tab === 'modify' && !isTerminal ? (
            <ModifyCard rfq={rfq} onSaved={refresh} setError={setError} setInfo={setInfo} />
          ) : null}

          {tab === 'history' ? (
            <Section title={t('rfq.detail.history.title')}>
              {rfq.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('rfq.detail.history.empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {rfq.events.map((e) => (
                    <li key={e.id} className="rounded-md border p-3 text-sm">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(e.createdAt)}</span>
                        {e.actorRoleLabel ? <span>· {e.actorRoleLabel}</span> : null}
                      </div>
                      <p className="font-medium">{e.eventType}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          ) : null}
        </CardContent>
      </Card>

      {cancelOpen ? (
        <CancelDialog
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onConfirm={(): void => void cancel()}
          onClose={(): void => setCancelOpen(false)}
          busy={busy}
        />
      ) : null}
    </>
  );
}

/**
 * Cancellation modal — captures the (optional) cancellation reason on an
 * overlay rather than stretching the status row, then confirms the cancel.
 */
function CancelDialog(props: {
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}): ReactNode {
  const t = useTranslation('core');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e): void => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{t('rfq.detail.cancelDialog.title')}</h2>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">{t('rfq.detail.cancelReason')}</Label>
          <Textarea
            id="cancel-reason"
            autoFocus
            value={props.reason}
            onChange={(e): void => props.onReasonChange(e.target.value)}
            placeholder={t('rfq.detail.cancelReasonPlaceholder')}
            rows={3}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={props.busy}>
            {t('rfq.detail.cancelDialog.dismiss')}
          </Button>
          <Button variant="destructive" onClick={props.onConfirm} disabled={props.busy}>
            <XCircle size={14} className="mr-1" /> {t('rfq.detail.cancelDialog.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabBtn(props: {
  id: RfqTab;
  label: string;
  icon: ReactNode;
  active: RfqTab;
  onChange: (id: RfqTab) => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active === props.id}
      className={cn('b2b-tab', props.active === props.id && 'is-active')}
      onClick={(): void => props.onChange(props.id)}
    >
      {props.icon}
      {props.label}
    </button>
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

  // Reference data from the current revision: the customer's desired unit price
  // and the line currency, keyed by product so each modify row can show a price
  // even before an agreed price is typed.
  const originalByProduct = new Map(rfq.items.map((it) => [it.productId, it]));
  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';
  const fmt = (n: number): string =>
    `${n.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} ${currency}`;

  // A plain grid (not <Table>, which wraps in an overflow-auto container that
  // would clip the product dropdown) so the picker's options overlay outside
  // the row instead of being trapped inside it.
  const gridCols = 'grid-cols-[minmax(180px,1fr)_88px_120px_110px_120px_auto]';

  return (
    <Section title={t('rfq.detail.modify.title')}>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="modify-note">{t('rfq.detail.modify.headerNote')}</Label>
          <Textarea
            id="modify-note"
            value={headerNote}
            onChange={(e): void => setHeaderNote(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <div
            className={cn(
              'hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid',
              gridCols,
            )}
          >
            <span>{t('rfq.detail.modify.productId')}</span>
            <span>{t('rfq.detail.modify.quantity')}</span>
            <span>{t('rfq.detail.modify.agreedUnitPrice')}</span>
            <span>{t('rfq.detail.modify.desiredPrice')}</span>
            <span>{t('rfq.detail.modify.lineTotal')}</span>
            <span />
          </div>
          {lines.map((l, i) => {
            const orig = l.productId ? originalByProduct.get(l.productId) : undefined;
            const desired = orig?.desiredUnitPrice ?? null;
            const qtyNum = Number(l.quantity);
            const agreedNum = Number(l.agreedUnitPrice);
            const lineTotal =
              l.agreedUnitPrice.trim().length > 0 && Number.isFinite(agreedNum) && qtyNum > 0
                ? agreedNum * qtyNum
                : desired !== null && qtyNum > 0
                  ? desired * qtyNum
                  : null;
            return (
              <div
                key={i}
                className={cn('grid items-center gap-3 md:grid', gridCols)}
              >
                <ProductPicker
                  mode="select"
                  value={l.productId || null}
                  onChange={(v): void => updateLine(i, { productId: v ?? '' })}
                />
                <input
                  type="number"
                  min={1}
                  aria-label={t('rfq.detail.modify.quantity')}
                  value={l.quantity}
                  onChange={(e): void => updateLine(i, { quantity: e.target.value })}
                  style={{ width: 80, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  aria-label={t('rfq.detail.modify.agreedUnitPrice')}
                  value={l.agreedUnitPrice}
                  onChange={(e): void => updateLine(i, { agreedUnitPrice: e.target.value })}
                  style={{ width: 110, padding: 6, border: '1px solid var(--border)', borderRadius: 4 }}
                />
                <span className="text-sm tabular-nums text-muted-foreground">
                  {desired !== null ? fmt(desired) : '—'}
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {lineTotal !== null ? fmt(lineTotal) : '—'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(): void => setLines((prev) => prev.filter((_, j) => j !== i))}
                >
                  {t('rfq.detail.modify.remove')}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
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
      </div>
    </Section>
  );
}
