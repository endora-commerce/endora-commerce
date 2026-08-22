import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Warehouse, WarehouseChannelAssignment } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';
import { warehousesClient } from './api/warehouses-client';

interface ListResponse {
  items: WarehouseChannelAssignment[];
}

/**
 * ChannelMembershipPanel — feature 010 / US3 (T046).
 *
 * Lists warehouses bound to the channel, lets the operator add a new
 * binding, demote/promote the default, and unassign non-default rows.
 * Mounted on the SalesChannel detail page.
 */
export function ChannelMembershipPanel({ channelId }: { channelId: string }): ReactNode {
  const t = useTranslation('core');
  const [assignments, setAssignments] = useState<WarehouseChannelAssignment[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingWarehouseId, setPendingWarehouseId] = useState<string>('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [whRes, listRes] = await Promise.all([
        warehousesClient.list({ activeOnly: true, withTotals: false, pageSize: 200 }),
        apiClient.get<ListResponse>(`/api/v1/admin/sales-channels/${channelId}/warehouses`),
      ]);
      setWarehouses(whRes.items);
      setAssignments(listRes.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.channel.error.load'));
    } finally {
      setLoading(false);
    }
  }, [channelId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const assignedIds = new Set(assignments.map((a) => a.warehouseId));
  const candidates = warehouses.filter((w) => !assignedIds.has(w.id));

  const handleAssign = async (): Promise<void> => {
    if (!pendingWarehouseId) return;
    setBusy('assign');
    setError(null);
    try {
      await apiClient.post(
        `/api/v1/admin/sales-channels/${channelId}/warehouses`,
        { warehouseId: pendingWarehouseId },
      );
      setInfo(t('warehouses.channel.info.assigned'));
      setPendingWarehouseId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.channel.error.assign'));
    } finally {
      setBusy(null);
    }
  };

  const handlePromote = async (id: string): Promise<void> => {
    setBusy(id);
    setError(null);
    try {
      await apiClient.patch(
        `/api/v1/admin/sales-channels/${channelId}/warehouses/${id}`,
        { isDefault: true },
      );
      setInfo(t('warehouses.channel.info.defaultChanged'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.channel.error.update'));
    } finally {
      setBusy(null);
    }
  };

  const handleUnassign = async (id: string, isDefault: boolean): Promise<void> => {
    if (isDefault) {
      window.alert(t('warehouses.channel.alert.promoteFirst'));
      return;
    }
    if (!window.confirm(t('warehouses.channel.confirm.unassign'))) return;
    setBusy(id);
    setError(null);
    try {
      await apiClient.delete(`/api/v1/admin/sales-channels/${channelId}/warehouses/${id}`);
      setInfo(t('warehouses.channel.info.removed'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('warehouses.channel.error.unassign'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="b2b-help">{t('warehouses.channel.loading')}</div>;

  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      {error ? (
        <div
          className="b2b-card"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger-soft-fg)', padding: 10 }}
        >
          {error}
        </div>
      ) : null}
      {info ? (
        <div
          className="b2b-card"
          style={{ background: 'var(--success-soft)', color: 'var(--success-soft-fg)', padding: 10 }}
        >
          {info}
        </div>
      ) : null}

      <div className="b2b-card">
        <div className="b2b-card__head"><h2>{t('warehouses.channel.title')}</h2></div>
        <table className="b2b-tbl">
          <thead>
            <tr>
              <th>{t('warehouses.channel.column.warehouse')}</th>
              <th>{t('warehouses.channel.column.code')}</th>
              <th>{t('warehouses.channel.column.default')}</th>
              <th>{t('warehouses.channel.column.sort')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <span className="b2b-muted">{t('warehouses.channel.empty')}</span>
                </td>
              </tr>
            ) : (
              assignments.map((a) => (
                <tr key={a.id}>
                  <td>{a.warehouseName}</td>
                  <td>
                    <span className="b2b-mono" style={{ fontSize: 12 }}>{a.warehouseCode}</span>
                  </td>
                  <td>
                    {a.isDefault ? (
                      <span className="b2b-badge b2b-badge--success">{t('warehouses.channel.defaultBadge')}</span>
                    ) : (
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                        onClick={(): void => { void handlePromote(a.id); }}
                        disabled={busy === a.id}
                      >
                        {t('warehouses.channel.action.makeDefault')}
                      </button>
                    )}
                  </td>
                  <td>{a.sortOrder}</td>
                  <td className="actions">
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      onClick={(): void => { void handleUnassign(a.id, a.isDefault); }}
                      disabled={busy === a.id}
                    >
                      {t('warehouses.channel.action.unassign')}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {candidates.length > 0 ? (
        <div className="b2b-card">
          <div className="b2b-card__head"><h2>{t('warehouses.channel.addTitle')}</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="b2b-label" htmlFor="ch-add-wh">{t('warehouses.channel.field.warehouse')}</label>
                <select
                  id="ch-add-wh"
                  className="b2b-field"
                  value={pendingWarehouseId}
                  onChange={(e): void => setPendingWarehouseId(e.target.value)}
                >
                  <option value="">{t('warehouses.channel.field.pickOne')}</option>
                  {candidates.map((w) => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className="b2b-btn b2b-btn--primary"
                onClick={(): void => { void handleAssign(); }}
                disabled={busy === 'assign' || !pendingWarehouseId}
              >
                {busy === 'assign' ? t('warehouses.channel.action.adding') : t('warehouses.channel.action.add')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
