import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bell, Search } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

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
}

/**
 * AvailabilityNotificationsPage — feature 010 / US6 (T070).
 *
 * Admin browser of the back-in-stock queue. Operators can filter by
 * status + product, search by SKU or email, and cancel a queued row.
 */
export function AvailabilityNotificationsPage(): ReactNode {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'notified' | 'cancelled'>('queued');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
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
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(
      (r) =>
        r.productSku.toLowerCase().includes(t) ||
        r.productName.toLowerCase().includes(t) ||
        r.email.toLowerCase().includes(t),
    );
  }, [rows, query]);

  const handleCancel = async (id: string): Promise<void> => {
    if (!window.confirm('Cancel this subscription? The customer will no longer receive a back-in-stock email.')) {
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
      setInfo('Subscription cancelled.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Cancel failed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="b2b-page b2b-page--wide">
      <div className="b2b-page-head">
        <div className="b2b-grow">
          <div className="b2b-page-head__title">Notify-when-available</div>
          <div className="b2b-page-head__sub">
            Customer subscriptions for back-in-stock alerts. Restock fan-out fires automatically when cumulative on-hand crosses 0 → &gt; 0.
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
                placeholder="Search SKU, product, or email…"
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
              <span style={{ textTransform: 'capitalize' }}>{s}</span>
            </button>
          ))}
        </div>

        <div className="b2b-card__body b2b-card__body--flush">
          {loading ? (
            <div style={{ padding: 32, color: 'var(--fg-muted)', fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="b2b-empty">
              <div className="b2b-empty__icon"><Bell size={20} /></div>
              <div className="b2b-empty__title">No subscriptions match the current filters</div>
            </div>
          ) : (
            <table className="b2b-tbl">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Queued</th>
                  <th>Notified</th>
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
                      {r.status === 'queued' ? (
                        <button
                          type="button"
                          className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                          disabled={busyId === r.id}
                          onClick={(): void => { void handleCancel(r.id); }}
                        >
                          Cancel
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
