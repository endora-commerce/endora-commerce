import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  FulfilmentStrategy,
  GlobalOnlyProductFields,
  SettingDto,
  StockLevelRow,
  Warehouse,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { FulfilmentStrategyPicker } from '@endora-commerce/admin-kit/components';
import type { FulfilmentStrategyValue } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useProductEditor } from './editor/editor-context.js';
import { ImmediateBadge } from './editor/ImmediateBadge.js';

/**
 * Read one setting by code (feature 091, P6).
 *
 * The request is built here rather than through `settings`' own admin API
 * client: that client is another module's **code**, which is what the
 * cross-module ledger recorded, while `/api/v1/admin/settings/:code` and
 * `SettingDto` are an HTTP path and a `@endora-commerce/contracts` type that
 * both sides already compile. That is the exit P2 established and
 * `admin-kit-surface.md` R6 records — one `GET` out of that client's eleven
 * methods, and no dependency on the owner's code.
 */
function readSetting(code: string): Promise<SettingDto> {
  return apiClient.get<SettingDto>(`/api/v1/admin/settings/${encodeURIComponent(code)}`);
}

interface RosterResponse {
  items: StockLevelRow[];
}
interface WarehousesResponse {
  items: Warehouse[];
}
interface SetStockResponse {
  data: { before: number; after: number; productId: string; warehouseId: string };
}
type ThresholdMode = 'cumulative' | 'per_warehouse';

/** The product-row settings this tab stages into the editor's one Save (feature 180, FR-025). */
type RowField = Extract<
  keyof GlobalOnlyProductFields,
  | 'manageStock'
  | 'backorderEnabled'
  | 'lowStockThreshold'
  | 'lowStockThresholdMode'
  | 'fulfilmentStrategy'
  | 'fulfilmentStrategyWarehouseOrder'
>;

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/**
 * Per-product Inventory tab — feature 010 / US2.
 *
 * Two threshold modes:
 *   - `cumulative` (default): one product-level threshold against the
 *     summed on-hand across every warehouse holding the product.
 *   - `per_warehouse`: each warehouse evaluated against its own threshold
 *     (per-(product, warehouse) row, falling back to the warehouse default).
 *
 * **Feature 180 (FR-025, owner ruling OQ-7 = B).** The product-row settings —
 * stock management, backorders, the low-stock threshold and its mode, the
 * fulfilment strategy — are staged Global cells (`product:<field>`) of the
 * product editor's own write: the one Save sends them in its
 * `PUT …/scoped-values` (`changes.product`), which the scoped-values contract
 * already carries (research R22). They are read from the editor's scoped read,
 * not from a second product request. Per-warehouse stock levels and thresholds
 * stay immediate — each its own audited `inventory` write — under an
 * "Applies immediately" badge.
 */
export function ProductInventoryTab({ productId, editable = true }: { productId: string; editable?: boolean }): ReactNode {
  const t = useTranslation('catalog');
  const editor = useProductEditor();
  const saved = editor.state.data?.product ?? null;
  /** The value a product-row setting has on the page: staged, else saved. */
  const valueOf = <F extends RowField>(field: F): GlobalOnlyProductFields[F] | null => {
    const op = editor.state.staged.get(`product:${field}`);
    if (op?.op === 'set') return op.value as GlobalOnlyProductFields[F];
    return (saved?.[field] ?? null) as GlobalOnlyProductFields[F] | null;
  };
  /** Stage a product-row setting; setting it back to the saved value unstages it. */
  const stage = (field: RowField, value: unknown): void => {
    const path = `product:${field}`;
    editor.dispatch({
      type: 'stage',
      path,
      op: saved !== null && sameValue(value, saved[field]) ? undefined : { op: 'set', value },
    });
  };
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
  const [allowNegativeGlobal, setAllowNegativeGlobal] = useState(false);
  const manageStock = valueOf('manageStock') ?? true;
  const backorderEnabled = valueOf('backorderEnabled') ?? false;
  const mode: ThresholdMode = valueOf('lowStockThresholdMode') ?? 'cumulative';
  const threshold = valueOf('lowStockThreshold');
  const lowStockThreshold = threshold === null || threshold === undefined ? '' : String(threshold);
  const fulfilment: FulfilmentStrategyValue = {
    strategy: (valueOf('fulfilmentStrategy') ?? null) as FulfilmentStrategy | null,
    warehouseOrder: valueOf('fulfilmentStrategyWarehouseOrder') ?? [],
  };

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [whRes, rosterRes, allowNegativeSetting] = await Promise.all([
        apiClient.get<WarehousesResponse>('/api/v1/admin/warehouses?activeOnly=true&pageSize=200'),
        apiClient.get<RosterResponse>(`/api/v1/admin/inventory/levels?productId=${productId}`),
        readSetting('inventory.allow_negative_stock').catch(() => null),
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
      if (allowNegativeSetting) {
        const effective = allowNegativeSetting.globalValue ?? allowNegativeSetting.defaultValue;
        setAllowNegativeGlobal(effective === true);
      }
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

  const setFulfilment = (next: FulfilmentStrategyValue): void => {
    stage('fulfilmentStrategy', next.strategy);
    stage('fulfilmentStrategyWarehouseOrder', next.strategy === 'defined_order' ? next.warehouseOrder : null);
  };

  const setLowStockThreshold = (text: string): void => {
    const trimmed = text.trim();
    stage('lowStockThreshold', trimmed === '' ? null : Math.max(0, Number.parseInt(trimmed, 10) || 0));
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
      <div className="b2b-card">
        <div className="b2b-card__head">
          <h2>{t('inventoryTab.stockMgmt.title')}</h2>
        </div>
        <div className="b2b-card__body b2b-col" style={{ gap: 12 }}>
          <label className="b2b-row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={!manageStock}
              onChange={(e): void => stage('manageStock', !e.target.checked)}
            />
            <span>
              <div>{t('inventoryTab.stockMgmt.disableManageStock')}</div>
              <div className="b2b-help">{t('inventoryTab.stockMgmt.disableManageStockHelp')}</div>
            </span>
          </label>

          <label className="b2b-row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              type="checkbox"
              checked={backorderEnabled}
              disabled={manageStock === false || !allowNegativeGlobal}
              onChange={(e): void => stage('backorderEnabled', e.target.checked)}
            />
            <span>
              <div>{t('inventoryTab.stockMgmt.backorder')}</div>
              <div className="b2b-help">
                {!allowNegativeGlobal
                  ? t('inventoryTab.stockMgmt.backorderGloballyDisabled')
                  : manageStock === false
                    ? t('inventoryTab.stockMgmt.backorderUnmanaged')
                    : t('inventoryTab.stockMgmt.backorderHelp')}
              </div>
            </span>
          </label>
        </div>
      </div>

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
                onChange={(): void => stage('lowStockThresholdMode', 'cumulative')}
              />
              {t('inventoryTab.lowStock.modeCumulative')}
            </label>
            <label className="b2b-row" style={{ gap: 6, alignItems: 'center' }}>
              <input
                type="radio"
                name={`low-stock-mode-${productId}`}
                checked={mode === 'per_warehouse'}
                onChange={(): void => stage('lowStockThresholdMode', 'per_warehouse')}
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
                    aria-label={t('inventoryTab.lowStock.title')}
                    value={lowStockThreshold}
                    placeholder={t('inventoryTab.lowStock.placeholder')}
                    onChange={(e): void => setLowStockThreshold(e.target.value)}
                  />
                </div>
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

      <div className="b2b-card">
        <div className="b2b-card__head">
          <h2>{t('inventoryTab.fulfilment.title')}</h2>
        </div>
        <div className="b2b-card__body">
          <FulfilmentStrategyPicker
            value={fulfilment}
            onChange={setFulfilment}
            warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
            allowInherit
            idPrefix={`product-${productId}`}
          />
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
        {/* Per-warehouse stock and thresholds write at once, each its own audited command. */}
        <div className="b2b-card__head">
          <h2>
            {t('inventoryTab.table.title')}
            {editable ? <ImmediateBadge /> : null}
          </h2>
        </div>
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
