import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Search, Upload } from 'lucide-react';
import type {
  InventoryLandingKpis,
  StockLevelRow,
} from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { PaginationFooter } from '@/components/PaginationFooter';
import { usePageSizePreference } from '@/lib/use-page-size-preference';
import { useTranslation } from '@/i18n/useTranslation';

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
  const t = useTranslation('core');
  const [searchParams] = useSearchParams();
  const [kpis, setKpis] = useState<InventoryLandingKpis | null>(null);
  const [rows, setRows] = useState<StockLevelRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'low' | 'out'>(() => {
    const fromUrl = searchParams.get('stock');
    return fromUrl === 'low' || fromUrl === 'out' ? fromUrl : 'all';
  });
  const { pageSize, setPageSize } = usePageSizePreference('inventory-levels');
  const [page, setPage] = useState(0);

  // Debounce the text query so typing doesn't fire a fetch on every
  // keystroke. 250 ms feels live but coalesces typing bursts.
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(query), 250);
    return (): void => window.clearTimeout(id);
  }, [query]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const trimmed = debouncedQuery.trim();
      if (trimmed) params.set('q', trimmed);
      if (statusFilter === 'low') params.set('low', '1');
      else if (statusFilter === 'out') params.set('out', '1');
      const [kpiRes, rosterRes] = await Promise.all([
        apiClient.get<KpiResponse>('/api/v1/admin/inventory'),
        apiClient.get<RosterResponse>(
          `/api/v1/admin/inventory/levels?${params.toString()}`,
        ),
      ]);
      setKpis(kpiRes.data);
      setRows(rosterRes.items);
      setTotal(rosterRes.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.error.load'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedQuery, statusFilter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Reset to the first page whenever the result-shaping inputs change so
  // the user never lands on an out-of-range page.
  useEffect(() => {
    setPage(0);
  }, [pageSize, debouncedQuery, statusFilter]);

  // Filters are server-side now; rows arrive pre-filtered and pre-paginated.
  const filtered = rows;

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('inventory.page.title')}</div>
          <div className="b2b-page-head__sub">
            {t('inventory.page.subPrefix')}{' '}
            <code className="b2b-mono">stock_levels</code>{t('inventory.page.subSuffix')}
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <Link
            to="/inventory/import"
            className="b2b-btn b2b-btn--default b2b-btn--sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Upload size={13} /> {t('inventory.action.import')}
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
        <Stat label={t('inventory.stat.tracked')} value={(kpis?.totalProductsTracked ?? 0).toLocaleString()} />
        <Stat label={t('inventory.stat.totalOnHand')} value={(kpis?.totalOnHand ?? 0).toLocaleString()} />
        <Stat label={t('inventory.stat.outOfStock')} value={String(kpis?.outOfStockCount ?? 0)} tone="danger" />
        <Stat label={t('inventory.stat.lowStock')} value={String(kpis?.lowStockCount ?? 0)} tone="warn" />
      </div>

      {kpis && kpis.perWarehouseTotals.length > 0 ? (
        <div className="b2b-card" style={{ marginBottom: 16 }}>
          <div className="b2b-card__head"><h2>{t('inventory.perWarehouseTotals')}</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-row" style={{ gap: 24, flexWrap: 'wrap' }}>
              {kpis.perWarehouseTotals.map((row) => (
                <div key={row.warehouseId}>
                  <div className="b2b-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                    {row.warehouseCode}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 600 }}>{row.onHand.toLocaleString()}</div>
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
                placeholder={t('inventory.search.placeholder')}
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'low'}
            label={t('inventory.stat.lowStock')}
            onClick={(): void => setStatusFilter((s) => (s === 'low' ? 'all' : 'low'))}
          />
          <Chip
            icon={<AlertCircle size={12} />}
            active={statusFilter === 'out'}
            label={t('inventory.stat.outOfStock')}
            onClick={(): void => setStatusFilter((s) => (s === 'out' ? 'all' : 'out'))}
          />
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('inventory.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><Search size={20} /></div>
              <div className="b2b-empty__title">{t('inventory.empty')}</div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{t('inventory.column.product')}</th>
                  <th>{t('inventory.column.sku')}</th>
                  <th className="num">{t('inventory.column.cumulativeOnHand')}</th>
                  <th>{t('inventory.column.perWarehouse')}</th>
                  <th>{t('inventory.column.displayBand')}</th>
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
                        {t('inventory.action.editStock')}
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
