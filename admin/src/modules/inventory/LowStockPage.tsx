import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { useSurfaceVisibility } from '@/lib/surface-visibility';

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
  const t = useTranslation('core');
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const [rows, setRows] = useState<LowStockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<LowStockResponse>('/api/v1/admin/inventory/low-stock');
      setRows(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.lowStock.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('inventory.lowStock.title')}</div>
          <div className="b2b-page-head__sub">
            {t('inventory.lowStock.description')}
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
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('inventory.loading')}</div>
          ) : rows.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><AlertTriangle size={20} /></div>
              <div className="b2b-empty__title">{t('inventory.lowStock.empty')}</div>
              <div className="b2b-empty__sub">
                {t('inventory.lowStock.emptyHintPrefix')} <code className="b2b-mono">lowStockThreshold</code> {t('inventory.lowStock.emptyHintSuffix')}
              </div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{t('inventory.column.product')}</th>
                  <th>{t('inventory.column.sku')}</th>
                  <th className="num">{t('inventory.column.cumulativeOnHand')}</th>
                  <th className="num">{t('inventory.column.threshold')}</th>
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
                        {t('inventory.action.editStock')}
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
