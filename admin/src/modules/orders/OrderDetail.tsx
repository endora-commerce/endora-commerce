import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ClipboardList,
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
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

type OrderTab = 'overview' | 'payment' | 'delivery' | 'comments';

interface OrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
}

interface OrderDetail {
  id: string;
  organizationId: string;
  placedByCustomerAccountId: string;
  status: string;
  paymentStatus: string;
  deliveryAddress: { street: string; city: string; postalCode: string; country: string };
  billingAddress: { street: string; city: string; postalCode: string; country: string };
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
        title={t('orderDetail.title', { id: order.id.slice(0, 8) })}
        description={
          <span>
            {t('orderDetail.placedAt', { date: formatDateTime(order.placedAt) })}{' '}
            <code className="font-mono text-xs">{order.organizationId.slice(0, 8)}</code>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/orders">
                <ArrowLeft />
                {t('common.action.back')}
              </Link>
            </Button>
            <Button variant="outline" onClick={(): void => void handleReorder()}>
              <RotateCcw />
              {t('orderDetail.reorder.action')}
            </Button>
            <Button variant="outline" onClick={(): void => void handleCloneToQuote()}>
              <FileText />
              {t('orderDetail.cloneToQuote.action')}
            </Button>
            <Button asChild variant="outline">
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

      <div className="mb-4">
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

      {tab === 'payment' ? <OrderPaymentsTab orderId={id} /> : null}
      {tab === 'delivery' ? <OrderShipmentsTab orderId={id} /> : null}

      {tab === 'overview' ? (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>{t('orderDetail.sections.status')}</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <div className="mb-4 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('orderDetail.sections.delivery')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {order.deliveryAddress.street}
                  <br />
                  {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
                  <br />
                  {order.deliveryAddress.country}
                </p>
                <p className="text-muted-foreground">
                  {t('orderDetail.deliveryVia')} <strong>{order.deliveryMethod.code}</strong>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('orderDetail.sections.billing')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  {order.billingAddress.street}
                  <br />
                  {order.billingAddress.postalCode} {order.billingAddress.city}
                  <br />
                  {order.billingAddress.country}
                </p>
                <p className="text-muted-foreground">
                  {t('orderDetail.paidBy')} <strong>{order.paymentMethod.code}</strong> ({order.paymentMethod.kind})
                </p>
              </CardContent>
            </Card>
          </div>

          {order.customerNote ? (
            <Card className="mb-4">
              <CardHeader>
                <CardTitle>{t('orderDetail.sections.buyerNote')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{order.customerNote}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>{t('orderDetail.sections.items')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('orderDetail.columns.product')}</TableHead>
                    <TableHead>{t('orderDetail.columns.qty')}</TableHead>
                    <TableHead>{t('orderDetail.columns.unit')}</TableHead>
                    <TableHead>{t('orderDetail.columns.tax')}</TableHead>
                    <TableHead>{t('orderDetail.columns.line')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {order.items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-mono text-xs">{it.productId.slice(0, 8)}</TableCell>
                      <TableCell>{it.quantity}</TableCell>
                      <TableCell className="tabular-nums">
                        {it.unitPrice.toFixed(2)} {order.currency}
                      </TableCell>
                      <TableCell>{(it.taxRate * 100).toFixed(1)}%</TableCell>
                      <TableCell className="tabular-nums">
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
                    <td className="tabular-nums">
                      {order.subtotal.toFixed(2)} {order.currency}
                    </td>
                  </tr>
                  <tr>
                    <th colSpan={4} className="text-right font-medium text-muted-foreground">
                      {t('orderDetail.totals.tax')}
                    </th>
                    <td className="tabular-nums">
                      {order.taxTotal.toFixed(2)} {order.currency}
                    </td>
                  </tr>
                  <tr>
                    <th colSpan={4} className="text-right font-medium text-muted-foreground">
                      {t('orderDetail.totals.delivery')}
                    </th>
                    <td className="tabular-nums">
                      {order.deliveryTotal.toFixed(2)} {order.currency}
                    </td>
                  </tr>
                  <tr>
                    <th colSpan={4} className="text-right font-semibold">
                      {t('orderDetail.totals.total')}
                    </th>
                    <td className="tabular-nums font-semibold">
                      {order.total.toFixed(2)} {order.currency}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === 'comments' ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('orderDetail.sections.comments')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                        <span className="rounded bg-muted px-1.5 py-0.5">{t('orderDetail.comments.internal')}</span>
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
                <Button size="sm" disabled={!commentBody.trim()} onClick={(): void => void handleAddComment()}>
                  {t('orderDetail.comments.add')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
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
