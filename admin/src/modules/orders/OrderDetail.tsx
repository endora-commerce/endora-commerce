import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, FileDown } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const ORDER_STATUSES = [
  'new',
  'confirmed',
  'in_fulfilment',
  'shipped',
  'completed',
  'cancelled',
] as const;

const PAYMENT_STATUSES = ['awaiting_payment', 'paid', 'deferred', 'refunded'] as const;

export function OrderDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

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

  const handleStatus = useCallback(
    async (to: string): Promise<void> => {
      try {
        await apiClient.post<{ data: OrderDetail }>(`/api/v1/admin/orders/${id}/status`, { to });
        setInfo(`Order moved to ${to}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Status change failed.');
      }
    },
    [id, refresh],
  );

  const handlePaymentStatus = useCallback(
    async (to: string): Promise<void> => {
      try {
        await apiClient.post<{ data: OrderDetail }>(
          `/api/v1/admin/orders/${id}/payment-status`,
          { to },
        );
        setInfo(`Payment moved to ${to}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Payment change failed.');
      }
    },
    [id, refresh],
  );

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!order)
    return (
      <Alert variant="warning">
        <AlertDescription>Order not found.</AlertDescription>
      </Alert>
    );

  return (
    <>
      <PageHeader
        title={`Order ${order.id.slice(0, 8)}`}
        description={
          <span>
            placed {formatDateTime(order.placedAt)} · org{' '}
            <code className="font-mono text-xs">{order.organizationId.slice(0, 8)}</code>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link to="/orders">
                <ArrowLeft />
                Back
              </Link>
            </Button>
            <Button asChild variant="outline">
              <a
                href={`${import.meta.env['VITE_API_BASE_URL'] ?? ''}/api/v1/orders/${order.id}/invoice`}
                target="_blank"
                rel="noreferrer"
              >
                <FileDown />
                Invoice PDF
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

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ostat">Order status</Label>
              <Select
                id="ostat"
                value={order.status}
                onChange={(e): void => void handleStatus(e.target.value)}
              >
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pstat">Payment status</Label>
              <Select
                id="pstat"
                value={order.paymentStatus}
                onChange={(e): void => void handlePaymentStatus(e.target.value)}
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Tax</TableHead>
                <TableHead>Line</TableHead>
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
                  Subtotal
                </th>
                <td className="tabular-nums">
                  {order.subtotal.toFixed(2)} {order.currency}
                </td>
              </tr>
              <tr>
                <th colSpan={4} className="text-right font-medium text-muted-foreground">
                  Tax
                </th>
                <td className="tabular-nums">
                  {order.taxTotal.toFixed(2)} {order.currency}
                </td>
              </tr>
              <tr>
                <th colSpan={4} className="text-right font-medium text-muted-foreground">
                  Delivery
                </th>
                <td className="tabular-nums">
                  {order.deliveryTotal.toFixed(2)} {order.currency}
                </td>
              </tr>
              <tr>
                <th colSpan={4} className="text-right font-semibold">
                  Total
                </th>
                <td className="tabular-nums font-semibold">
                  {order.total.toFixed(2)} {order.currency}
                </td>
              </tr>
            </tfoot>
          </Table>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
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
              via <strong>{order.deliveryMethod.code}</strong>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
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
              paid by <strong>{order.paymentMethod.code}</strong> ({order.paymentMethod.kind})
            </p>
          </CardContent>
        </Card>
      </div>

      {order.customerNote ? (
        <Card>
          <CardHeader>
            <CardTitle>Note from buyer</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{order.customerNote}</p>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}
