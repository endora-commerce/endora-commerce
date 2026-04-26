import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, apiClient } from '../../lib/api-client.js';
import { formatDateTime } from '../../lib/format.js';

/**
 * Invoices list (T162). Filterable by status (pending / ready /
 * cancelled). The "PDF" button links to the existing per-order
 * /api/v1/orders/:id/invoice endpoint — same surface the buyer uses on
 * the storefront, scoped to the order.
 */

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
      <header className="page-header">
        <div>
          <h1>Invoices</h1>
          <p>Read-only. Generation is driven by order events; PDF re-download is per-order.</p>
        </div>
      </header>

      {error ? <div className="alert alert--error">{error}</div> : null}

      <div className="card">
        <div className="field">
          <label>Status</label>
          <select
            className="input"
            value={status}
            onChange={(e): void => setStatus(e.target.value as typeof status)}
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
      ) : rows.length === 0 ? (
        <p className="muted">No invoices match the current filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Kind</th>
              <th>Issued</th>
              <th>Order</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td>{i.number}</td>
                <td>{i.kind}</td>
                <td>{formatDateTime(i.issuedAt)}</td>
                <td>
                  <Link to={`/orders/${i.orderId}`}>{i.orderId.slice(0, 8)}</Link>
                </td>
                <td>
                  {i.total.toFixed(2)} {i.currency}
                </td>
                <td>{i.status}</td>
                <td>
                  {i.pdfReady ? (
                    <a
                      className="btn"
                      href={`${baseUrl}/api/v1/orders/${i.orderId}/invoice`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      PDF
                    </a>
                  ) : (
                    <span className="muted">not ready</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
