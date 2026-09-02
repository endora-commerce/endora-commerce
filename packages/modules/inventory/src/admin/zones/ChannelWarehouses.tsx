import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type {
  AdminZoneProps,
  Warehouse,
  WarehouseChannelAssignment,
} from '@endora-commerce/contracts';
import { ApiError, apiClient, useSurfaceVisibility } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

interface ListResponse {
  items: WarehouseChannelAssignment[];
}

interface WarehouseListResponse {
  items: Warehouse[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The warehouses bound to one sales channel (feature 010 / US3, T046).
 *
 * Lists the bindings, lets the operator add one, promote a row to default and
 * unassign a non-default row.
 *
 * ## What moved, and what was rebuilt (feature 091, P7c)
 *
 * The file lived at `admin/src/modules/warehouses/ChannelMembershipPanel.tsx`
 * — `warehouses/`, not `inventory/`; the nav attributes `/warehouses` to
 * `module: 'inventory'`, which is why the boundary ledger keyed it
 * `inventory/ChannelMembershipPanel`. `sales_channels`' edit screen imported it
 * by path, the single key in
 * `backend/scripts/ledgers/cross-module-imports/sales_channels.ts`; that screen
 * renders `sales_channel.editor.after` now and this module declares the
 * contribution.
 *
 * Its warehouse read used `admin/src/modules/warehouses/api/warehouses-client`,
 * which is still the admin application's file, so moving this one alone would
 * have made a package reach back into `admin/src`. Both of its reads are HTTP
 * paths whose types are already `@endora-commerce/contracts`', so they are
 * rebuilt from the published `apiClient` — P2's exit, and no new reach.
 *
 * ## The read gate went; the write gate stayed
 *
 * The zone renderer applies both presence axes **and** the contribution's
 * declared `inventory:read` before it touches `React.lazy` (§4), so asking
 * again here would be the same question twice — and the second answer would be
 * the one nobody maintains. `canWrite` stays: a contribution declares one code,
 * and this panel offers a read view and write actions behind two.
 */
export type ChannelWarehousesProps = AdminZoneProps<'sales_channel.editor.after'>;

export function ChannelWarehouses({ channelId }: ChannelWarehousesProps): ReactNode {
  const t = useTranslation('core');
  const isVisible = useSurfaceVisibility();
  const canWrite = isVisible({ module: 'inventory', requiredPermission: 'inventory:write' });
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
        apiClient.get<WarehouseListResponse>(
          '/api/v1/admin/warehouses?pageSize=200&activeOnly=true&withTotals=false',
        ),
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

  // The read gate that used to stand here is the zone renderer's now — absent,
  // not disabled and not a 403 panel, decided before this chunk is fetched.
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
                    ) : !canWrite ? (
                      // Read-only: the row is simply not the default. Rendering
                      // the promote button disabled would advertise a
                      // capability; rendering the badge would misstate the row.
                      <span className="b2b-muted">—</span>
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
                    {canWrite ? (
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                        onClick={(): void => { void handleUnassign(a.id, a.isDefault); }}
                        disabled={busy === a.id}
                      >
                        {t('warehouses.channel.action.unassign')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canWrite && candidates.length > 0 ? (
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

/**
 * The zone renderer loads a contribution through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own tests use.
 */
export default ChannelWarehouses;
