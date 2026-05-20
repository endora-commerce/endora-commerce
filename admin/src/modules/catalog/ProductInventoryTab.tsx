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
interface AdminProductResponse {
  data: {
    id: string;
    lowStockThreshold: number | null;
    lowStockThresholdMode: 'cumulative' | 'per_warehouse';
  };
}

type ThresholdMode = 'cumulative' | 'per_warehouse';

/**
 * Per-product Inventory tab — feature 010 / US2.
 *
 * Two threshold modes:
 *   - `cumulative` (default): one product-level threshold against the
 *     summed on-hand across every warehouse holding the product.
 *   - `per_warehouse`: each warehouse evaluated against its own threshold
 *     (per-(product, warehouse) row, falling back to the warehouse default).
 */
export function ProductInventoryTab({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [perWarehouse, setPerWarehouse] = useState<Map<string, number>>(new Map());
  const [perWarehouseThreshold, setPerWarehouseThreshold] = useState<
    Map<string, number | null>
  >(new Map());
  const [thresholdDraft, setThresholdDraft] = useState<Map<string, string>>(new Map());
  const [draft, setDraft] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [savingThreshold, setSavingThreshold] = useState<string | null>(null);
  const [lowStockThreshold, setLowStockThreshold] = useState<string>('');
  const [lowStockSaving, setLowStockSaving] = useState(false);
  const [mode, setMode] = useState<ThresholdMode>('cumulative');
  const [modeSaving, setModeSaving] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [whRes, rosterRes, productRes] = await Promise.all([
        apiClient.get<WarehousesResponse>('/api/v1/admin/warehouses?activeOnly=true&pageSize=200'),
        apiClient.get<RosterResponse>(`/api/v1/admin/inventory/levels?productId=${productId}`),
        apiClient.get<AdminProductResponse>(`/api/v1/admin/catalog/products/${productId}`),
      ]);
      setWarehouses(whRes.items);
      const onHandMap = new Map<string, number>();
      const thresholdMap = new Map<string, number | null>();
      const row = rosterRes.items[0];
      if (row) {
        for (const pw of row.perWarehouse) {
          onHandMap.set(pw.warehouseId, pw.onHand);
          thresholdMap.set(pw.warehouseId, pw.lowStockThreshold);
        }
      }
      setPerWarehouse(onHandMap);
      setPerWarehouseThreshold(thresholdMap);
      const initialOnHand = new Map<string, string>();
      const initialThreshold = new Map<string, string>();
      for (const w of whRes.items) {
        initialOnHand.set(w.id, String(onHandMap.get(w.id) ?? 0));
        const tv = thresholdMap.get(w.id);
        initialThreshold.set(w.id, tv == null ? '' : String(tv));
      }
      setDraft(initialOnHand);
      setThresholdDraft(initialThreshold);
      setLowStockThreshold(
        productRes.data.lowStockThreshold == null
          ? ''
          : String(productRes.data.lowStockThreshold),
      );
      setMode(productRes.data.lowStockThresholdMode);
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

  const handleModeChange = async (next: ThresholdMode): Promise<void> => {
    if (next === mode) return;
    setModeSaving(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.patch(`/api/v1/admin/catalog/products/${productId}`, {
        lowStockThresholdMode: next,
      });
      setMode(next);
      setInfo(t('inventoryTab.lowStock.modeSaved'));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('inventoryTab.lowStock.error'),
      );
    } finally {
      setModeSaving(false);
    }
  };

  const handleSaveLowStock = async (): Promise<void> => {
    setLowStockSaving(true);
    setError(null);
    setInfo(null);
    try {
      const trimmed = lowStockThreshold.trim();
      const value =
        trimmed === '' ? null : Math.max(0, Number.parseInt(trimmed, 10) || 0);
      await apiClient.patch(`/api/v1/admin/catalog/products/${productId}`, {
        lowStockThreshold: value,
      });
      setInfo(t('inventoryTab.lowStock.success'));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('inventoryTab.lowStock.error'),
      );
    } finally {
      setLowStockSaving(false);
    }
  };

  const handleSaveWarehouseThreshold = async (warehouseId: string): Promise<void> => {
    const raw = thresholdDraft.get(warehouseId) ?? '';
    const trimmed = raw.trim();
    const threshold = trimmed === '' ? null : Math.max(0, Number.parseInt(trimmed, 10) || 0);
    setSavingThreshold(warehouseId);
    setError(null);
    setInfo(null);
    try {
      await apiClient.put('/api/v1/admin/inventory/warehouse-low-stock-thresholds', {
        productId,
        thresholds: [{ warehouseId, threshold }],
      });
      setPerWarehouseThreshold((prev) => {
        const next = new Map(prev);
        next.set(warehouseId, threshold);
        return next;
      });
      setInfo(t('inventoryTab.lowStock.perWarehouseSaved'));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.envelope.error.message
          : t('inventoryTab.lowStock.error'),
      );
    } finally {
      setSavingThreshold(null);
    }
  };

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

      <div className="b2b-card">
        <div className="b2b-card__head">
          <h2>{t('inventoryTab.lowStock.title')}</h2>
        </div>
        <div className="b2b-card__body">
          <div className="b2b-row" style={{ gap: 16, alignItems: 'flex-start', marginBottom: 12 }}>
            <label className="b2b-row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name={`low-stock-mode-${productId}`}
                checked={mode === 'cumulative'}
                disabled={modeSaving}
                onChange={(): void => { void handleModeChange('cumulative'); }}
              />
              {t('inventoryTab.lowStock.modeCumulative')}
            </label>
            <label className="b2b-row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name={`low-stock-mode-${productId}`}
                checked={mode === 'per_warehouse'}
                disabled={modeSaving}
                onChange={(): void => { void handleModeChange('per_warehouse'); }}
              />
              {t('inventoryTab.lowStock.modePerWarehouse')}
            </label>
          </div>

          {mode === 'cumulative' ? (
            <>
              <div className="b2b-row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <div style={{ minWidth: 220 }}>
                  <input
                    className="b2b-field"
                    type="number"
                    min="0"
                    value={lowStockThreshold}
                    placeholder={t('inventoryTab.lowStock.placeholder')}
                    onChange={(e): void => setLowStockThreshold(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="b2b-btn b2b-btn--primary b2b-btn--sm"
                  onClick={(): void => { void handleSaveLowStock(); }}
                  disabled={lowStockSaving}
                >
                  {lowStockSaving
                    ? t('inventoryTab.lowStock.saving')
                    : t('inventoryTab.lowStock.save')}
                </button>
              </div>
              <div className="b2b-help" style={{ marginTop: 6 }}>
                {t('inventoryTab.lowStock.help')}
              </div>
            </>
          ) : (
            <div className="b2b-help">
              {t('inventoryTab.lowStock.perWarehouseHelp')}
            </div>
          )}
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
              {mode === 'per_warehouse' ? (
                <>
                  <th className="num">{t('inventoryTab.column.threshold')}</th>
                  <th />
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {warehouses.map((w) => {
              const current = perWarehouse.get(w.id) ?? 0;
              const resolvedThreshold = perWarehouseThreshold.get(w.id) ?? null;
              const draftValue = thresholdDraft.get(w.id) ?? '';
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
                  {mode === 'per_warehouse' ? (
                    <>
                      <td>
                        <input
                          className="b2b-field"
                          type="number"
                          min="0"
                          style={{ width: 110, textAlign: 'right' }}
                          value={draftValue}
                          placeholder={
                            resolvedThreshold != null
                              ? String(resolvedThreshold)
                              : t('inventoryTab.lowStock.perWarehousePlaceholder')
                          }
                          onChange={(e): void =>
                            setThresholdDraft((prev) => {
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
                          className="b2b-btn b2b-btn--default b2b-btn--sm"
                          onClick={(): void => { void handleSaveWarehouseThreshold(w.id); }}
                          disabled={savingThreshold === w.id}
                        >
                          {savingThreshold === w.id
                            ? t('inventoryTab.lowStock.saving')
                            : t('inventoryTab.lowStock.save')}
                        </button>
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
