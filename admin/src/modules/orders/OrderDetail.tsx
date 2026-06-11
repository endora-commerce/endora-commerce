import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ClipboardList,
  Copy,
  CreditCard,
  FileDown,
  FileText,
  MessageSquare,
  RotateCcw,
  Truck,
} from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import { useUnsavedChangesPrompt } from '@/lib/use-unsaved-changes-prompt';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { OrderPaymentsTab } from './OrderPaymentsTab';
import { OrderShipmentsTab } from './OrderShipmentsTab';
import { Section } from './Section';
import { orderStatusBadgeStyle } from './orderStatusColor';

type OrderTab = 'overview' | 'payment' | 'delivery' | 'comments';

interface OrderItem {
  id: string;
  productId: string;
  productSnapshot: { sku: string; name: string; primaryAssetUrl: string | null };
  variantSnapshot: { sku: string; label: string } | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
}

interface OrderAddress {
  recipientName?: string;
  street: string;
  city: string;
  postalCode: string;
  country: string;
  phone?: string | null;
  /** Billing snapshot only — company name + tax-id captured at placement. */
  companyName?: string | null;
  taxId?: string | null;
}
interface OrderOrganization {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string;
  vatStatus: string;
}
interface OrderCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

interface OrderDetail {
  id: string;
  businessId: string;
  organizationId: string;
  placedByCustomerAccountId: string;
  organization: OrderOrganization | null;
  customer: OrderCustomer | null;
  status: string;
  paymentStatus: string;
  deliveryAddress: OrderAddress;
  billingAddress: OrderAddress;
  deliveryMethod: { code: string; name: Record<string, string>; cost: number };
  paymentMethod: { code: string; name: Record<string, string>; kind: string };
  items: OrderItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  deliveryTotal: number;
  total: number;
  currency: string;
  customerNote: string | null;
  placedAt: string;
}

interface StatusDef {
  code: string;
  name: Record<string, string>;
  isTerminal: boolean;
  color?: string;
}
interface StatusGraph {
  statuses: StatusDef[];
  transitions: Array<{ fromStatusCode: string; toStatusCode: string }>;
}

function statusName(graph: StatusGraph | null, code: string): string {
  const s = graph?.statuses.find((x) => x.code === code);
  if (!s) return code;
  return s.name['en'] ?? Object.values(s.name)[0] ?? code;
}

function statusColor(graph: StatusGraph | null, code: string): string {
  return graph?.statuses.find((x) => x.code === code)?.color ?? 'neutral';
}

/** Current status plus the statuses reachable from it (valid next transitions). */
function statusOptions(graph: StatusGraph | null, current: string): string[] {
  if (!graph) return [current];
  const targets = graph.transitions
    .filter((tr) => tr.fromStatusCode === current)
    .map((tr) => tr.toStatusCode);
  return [current, ...targets.filter((c, i) => targets.indexOf(c) === i)];
}

const PAYMENT_STATUSES = ['awaiting_payment', 'paid', 'deferred', 'refunded'] as const;

interface OrderCommentRow {
  id: string;
  body: string;
  isCustomerVisible: boolean;
  notifyCustomer: boolean;
  authorAdminUserId: string | null;
  authorCustomerAccountId: string | null;
  createdAt: string;
}

export function OrderDetail(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [graph, setGraph] = useState<StatusGraph | null>(null);
  const [comments, setComments] = useState<OrderCommentRow[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentVisible, setCommentVisible] = useState(true);
  const [commentNotify, setCommentNotify] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<OrderTab>('overview');

  // Warn before leaving with an unsent comment draft.
  useUnsavedChangesPrompt(commentBody.trim() !== '');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: OrderDetail }>(`/api/v1/admin/orders/${id}`);
      setOrder(res.data);
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'ORDER_NOT_FOUND') {
        setOrder(null);
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

  // Load the configurable status graph so the selector offers only valid
  // next transitions (feature 038 US1).
  useEffect(() => {
    void apiClient
      .get<{ data: StatusGraph }>('/api/v1/admin/orders/statuses')
      .then((res) => setGraph(res.data))
      .catch(() => setGraph(null));
  }, []);

  const loadComments = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.get<{ data: OrderCommentRow[] }>(`/api/v1/admin/orders/${id}/comments`);
      setComments(res.data);
    } catch {
      setComments([]);
    }
  }, [id]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleAddComment = useCallback(async (): Promise<void> => {
    if (!commentBody.trim()) return;
    try {
      await apiClient.post(`/api/v1/admin/orders/${id}/comments`, {
        body: commentBody.trim(),
        isCustomerVisible: commentVisible,
        notifyCustomer: commentNotify,
      });
      setCommentBody('');
      await loadComments();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orderDetail.comments.error'));
    }
  }, [id, commentBody, commentVisible, commentNotify, loadComments, t]);

  const copyBusinessId = useCallback(async (): Promise<void> => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.businessId);
      setInfo(t('orderDetail.copied', { id: order.businessId }));
    } catch {
      setError(t('orderDetail.copyError'));
    }
  }, [order, t]);

  const handleReorder = useCallback(async (): Promise<void> => {
    try {
      const res = await apiClient.post<{ data: { unavailableItems: unknown[] } }>(
        `/api/v1/admin/orders/${id}/reorder`,
        {},
      );
      const unavailable = res.data.unavailableItems.length;
      setInfo(
        unavailable > 0
          ? t('orderDetail.reorder.doneWithSkips', { count: unavailable })
          : t('orderDetail.reorder.done'),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orderDetail.reorder.error'));
    }
  }, [id, t]);

  const handleCloneToQuote = useCallback(async (): Promise<void> => {
    try {
      await apiClient.post(`/api/v1/admin/orders/${id}/clone-to-quote`, {});
      setInfo(t('orderDetail.cloneToQuote.done'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orderDetail.cloneToQuote.error'));
    }
  }, [id, t]);

  const handleStatus = useCallback(
    async (to: string): Promise<void> => {
      try {
        await apiClient.post<{ data: OrderDetail }>(`/api/v1/admin/orders/${id}/status`, { to });
        setInfo(t('orderDetail.messages.orderMoved', { status: statusName(graph, to) }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('orderDetail.errors.statusChange'));
      }
    },
    [id, refresh, graph, t],
  );

  const handlePaymentStatus = useCallback(
    async (to: string): Promise<void> => {
      try {
        await apiClient.post<{ data: OrderDetail }>(
          `/api/v1/admin/orders/${id}/payment-status`,
          { to },
        );
        setInfo(t('orderDetail.messages.paymentMoved', { status: t(`orderDetail.paymentStatus.${to}`) }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('orderDetail.errors.paymentChange'));
      }
    },
    [id, refresh],
  );

  if (loading) return <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>;
  if (!order)
    return (
      <Alert variant="warning">
        <AlertDescription>{t('orderDetail.notFound')}</AlertDescription>
      </Alert>
    );

  return (
    <>
      <PageHeader
        back={{ label: t('orders.page.title'), to: '/orders' }}
        title={
          <>
            <button
              type="button"
              onClick={(): void => void copyBusinessId()}
              title={t('orderDetail.copyHint')}
              className="inline-flex items-center gap-1.5 hover:opacity-80"
            >
              {t('orderDetail.title', { id: order.businessId })}
              <Copy className="size-3.5 opacity-60" />
            </button>
            <Badge className="text-xs font-medium" style={orderStatusBadgeStyle(statusColor(graph, order.status))}>
              {statusName(graph, order.status)}
            </Badge>
          </>
        }
        description={
          <span>
            {t('orderDetail.placedAt', { date: formatDateTime(order.placedAt) })}{' '}
            <code className="font-mono text-xs">({order.id})</code>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={(): void => void handleReorder()}
            >
              <RotateCcw />
              {t('orderDetail.reorder.action')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="bg-card"
              onClick={(): void => void handleCloneToQuote()}
            >
              <FileText />
              {t('orderDetail.cloneToQuote.action')}
            </Button>
            <Button asChild variant="outline" size="sm" className="bg-card">
              <a
                href={`${import.meta.env['VITE_API_BASE_URL'] ?? ''}/api/v1/orders/${order.id}/invoice`}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown />
                {t('orderDetail.invoicePdf')}
              </a>
            </Button>
          </>
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

      <Card className="mb-4 overflow-hidden">
        <div style={{ padding: '4px 4px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
            <div className="b2b-tabs" role="tablist">
              <TabBtn
                id="overview"
                label={t('orderDetail.tabs.overview')}
                icon={<ClipboardList size={14} />}
                active={tab}
                onChange={setTab}
              />
              <TabBtn
                id="payment"
                label={t('orderDetail.tabs.payment')}
                icon={<CreditCard size={14} />}
                active={tab}
                onChange={setTab}
              />
              <TabBtn
                id="delivery"
                label={t('orderDetail.tabs.delivery')}
                icon={<Truck size={14} />}
                active={tab}
                onChange={setTab}
              />
              <TabBtn
                id="comments"
                label={t('orderDetail.tabs.comments')}
                icon={<MessageSquare size={14} />}
                active={tab}
                onChange={setTab}
              />
            </div>
          </div>
        </div>

        <CardContent className="divide-y divide-border pt-6 [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
          {tab === 'overview' ? (
            <>
              <Section title={t('orderDetail.sections.status')}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ostat">{t('orderDetail.fields.orderStatus')}</Label>
                    <Select
                      id="ostat"
                      value={order.status}
                      onChange={(e): void => {
                        if (e.target.value !== order.status) void handleStatus(e.target.value);
                      }}
                    >
                      {statusOptions(graph, order.status).map((code) => (
                        <option key={code} value={code}>
                          {statusName(graph, code)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pstat">{t('orderDetail.fields.paymentStatus')}</Label>
                    <Select
                      id="pstat"
                      value={order.paymentStatus}
                      onChange={(e): void => void handlePaymentStatus(e.target.value)}
                    >
                      {PAYMENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {t(`orderDetail.paymentStatus.${s}`)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
              </Section>

              <div className="grid gap-6 md:grid-cols-2">
                <Section title={t('orderDetail.sections.organization')}>
                  {order.organization ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{order.organization.name}</p>
                      {order.organization.legalName &&
                      order.organization.legalName !== order.organization.name ? (
                        <p className="text-muted-foreground">{order.organization.legalName}</p>
                      ) : null}
                      <p className="text-muted-foreground">
                        {t('orderDetail.org.taxId')}: <strong>{order.organization.taxId}</strong>
                      </p>
                      <p className="text-muted-foreground">
                        {t('orderDetail.org.vat')}:{' '}
                        {t(`orderDetail.vatStatus.${order.organization.vatStatus}`)}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-xs">{order.organizationId}</code>
                    </p>
                  )}
                </Section>
                <Section title={t('orderDetail.sections.customer')}>
                  {order.customer ? (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">
                        {`${order.customer.firstName} ${order.customer.lastName}`.trim() ||
                          order.customer.email}
                      </p>
                      <p className="text-muted-foreground">
                        <a className="underline underline-offset-2" href={`mailto:${order.customer.email}`}>
                          {order.customer.email}
                        </a>
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      <code className="font-mono text-xs">{order.placedByCustomerAccountId}</code>
                    </p>
                  )}
                </Section>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <Section title={t('orderDetail.sections.delivery')}>
                  <div className="space-y-2 text-sm">
                    <p>
                      {order.deliveryAddress.recipientName ? (
                        <>
                          <strong>{order.deliveryAddress.recipientName}</strong>
                          <br />
                        </>
                      ) : null}
                      {order.deliveryAddress.street}
                      <br />
                      {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
                      <br />
                      {order.deliveryAddress.country}
                    </p>
                    <p className="text-muted-foreground">
                      {t('orderDetail.deliveryVia')} <strong>{order.deliveryMethod.code}</strong>
                    </p>
                  </div>
                </Section>
                <Section title={t('orderDetail.sections.billing')}>
                  <div className="space-y-2 text-sm">
                    <p>
                      {order.billingAddress.companyName ? (
                        <>
                          <strong>{order.billingAddress.companyName}</strong>
                          <br />
                        </>
                      ) : null}
                      {order.billingAddress.taxId ? (
                        <>
                          {t('orderDetail.taxId')}: {order.billingAddress.taxId}
                          <br />
                        </>
                      ) : null}
                      {order.billingAddress.recipientName ? (
                        <>
                          {order.billingAddress.recipientName}
                          <br />
                        </>
                      ) : null}
                      {order.billingAddress.street}
                      <br />
                      {order.billingAddress.postalCode} {order.billingAddress.city}
                      <br />
                      {order.billingAddress.country}
                    </p>
                    <p className="text-muted-foreground">
                      {t('orderDetail.paidBy')} <strong>{order.paymentMethod.code}</strong> (
                      {order.paymentMethod.kind})
                    </p>
                  </div>
                </Section>
              </div>

              {order.customerNote ? (
                <Section title={t('orderDetail.sections.buyerNote')}>
                  <p className="text-sm">{order.customerNote}</p>
                </Section>
              ) : null}

              <Section title={t('orderDetail.sections.items')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('orderDetail.columns.product')}</TableHead>
                      <TableHead>{t('orderDetail.columns.qty')}</TableHead>
                      <TableHead>{t('orderDetail.columns.unit')}</TableHead>
                      <TableHead>{t('orderDetail.columns.tax')}</TableHead>
                      <TableHead className="text-right">{t('orderDetail.columns.line')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.items.map((it) => (
                      <TableRow key={it.id}>
                        <TableCell>
                          <Link
                            to={`/catalog/products/${it.productId}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {it.productSnapshot.name}
                          </Link>
                          <div className="font-mono text-xs text-muted-foreground">
                            {it.variantSnapshot ? `${it.variantSnapshot.label} · ` : ''}
                            {it.productSnapshot.sku}
                          </div>
                        </TableCell>
                        <TableCell>{it.quantity}</TableCell>
                        <TableCell className="tabular-nums">
                          {it.unitPrice.toFixed(2)} {order.currency}
                        </TableCell>
                        <TableCell>{(it.taxRate * 100).toFixed(1)}%</TableCell>
                        <TableCell className="tabular-nums text-right">
                          {it.lineTotal.toFixed(2)} {order.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  <tfoot className="border-t [&_td]:p-2 [&_th]:p-2">
                    <tr>
                      <th colSpan={4} className="text-right font-medium text-muted-foreground">
                        {t('orderDetail.totals.subtotal')}
                      </th>
                      <td className="tabular-nums text-right">
                        {order.subtotal.toFixed(2)} {order.currency}
                      </td>
                    </tr>
                    <tr>
                      <th colSpan={4} className="text-right font-medium text-muted-foreground">
                        {t('orderDetail.totals.tax')}
                      </th>
                      <td className="tabular-nums text-right">
                        {order.taxTotal.toFixed(2)} {order.currency}
                      </td>
                    </tr>
                    <tr>
                      <th colSpan={4} className="text-right font-medium text-muted-foreground">
                        {t('orderDetail.totals.delivery')}
                      </th>
                      <td className="tabular-nums text-right">
                        {order.deliveryTotal.toFixed(2)} {order.currency}
                      </td>
                    </tr>
                    <tr>
                      <th colSpan={4} className="text-right font-semibold">
                        {t('orderDetail.totals.total')}
                      </th>
                      <td className="tabular-nums text-right font-semibold">
                        {order.total.toFixed(2)} {order.currency}
                      </td>
                    </tr>
                  </tfoot>
                </Table>
              </Section>
            </>
          ) : null}

          {tab === 'payment' ? <OrderPaymentsTab orderId={id} /> : null}
          {tab === 'delivery' ? <OrderShipmentsTab orderId={id} /> : null}

          {tab === 'comments' ? (
            <Section title={t('orderDetail.sections.comments')}>
              {comments.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('orderDetail.comments.empty')}</p>
              ) : (
                <ul className="space-y-2">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded-md border p-3 text-sm" data-testid="order-comment">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatDateTime(c.createdAt)}</span>
                        {c.authorCustomerAccountId ? (
                          <span>{t('orderDetail.comments.byCustomer')}</span>
                        ) : (
                          <span>{t('orderDetail.comments.byStaff')}</span>
                        )}
                        {!c.isCustomerVisible ? (
                          <span className="rounded bg-muted px-1.5 py-0.5">
                            {t('orderDetail.comments.internal')}
                          </span>
                        ) : null}
                      </div>
                      <p>{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <div className="space-y-2 border-t pt-3">
                <textarea
                  aria-label="comment-body"
                  className="min-h-20 w-full rounded-md border p-2 text-sm"
                  value={commentBody}
                  onChange={(e): void => setCommentBody(e.target.value)}
                  placeholder={t('orderDetail.comments.placeholder')}
                />
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={commentVisible}
                      onChange={(e): void => setCommentVisible(e.target.checked)}
                    />
                    {t('orderDetail.comments.customerVisible')}
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={commentNotify}
                      onChange={(e): void => setCommentNotify(e.target.checked)}
                    />
                    {t('orderDetail.comments.notify')}
                  </label>
                  <Button
                    size="sm"
                    disabled={!commentBody.trim()}
                    onClick={(): void => void handleAddComment()}
                  >
                    {t('orderDetail.comments.add')}
                  </Button>
                </div>
              </div>
            </Section>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}

function TabBtn(props: {
  id: OrderTab;
  label: string;
  icon: ReactNode;
  active: OrderTab;
  onChange: (id: OrderTab) => void;
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
