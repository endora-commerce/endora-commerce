import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';

interface LowStockRow {
  productId: string;
  productSku: string;
  productName: string;
  cumulativeOnHand: number;
  lowStockThreshold: number;
}

interface LowStockResponse {
  items: LowStockRow[];
}

/**
 * LowStockPage — feature 010 / US4 (T054).
 *
 * Lists every product whose cumulative on-hand has reached or fallen
 * below its `lowStockThreshold`. Mirrors what the Home page Stock
 * Alerts panel surfaces but with no row cap.
 */
export function LowStockPage(): ReactNode {
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<LowStockResponse>('/api/v1/admin/inventory/low-stock');
      setRows(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">Low stock</div>
          <div className="b2b-page-head__sub">
            Products with cumulative on-hand at or below their threshold. Configure thresholds per product or globally under Inventory settings.
          </div>
        </div>
      </div>

      {error ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(8 80% 85%)',
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="b2b-card">
        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><AlertTriangle size={20} /></div>
              <div className="b2b-empty__title">No products are currently low on stock</div>
              <div className="b2b-empty__sub">
                Set <code className="b2b-mono">lowStockThreshold</code> on a product (Inventory tab) to surface it here when stock crosses the line.
              </div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className="num">Cumulative on hand</th>
                  <th className="num">Threshold</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.productId}>
                    <td>{r.productName}</td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.productSku}
                      </span>
                    </td>
                    <td className="num b2b-tabular" style={{ fontWeight: 600 }}>
                      {r.cumulativeOnHand.toLocaleString()}
                    </td>
                    <td className="num b2b-tabular">{r.lowStockThreshold.toLocaleString()}</td>
                    <td className="actions">
                      <Link
                        to={`/catalog/products/${r.productId}`}
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      >
                        Edit stock
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
