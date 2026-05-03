import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Warehouse, WarehouseChannelAssignment } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
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
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [channelId]);

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
      setInfo('Warehouse assigned.');
      setPendingWarehouseId('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Assign failed.');
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
      setInfo('Default warehouse changed.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Update failed.');
    } finally {
      setBusy(null);
    }
  };

  const handleUnassign = async (id: string, isDefault: boolean): Promise<void> => {
    if (isDefault) {
      window.alert('Promote another warehouse to default before unassigning the current default.');
      return;
    }
    if (!window.confirm('Unassign this warehouse from the channel?')) return;
    setBusy(id);
    setError(null);
    try {
      await apiClient.delete(`/api/v1/admin/sales-channels/${channelId}/warehouses/${id}`);
      setInfo('Assignment removed.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Unassign failed.');
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="b2b-help">Loading channel warehouses…</div>;

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
        <div className="b2b-card__head"><h2>Warehouses for this channel</h2></div>
        <table className="b2b-tbl">
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Code</th>
              <th>Default</th>
              <th>Sort</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {assignments.length === 0 ? (
              <tr>
                <td colSpan={5}>
                  <span className="b2b-muted">No warehouses bound to this channel yet.</span>
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
                      <span className="b2b-badge b2b-badge--success">Default</span>
                    ) : (
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                        onClick={(): void => { void handlePromote(a.id); }}
                        disabled={busy === a.id}
                      >
                        Make default
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
                      Unassign
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
          <div className="b2b-card__head"><h2>Add warehouse</h2></div>
          <div className="b2b-card__body">
            <div className="b2b-row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label className="b2b-label" htmlFor="ch-add-wh">Warehouse</label>
                <select
                  id="ch-add-wh"
                  className="b2b-field"
                  value={pendingWarehouseId}
                  onChange={(e): void => setPendingWarehouseId(e.target.value)}
                >
                  <option value="">— pick one —</option>
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
                {busy === 'assign' ? 'Adding…' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
