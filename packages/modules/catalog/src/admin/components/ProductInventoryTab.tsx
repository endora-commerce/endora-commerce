import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  FulfilmentStrategy,
  GlobalOnlyProductFields,
  SettingDto,
  StockLevelRow,
  Warehouse,
} from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { FulfilmentStrategyPicker, ImmediateBadge } from '@endora-commerce/admin-kit/components';
import type { FulfilmentStrategyValue } from '@endora-commerce/admin-kit/components';
import { Alert, Button, EditorSection, InlineStatus, SettingRow, Switch, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { useProductEditor } from './editor/editor-context.js';

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
/** Sentinel for the load failure without a server message; see `refresh`. */
const LOAD_FAILED = Symbol('inventoryTab.error.load');

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
 *
 * **Issue #1454 (UX audit CAT-01).** Because those rows write at once, each has
 * an `outline` "Apply" rather than a filled "Save": the editor's one Save stays
 * the only primary on the page (Von Restorff, DS-07 #1441). Every row input is
 * named after its warehouse, the row's button says busy while its write is in
 * flight, a result is announced through an always-mounted `InlineStatus`, and a
 * failure is an `Alert`. Stock tracking is a positive "Track stock" switch.
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
  const [error, setError] = useState<string | typeof LOAD_FAILED | null>(null);
  const status = useInlineStatus();
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
      // A key, not `t(…)`: translating here would put `t` in this callback's dependencies, and a
      // late-arriving bundle would refetch and drop the operator's drafts. Translated at render.
      setError(err instanceof ApiError ? err.envelope.error.message : LOAD_FAILED);
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

  /** A threshold draft as the value it would write: empty is "inherit", anything else a non-negative integer. */
  const thresholdFromDraft = (raw: string): number | null => {
    const trimmed = raw.trim();
    return trimmed === '' ? null : Math.max(0, Number.parseInt(trimmed, 10) || 0);
  };
  const onHandFromDraft = (raw: string): number => Math.max(0, Number.parseInt(raw, 10) || 0);

  const handleSaveWarehouseThreshold = async (warehouse: Warehouse): Promise<void> => {
    const warehouseId = warehouse.id;
    const threshold = thresholdFromDraft(thresholdDraft.get(warehouseId) ?? '');
    setSavingThreshold(warehouseId);
    setError(null);
    status.clear();
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
      status.show(t('inventoryTab.lowStock.perWarehouseSaved', { warehouse: warehouse.name }));
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

  const handleSave = async (warehouse: Warehouse): Promise<void> => {
    const warehouseId = warehouse.id;
    const onHand = onHandFromDraft(draft.get(warehouseId) ?? '0');
    setSaving(warehouseId);
    setError(null);
    status.clear();
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
      status.show(t('inventoryTab.success.save', { warehouse: warehouse.name, value: res.data.after }));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('inventoryTab.error.save'));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="b2b-help">{t('inventoryTab.loading')}</div>;

  return (
    // Issue #1488 (CAT-06): sections of the editor's card, not cards inside it. A fragment, so
    // they are siblings of the tab's other sections and take the rule between them.
    <>
      <EditorSection title={t('inventoryTab.stockMgmt.title')}>
        {/* A positive state, not "Disable stock management" checked when it is off (Mental Model). */}
        <SettingRow label={t('inventoryTab.stockMgmt.trackStock')}>
          <Switch checked={manageStock} onCheckedChange={(next): void => stage('manageStock', next)} />
        </SettingRow>
        <SettingRow
          label={t('inventoryTab.stockMgmt.backorder')}
          description={
            !allowNegativeGlobal
              ? t('inventoryTab.stockMgmt.backorderGloballyDisabled')
              : !manageStock
                ? t('inventoryTab.stockMgmt.backorderUnmanaged')
                : t('inventoryTab.stockMgmt.backorderHelp')
          }
        >
          {/* The reason it is unavailable is the row's description, already on screen. */}
          <Switch
            checked={backorderEnabled}
            disabled={!manageStock || !allowNegativeGlobal}
            onCheckedChange={(next): void => stage('backorderEnabled', next)}
          />
        </SettingRow>
      </EditorSection>

      <EditorSection title={t('inventoryTab.lowStock.title')}>
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
      </EditorSection>

      <EditorSection title={t('inventoryTab.fulfilment.title')}>
        <FulfilmentStrategyPicker
          value={fulfilment}
          onChange={setFulfilment}
          warehouses={warehouses.map((w) => ({ id: w.id, code: w.code, name: w.name }))}
          allowInherit
          idPrefix={`product-${productId}`}
        />
      </EditorSection>

      {error ? (
        <Alert variant="destructive">{error === LOAD_FAILED ? t('inventoryTab.error.load') : error}</Alert>
      ) : null}

      {/* Per-warehouse stock and thresholds write at once, each its own audited command. The
          stock summary is the section's stat line, not a box of its own (#1488). */}
      <EditorSection
        title={
          <>
            {t('inventoryTab.table.title')}
            {editable ? <ImmediateBadge /> : null}
          </>
        }
        description={t('inventoryTab.summary.line', {
          onHand: totalOnHand.toLocaleString(),
          warehouses: String(warehouses.length),
        })}
        // Mounted before it has text, so the result of a row's Apply is announced (WCAG 4.1.3).
        action={<InlineStatus {...status.props} />}
      >
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
              const onHandDraft = draft.get(w.id) ?? '0';
              const stockChanged = onHandFromDraft(onHandDraft) !== current;
              const thresholdChanged = thresholdFromDraft(draftValue) !== resolvedThreshold;
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
                      aria-label={t('inventoryTab.column.newValueFor', { warehouse: w.name })}
                      value={onHandDraft}
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
                    <RowApplyButton
                      label={t('inventoryTab.action.applyStockFor', { warehouse: w.name })}
                      text={t('inventoryTab.action.apply')}
                      busy={saving === w.id}
                      disabled={!stockChanged}
                      onApply={(): void => { void handleSave(w); }}
                    />
                  </td>
                  {mode === 'per_warehouse' ? (
                    <>
                      <td>
                        <input
                          className="b2b-field"
                          type="number"
                          min="0"
                          style={{ width: 110, textAlign: 'right' }}
                          aria-label={t('inventoryTab.column.thresholdFor', { warehouse: w.name })}
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
                        <RowApplyButton
                          label={t('inventoryTab.action.applyThresholdFor', { warehouse: w.name })}
                          text={t('inventoryTab.action.apply')}
                          busy={savingThreshold === w.id}
                          disabled={!thresholdChanged}
                          onApply={(): void => { void handleSaveWarehouseThreshold(w); }}
                        />
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </EditorSection>
    </>
  );
}

/**
 * A per-warehouse row's immediate write. `outline`, never filled: the editor's one
 * Save is the page's only primary (DS-07, #1441). Its visible word stays "Apply"
 * while the write is in flight — a spinner and `aria-busy` say busy — so the
 * accessible name, which adds the warehouse, keeps containing the visible label
 * (WCAG 2.5.3) and the row does not reflow. Disabled while busy (no double write,
 * Doherty) and while the draft equals what is stored (nothing to apply).
 */
function RowApplyButton({
  label,
  text,
  busy,
  disabled,
  onApply,
}: {
  label: string;
  text: string;
  busy: boolean;
  disabled: boolean;
  onApply: () => void;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-label={label}
      aria-busy={busy ? true : undefined}
      disabled={busy || disabled}
      onClick={onApply}
    >
      {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : null}
      {text}
    </Button>
  );
}
