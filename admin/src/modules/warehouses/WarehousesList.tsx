import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Warehouse } from '@b2b/contracts';
import { Plus, Search, Warehouse as WarehouseIcon } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { warehousesClient } from './api/warehouses-client';
import { normalize } from '@/lib/text-normalization';

/**
 * WarehousesList — admin landing for warehouse identity (feature 010 / US1).
 */
export function WarehousesList(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeOnly, setActiveOnly] = useState(false);
  const [query, setQuery] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await warehousesClient.list({ activeOnly, withTotals: true });
      setRows(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.error.load'));
    } finally {
      setLoading(false);
    }
  }, [activeOnly, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        normalize(r.code).includes(q) ||
        normalize(r.name).includes(q),
    );
  }, [rows, query]);

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('warehouses.page.title')}</div>
          <div className="b2b-page-head__sub">
            {t('warehouses.page.sub.prefix')} <code className="b2b-mono">default</code> {t('warehouses.page.sub.suffix')}
          </div>
        </div>
        <div className="b2b-page-head__actions">
          <Link to="/warehouses/new" className="b2b-btn b2b-btn--primary">
            <Plus size={14} /> {t('warehouses.action.new')}
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

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder={t('warehouses.search.placeholder')}
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          <label className="b2b-row" style={{ gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={activeOnly}
              onChange={(e): void => setActiveOnly(e.target.checked)}
            />
            {t('warehouses.filter.activeOnly')}
          </label>
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('warehouses.loading')}</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><WarehouseIcon size={20} /></div>
              <div className="b2b-empty__title">{t('warehouses.empty')}</div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{t('warehouses.column.code')}</th>
                  <th>{t('warehouses.column.name')}</th>
                  <th className="num">{t('warehouses.column.products')}</th>
                  <th className="num">{t('warehouses.column.onHand')}</th>
                  <th className="num">{t('warehouses.column.defaultFor')}</th>
                  <th>{t('warehouses.column.status')}</th>
                  <th>{t('warehouses.column.updated')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        to={`/warehouses/${r.id}`}
                        className="b2b-mono"
                        style={{ fontSize: 12 }}
                      >
                        {r.code}
                      </Link>
                    </td>
                    <td>{r.name}</td>
                    <td className="num b2b-tabular">{r.totals?.products?.toLocaleString() ?? '—'}</td>
                    <td className="num b2b-tabular">{r.totals?.onHand?.toLocaleString() ?? '—'}</td>
                    <td className="num b2b-tabular">{r.totals?.isDefaultForChannelCount ?? '—'}</td>
                    <td>
                      <span className={cn('b2b-badge', r.active ? 'b2b-badge--success' : 'b2b-badge--muted')}>
                        {r.active ? t('warehouses.status.active') : t('warehouses.status.inactive')}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-muted" style={{ fontSize: 12 }}>
                        {formatDateTime(r.updatedAt)}
                      </span>
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
