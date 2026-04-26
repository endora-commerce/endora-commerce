import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Orders list (T161). Read-only table; status changes happen on the
 * detail page where the operator can also see line items + addresses.
 */

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
      <header className="page-header">
        <div>
          <h1>Orders</h1>
          <p>All orders across organizations.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="field">
          <label>Status</label>
          <select
            className="input"
            value={statusFilter}
            onChange={(e): void => setStatusFilter(e.target.value as typeof statusFilter)}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : visible.length === 0 ? (
        <p className="muted">No orders match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Placed</th>
              <th>Order</th>
              <th>Org</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((o) => (
              <tr key={o.id}>
                <td>{formatDateTime(o.placedAt)}</td>
                <td>
                  <Link to={`/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
                </td>
                <td>{o.organizationId.slice(0, 8)}</td>
                <td>{o.status}</td>
                <td>{o.paymentStatus}</td>
                <td>
                  {o.total.toFixed(2)} {o.currency}
                </td>
                <td>
                  <Link className="btn" to={`/orders/${o.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
