import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Search, Upload } from 'lucide-react';
import type {
  InventoryLandingKpis,
  StockLevelRow,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';

interface RosterResponse {
  items: StockLevelRow[];
  page: number;
  pageSize: number;
  total: number;
}

interface KpiResponse {
  data: InventoryLandingKpis;
}

/**
 * Inventory landing — feature 010 / US2.
 *
 * KPI strip backed by `GET /api/v1/admin/inventory`.
 * Per-product roster from `GET /api/v1/admin/inventory/levels`.
 * Per-row edit lands in the product editor's Inventory tab; the import
 * wizard ships in US7.
 */
export function InventoryPage(): ReactNode {
  const [kpis, setKpis] = useState<InventoryLandingKpis | null>(null);
  const [rows, setRows] = useState<StockLevelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out'>('all');
  const { pageSize, setPageSize } = usePageSizePreference('inventory-levels');
  const [page, setPage] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [kpiRes, rosterRes] = await Promise.all([
        apiClient.get<KpiResponse>('/api/v1/admin/inventory'),
        apiClient.get<RosterResponse>(
          `/api/v1/admin/inventory/levels?page=${page}&pageSize=${pageSize}`,
        ),
      ]);
      setKpis(kpiRes.data);
      setRows(rosterRes.items);
      setTotal(rosterRes.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever the user switches list-shape so they
  // never land on an out-of-range page.
  useEffect(() => {
    setPage(0);
  }, [pageSize]);

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === 'out' && !r.isOutOfStock) return false;
      if (statusFilter === 'low' && (!r.isLowStock || r.isOutOfStock)) return false;
      if (t) {
        if (
          !r.productSku.toLowerCase().includes(t) &&
          !r.productName.toLowerCase().includes(t) &&
          !r.productId.toLowerCase().includes(t)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [rows, query, statusFilter]);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">Inventory</div>
          <div className="b2b-page-head__sub">
            Stock per product per warehouse · KPIs are computed live from{' '}
            <code className="b2b-mono">stock_levels</code>.
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <Link
            to="/inventory/import"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Upload size={13} /> Import stock
          </Link>
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

      <div className="b2b-row" style={{ gap: 16, marginBottom: 16 }}>
        <Stat label="Products tracked" value={(kpis?.totalProductsTracked ?? 0).toLocaleString()} />
        <Stat label="Total on hand" value={(kpis?.totalOnHand ?? 0).toLocaleString()} />
        <Stat label="Out of stock" value={String(kpis?.outOfStockCount ?? 0)} tone="danger" />
        <Stat label="Low stock" value={String(kpis?.lowStockCount ?? 0)} tone="warn" />
      </div>

      {kpis && kpis.perWarehouseTotals.length > 0 ? (
        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>Per-warehouse totals</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-row" style={{ gap: 24, flexWrap: 'wrap' }}>
              {kpis.perWarehouseTotals.map((t) => (
                <div key={t.warehouseId}>
                  <div className="b2b-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {t.warehouseCode}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{t.onHand.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder="Search SKU, product name, or ID…"
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'low'}
            label="Low stock"
            onClick={(): void => setStatusFilter((s) => (s === 'low' ? 'all' : 'low'))}
          />
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'out'}
            label="Out of stock"
            onClick={(): void => setStatusFilter((s) => (s === 'out' ? 'all' : 'out'))}
          />
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><Search size={20} /></div>
              <div className="b2b-empty__title">No stock rows match the current filters</div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className="num">Cumulative on hand</th>
                  <th>Per warehouse</th>
                  <th>Display band</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
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
                    <td>
                      <div className="b2b-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                        {r.perWarehouse.map((w) => (
                          <span
                            key={w.warehouseId}
                            className="b2b-badge b2b-badge--muted"
                            title={w.warehouseId}
                          >
                            {w.warehouseCode}: {w.onHand.toLocaleString()}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <span
                        className={cn(
                          'b2b-badge',
                          r.displayBand === 'high' && 'b2b-badge--success',
                          r.displayBand === 'medium' && 'b2b-badge--warn',
                          r.displayBand === 'low' && 'b2b-badge--warn',
                          r.displayBand === 'out_of_stock' && 'b2b-badge--danger',
                          r.displayBand === 'available' && 'b2b-badge--muted',
                        )}
                      >
                        {r.displayBand}
                      </span>
                    </td>
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

        <PaginationFooter
          page={page}
          pageSize={pageSize}
          total={total}
          onPageSizeChange={setPageSize}
          onPrev={(): void => setPage((p) => Math.max(0, p - 1))}
          onNext={(): void => setPage((p) => p + 1)}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'danger';
}): ReactNode {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--fg)';
  return (
    <div className="b2b-card" style={{ flex: 1, padding: 16 }}>
      <div
        className="b2b-muted"
        style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}
      >
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 4, color }}>{value}</div>
    </div>
  );
}

function Chip(props: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      className={cn('b2b-filterchip', props.active && 'is-on')}
      onClick={props.onClick}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}
