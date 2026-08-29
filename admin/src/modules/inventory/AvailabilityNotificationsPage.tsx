import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, Search } from 'lucide-react';
import { scopeNoticeOf, type ScopeNoticeCode } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { ScopeNotice } from '@/components/scope-notice/ScopeNotice';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n/useTranslation';
import { useSurfaceVisibility } from '@/lib/surface-visibility';
import { normalize } from '@/lib/text-normalization';

interface NotificationRow {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  customerAccountId: string | null;
  email: string;
  status: 'queued' | 'notified' | 'cancelled';
  queuedAt: string;
  notifiedAt: string | null;
}

interface ListResponse {
  items: NotificationRow[];
  page: number;
  pageSize: number;
  total: number;
  /**
   * Feature 087 — present only when the server refused every row because these
   * records name no organization. Read with `scopeNoticeOf`.
   */
  meta?: { scopeNotice?: ScopeNoticeCode };
}

/**
 * AvailabilityNotificationsPage — feature 010 / US6 (T070).
 *
 * Admin browser of the back-in-stock queue. Operators can filter by
 * status + product, search by SKU or email, and cancel a queued row.
 */
export function AvailabilityNotificationsPage(): ReactNode {
  const t = useTranslation('core');
  // The screen's own gate (2026-08-29) — see `InventoryPage` for the reasoning
  // in full. The cancel button is the write half: it was `catalog:write` while
  // the list beside it was `orders:read`.
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'inventory', requiredPermission: 'inventory:read' });
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'notified' | 'cancelled'>('queued');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // Why the queue looks empty, when it does (feature 087).
  const [scopeNotice, setScopeNotice] = useState<ScopeNoticeCode | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const search = new URLSearchParams();
      if (statusFilter !== 'all') search.set('status', statusFilter);
      search.set('pageSize', '200');
      const res = await apiClient.get<ListResponse>(
        `/api/v1/admin/inventory/availability-notifications?${search.toString()}`,
      );
      setRows(res.items);
      setScopeNotice(scopeNoticeOf(res));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.availability.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, statusFilter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;
    return rows.filter(
      (r) =>
        normalize(r.productSku).includes(q) ||
        normalize(r.productName).includes(q) ||
        normalize(r.email).includes(q),
    );
  }, [rows, query]);


  const handleCancel = async (id: string): Promise<void> => {
    if (!window.confirm(t('inventory.availability.confirmCancel'))) {
      return;
    }
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await apiClient.patch<unknown>(
        `/api/v1/admin/inventory/availability-notifications/${id}`,
        { status: 'cancelled' },
      );
      setInfo(t('inventory.availability.info.cancelled'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventory.availability.error.cancel'));
    } finally {
      setBusyId(null);
    }
  };

  if (!canRead) {
    return <div className="b2b-page">{t('inventory.noPermission')}</div>;
  }

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">{t('inventory.availability.title')}</div>
          <div className="b2b-page-head__sub">
            {t('inventory.availability.description')}
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
      {info ? (
        <div
          className="b2b-card"
          style={{
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            padding: 12,
            marginBottom: 16,
            border: '1px solid hsl(142 50% 80%)',
          }}
        >
          {info}
        </div>
      ) : null}

      <div className="b2b-card">
        <div className="b2b-filterbar">
          <div className="b2b-filterbar__search">
            <div className="b2b-input-wrap">
              <Search size={16} className="lead" />
              <input
                className="b2b-field b2b-field--addon"
                placeholder={t('inventory.availability.searchPlaceholder')}
                value={query}
                onChange={(e): void => setQuery(e.target.value)}
              />
            </div>
          </div>
          {(['all', 'queued', 'notified', 'cancelled'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={cn('b2b-filterchip', statusFilter === s && 'is-on')}
              onClick={(): void => setStatusFilter(s)}
            >
              <span style={{ textTransform: 'capitalize' }}>{t(`inventory.availability.status.${s}`)}</span>
            </button>
          ))}
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>{t('inventory.loading')}</div>
          ) : filtered.length === 0 ? (
            // The notice replaces the empty state rather than sitting beside
            // it: "no subscriptions match the current filters" is a claim about
            // the data, and it is the false one here.
            scopeNotice ? (
              <div style={{ padding: 16 }}>
                <ScopeNotice notice={scopeNotice} />
              </div>
            ) : (
              <div className="b2b-empty">
                <div className="b2b-empty__icon"><Bell size={20} /></div>
                <div className="b2b-empty__title">{t('inventory.availability.empty')}</div>
              </div>
            )
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>{t('inventory.column.product')}</th>
                  <th>{t('inventory.column.sku')}</th>
                  <th>{t('inventory.availability.column.email')}</th>
                  <th>{t('inventory.availability.column.status')}</th>
                  <th>{t('inventory.availability.column.queued')}</th>
                  <th>{t('inventory.availability.column.notified')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>{r.productName}</td>
                    <td>
                      <span className="b2b-mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                        {r.productSku}
                      </span>
                    </td>
                    <td>{r.email}</td>
                    <td>
                      <span
                        className={cn(
                          'b2b-badge',
                          r.status === 'queued' && 'b2b-badge--warn',
                          r.status === 'notified' && 'b2b-badge--success',
                          r.status === 'cancelled' && 'b2b-badge--muted',
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-muted" style={{ fontSize: 12 }}>
                        {formatDateTime(r.queuedAt)}
                      </span>
                    </td>
                    <td>
                      <span className="b2b-muted" style={{ fontSize: 12 }}>
                        {r.notifiedAt ? formatDateTime(r.notifiedAt) : '—'}
                      </span>
                    </td>
                    <td className="actions">
                      {canWrite && r.status === 'queued' ? (
                        <button
                          type="button"
                          className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                          disabled={busyId === r.id}
                          onClick={(): void => { void handleCancel(r.id); }}
                        >
                          {t('inventory.availability.cancel')}
                        </button>
                      ) : null}
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
