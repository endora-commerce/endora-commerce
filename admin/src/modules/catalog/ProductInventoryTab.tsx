import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StockLevelRow, Warehouse } from '@b2b/contracts';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

interface RosterResponse {
  items: StockLevelRow[];
}
interface WarehousesResponse {
  items: Warehouse[];
}
interface SetStockResponse {
  data: { before: number; after: number; productId: string; warehouseId: string };
}

/**
 * Per-product Inventory tab — feature 010 / US2 (T040).
 *
 * Lists every active warehouse with its current on-hand for the product.
 * Each row has an inline editor that calls
 * `PUT /api/v1/admin/inventory/levels` with the (product, warehouse) pair.
 */
export function ProductInventoryTab({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [perWarehouse, setPerWarehouse] = useState<Map<string, number>>(new Map());
  const [draft, setDraft] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [whRes, rosterRes] = await Promise.all([
        apiClient.get<WarehousesResponse>('/api/v1/admin/warehouses?activeOnly=true&pageSize=200'),
        apiClient.get<RosterResponse>(`/api/v1/admin/inventory/levels?productId=${productId}`),
      ]);
      setWarehouses(whRes.items);
      const map = new Map<string, number>();
      const row = rosterRes.items[0];
      if (row) {
        for (const pw of row.perWarehouse) map.set(pw.warehouseId, pw.onHand);
      }
      setPerWarehouse(map);
      const initialDraft = new Map<string, string>();
      for (const w of whRes.items) {
        initialDraft.set(w.id, String(map.get(w.id) ?? 0));
      }
      setDraft(initialDraft);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load warehouses.');
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const totalOnHand = useMemo(() => {
    let s = 0;
    for (const v of perWarehouse.values()) s += v;
    return s;
  }, [perWarehouse]);

  const handleSave = async (warehouseId: string): Promise<void> => {
    const raw = draft.get(warehouseId) ?? '0';
    const onHand = Math.max(0, Number.parseInt(raw, 10) || 0);
    setSaving(warehouseId);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.put<SetStockResponse>('/api/v1/admin/inventory/levels', {
        productId,
        warehouseId,
        onHand,
      });
      setPerWarehouse((prev) => {
        const next = new Map(prev);
        next.set(warehouseId, res.data.after);
        return next;
      });
      setInfo(t('inventoryTab.success.save', { value: res.data.after }));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventoryTab.error.save'));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="b2b-help">{t('inventoryTab.loading')}</div>;

  return (
    <div className="b2b-col" style={{ gap: 16 }}>
      <div className="b2b-card" style={{ padding: 12 }}>
        <div className="b2b-row" style={{ gap: 16 }}>
          <div>
            <div className="b2b-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
              {t('inventoryTab.summary.cumulativeOnHand')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{totalOnHand.toLocaleString()}</div>
          </div>
          <div>
            <div className="b2b-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
              {t('inventoryTab.summary.activeWarehouses')}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{warehouses.length}</div>
          </div>
        </div>
      </div>

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
        <div className="b2b-card__head"><h2>{t('inventoryTab.table.title')}</h2></div>
        <table className="b2b-tbl">
          <thead>
            <tr>
              <th>{t('inventoryTab.column.warehouse')}</th>
              <th>{t('inventoryTab.column.code')}</th>
              <th className="num">{t('inventoryTab.column.onHand')}</th>
              <th className="num">{t('inventoryTab.column.newValue')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => {
              const current = perWarehouse.get(w.id) ?? 0;
              return (
                <tr key={w.id}>
                  <td>{w.name}</td>
                  <td>
                    <span className="b2b-mono" style={{ fontSize: 12 }}>{w.code}</span>
                  </td>
                  <td className="num b2b-tabular">{current.toLocaleString()}</td>
                  <td>
                    <input
                      className="b2b-field"
                      type="number"
                      min="0"
                      style={{ width: 100, textAlign: 'right' }}
                      value={draft.get(w.id) ?? '0'}
                      onChange={(e): void =>
                        setDraft((prev) => {
                          const next = new Map(prev);
                          next.set(w.id, e.target.value);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="actions">
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--primary b2b-btn--sm"
                      onClick={(): void => { void handleSave(w.id); }}
                      disabled={saving === w.id}
                    >
                      {saving === w.id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
