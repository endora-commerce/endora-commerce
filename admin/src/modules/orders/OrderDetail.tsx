import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Order detail (T161). Shows items, totals, addresses, methods. Two
 * actions: transition order status and transition payment status. The
 * backend rejects illegal transitions with 409 INVALID_TRANSITION.
 *
 * The "Download invoice PDF" link points at the per-order endpoint
 * already in production; rendering it as a plain anchor lets the
 * browser stream the PDF directly.
 */

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

  if (loading) return <p className="muted">Loading…</p>;
  if (!order) return <p className="alert alert--warning">Order not found.</p>;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>Order {order.id.slice(0, 8)}</h1>
          <p>
            <Link to="/orders">← Back to list</Link> · placed{' '}
            {formatDateTime(order.placedAt)} · org {order.organizationId.slice(0, 8)}
          </p>
        </div>
        <a
          className="btn"
          href={`${import.meta.env['VITE_API_BASE_URL'] ?? ''}/api/v1/orders/${order.id}/invoice`}
          target="_blank"
          rel="noreferrer"
        >
          Invoice PDF
        </a>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {info ? <div className="alert alert--success">{info}</div> : null}

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Status</h2>
        <div style={{ display: 'flex', gap: 16 }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Order status</label>
            <select
              className="input"
              value={order.status}
              onChange={(e): void => void handleStatus(e.target.value)}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Payment status</label>
            <select
              className="input"
              value={order.paymentStatus}
              onChange={(e): void => void handlePaymentStatus(e.target.value)}
            >
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Items</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Tax</th>
              <th>Line</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it) => (
              <tr key={it.id}>
                <td>{it.productId.slice(0, 8)}</td>
                <td>{it.quantity}</td>
                <td>
                  {it.unitPrice.toFixed(2)} {order.currency}
                </td>
                <td>{(it.taxRate * 100).toFixed(1)}%</td>
                <td>
                  {it.lineTotal.toFixed(2)} {order.currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={4} style={{ textAlign: 'right' }}>
                Subtotal
              </th>
              <td>
                {order.subtotal.toFixed(2)} {order.currency}
              </td>
            </tr>
            <tr>
              <th colSpan={4} style={{ textAlign: 'right' }}>
                Tax
              </th>
              <td>
                {order.taxTotal.toFixed(2)} {order.currency}
              </td>
            </tr>
            <tr>
              <th colSpan={4} style={{ textAlign: 'right' }}>
                Delivery
              </th>
              <td>
                {order.deliveryTotal.toFixed(2)} {order.currency}
              </td>
            </tr>
            <tr>
              <th colSpan={4} style={{ textAlign: 'right' }}>
                <strong>Total</strong>
              </th>
              <td>
                <strong>
                  {order.total.toFixed(2)} {order.currency}
                </strong>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Delivery</h3>
          <p>
            {order.deliveryAddress.street}
            <br />
            {order.deliveryAddress.postalCode} {order.deliveryAddress.city}
            <br />
            {order.deliveryAddress.country}
          </p>
          <p className="muted">
            via <strong>{order.deliveryMethod.code}</strong>
          </p>
        </div>
        <div>
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Billing</h3>
          <p>
            {order.billingAddress.street}
            <br />
            {order.billingAddress.postalCode} {order.billingAddress.city}
            <br />
            {order.billingAddress.country}
          </p>
          <p className="muted">
            paid by <strong>{order.paymentMethod.code}</strong> ({order.paymentMethod.kind})
          </p>
        </div>
      </div>

      {order.customerNote ? (
        <div className="card">
          <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Note from buyer</h3>
          <p>{order.customerNote}</p>
        </div>
      ) : null}
    </>
  );
}
