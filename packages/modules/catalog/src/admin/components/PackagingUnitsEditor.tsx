import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import { ORDER_MINIMUM_MAX, type PackagingUnitDto } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { parseOrderMinimumInput } from '../lib/order-minimum-input.js';
import { ImmediateBadge, GlobalOnlyBadge } from './editor/ImmediateBadge.js';

/**
 * Feature 043 — Packaging units editor, rendered inside the product card's
 * Inventory tab. Lets operators define named ordering units (e.g. "Paleta" =
 * 480 pieces): add / edit / remove / reorder, and pick one default. Calls the
 * catalog admin packaging-unit endpoints directly via `apiClient`, mirroring
 * the rest of the Inventory tab.
 *
 * Feature 155 (US2, FR-002) — each unit also carries an optional minimum number of that
 * unit per order (`minOrderUnits`), edited in its own column; empty clears it.
 *
 * Feature 170 (T101, T147; `contracts/editor-ui.md` §3, §11) — a unit's name is a scoped value
 * (`packagingUnit:<id>:name`) rendered by the host through `renderName` and saved with the
 * editor's one Save; everything else here (add, remove, reorder, base quantity, minimum,
 * default) runs at once as its own audited Command ("Applies immediately"), at Global only.
 * After each the host re-reads the packaging family (`onChanged`), keeping its staged changes.
 */
export function PackagingUnitsEditor({
  productId,
  canWrite,
  atGlobal = true,
  renderName,
  onChanged,
}: {
  productId: string;
  /** Feature 163 (review D15) — without `catalog:write` every control is read-only. */
  canWrite: boolean;
  /** Units and quantities are Global only: outside Global the structural controls are read-only. */
  atGlobal?: boolean;
  /** The unit's name at the editor scope; without it the Global name is shown read-only. */
  renderName?: (unit: PackagingUnitDto) => ReactNode;
  /** Called after an immediate change, so the host refreshes the packaging family of its view. */
  onChanged?: () => Promise<void>;
}): ReactNode {
  const t = useTranslation('catalog');
  const base = `/api/v1/admin/catalog/products/${productId}/packaging-units`;

  const [units, setUnits] = useState<PackagingUnitDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newMin, setNewMin] = useState('');
  /** The unit id (or `'new'`) whose minimum input holds the value the error refers to. */
  const [invalidMinimum, setInvalidMinimum] = useState<string | null>(null);
  const errorId = `${useId()}-error`;
  const structural = canWrite && atGlobal;
  const minimumMessage = (): string =>
    t('packagingUnits.error.invalidMinimum', { max: String(ORDER_MINIMUM_MAX) });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: PackagingUnitDto[] }>(base);
      setUnits(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('packagingUnits.error.load'));
    } finally {
      setLoading(false);
    }
  }, [base, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      // The invalid minimum is not cleared here: the refused value is still in
      // its (uncontrolled) cell, so its `aria-invalid` and message stay until
      // that value changes or is saved (round B UI review).
      try {
        await fn();
        await load();
        await onChanged?.();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('productEditor.scopeDialog.error'));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged, t],
  );

  const add = (): void => {
    const name = newName.trim();
    const qty = Number(newQty);
    if (name === '' || !Number.isInteger(qty) || qty < 1) {
      setError(t('packagingUnits.error.invalid'));
      return;
    }
    const minimum = parseOrderMinimumInput(newMin);
    if (!minimum.ok) {
      setInvalidMinimum('new');
      return;
    }
    void run(async () => {
      // Sent only when entered, so a unit without a minimum is created as before.
      await apiClient.post(base, {
        name,
        baseQuantity: qty,
        ...(minimum.value != null ? { minOrderUnits: minimum.value } : {}),
      });
      setNewName('');
      setNewQty('');
      setNewMin('');
    });
  };

  const patch = (id: string, body: Record<string, unknown>): void => {
    void run(async () => {
      await apiClient.patch(`${base}/${id}`, body);
    });
  };

  const saveMinimum = (unit: PackagingUnitDto, raw: string): void => {
    const parsed = parseOrderMinimumInput(raw);
    if (!parsed.ok) {
      setInvalidMinimum(unit.id);
      return;
    }
    if (invalidMinimum === unit.id) setInvalidMinimum(null);
    if (parsed.value === (unit.minOrderUnits ?? null)) return;
    patch(unit.id, { minOrderUnits: parsed.value });
  };

  const minimumA11y = (key: string): { 'aria-invalid'?: true; 'aria-describedby'?: string } =>
    invalidMinimum === key ? { 'aria-invalid': true, 'aria-describedby': errorId } : {};

  const remove = (id: string): void => {
    if (invalidMinimum === id) setInvalidMinimum(null);
    void run(async () => {
      await apiClient.delete(`${base}/${id}`);
    });
  };

  const move = (index: number, delta: number): void => {
    const next = [...units];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(async () => {
      await apiClient.patch(`${base}/reorder`, { orderedIds: next.map((u) => u.id) });
    });
  };

  return (
    <div className="b2b-card">
      <div className="b2b-card__head">
        {t('packagingUnits.title')}
        {structural ? <ImmediateBadge /> : !atGlobal ? <GlobalOnlyBadge label={t('packagingUnits.setGlobalOnly')} /> : null}
      </div>
      <div className="b2b-card__body b2b-col" style={{ gap: 12 }}>
        <div className="b2b-help">{t('packagingUnits.help')}</div>
        <div className="b2b-help">{t('packagingUnits.minOrderUnitsHelp')}</div>
        {!canWrite ? <div className="b2b-help">{t('packagingUnits.readOnly')}</div> : null}
        {invalidMinimum !== null ? (
          <Alert id={errorId} variant="destructive">
            <AlertDescription>{minimumMessage()}</AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {loading ? (
          <div className="b2b-help">{t('packagingUnits.loading')}</div>
        ) : units.length === 0 ? (
          <div className="b2b-help">{t('packagingUnits.empty')}</div>
        ) : (
          <table className="b2b-table">
            <thead>
              <tr>
                <th>{t('packagingUnits.col.name')}</th>
                <th>{t('packagingUnits.col.baseQuantity')}</th>
                <th>{t('packagingUnits.col.minOrderUnits')}</th>
                <th>{t('packagingUnits.col.default')}</th>
                <th>{t('packagingUnits.col.order')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id}>
                  <td style={{ minWidth: 220 }}>
                    {renderName ? (
                      renderName(u)
                    ) : (
                      <input className="b2b-input" value={u.name} readOnly aria-label={t('packagingUnits.col.name')} />
                    )}
                  </td>
                  <td>
                    <input
                      className="b2b-input"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={u.baseQuantity}
                      disabled={busy || !structural}
                      aria-label={t('packagingUnits.col.baseQuantity')}
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isInteger(v) && v >= 1 && v !== u.baseQuantity) {
                          patch(u.id, { baseQuantity: v });
                        }
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="b2b-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={ORDER_MINIMUM_MAX}
                      step={1}
                      defaultValue={u.minOrderUnits ?? ''}
                      disabled={busy || !structural}
                      aria-label={t('packagingUnits.col.minOrderUnits')}
                      {...minimumA11y(u.id)}
                      onChange={() => {
                        if (invalidMinimum === u.id) setInvalidMinimum(null);
                      }}
                      onBlur={(e) => saveMinimum(u, e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="radio"
                      name={`pkg-default-${productId}`}
                      checked={u.isDefault}
                      disabled={busy || !structural}
                      aria-label={t('packagingUnits.col.default')}
                      onChange={() => {
                        if (!u.isDefault) patch(u.id, { isDefault: true });
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy || !structural || i === 0}
                      aria-label={t('packagingUnits.action.moveUp')}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy || !structural || i === units.length - 1}
                      aria-label={t('packagingUnits.action.moveDown')}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {structural ? (
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                        disabled={busy}
                        onClick={() => remove(u.id)}
                      >
                        {t('packagingUnits.action.remove')}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {structural ? (
          <div className="b2b-row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <input
              className="b2b-input"
              placeholder={t('packagingUnits.newName')}
              value={newName}
              disabled={busy}
              aria-label={t('packagingUnits.col.name')}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className="b2b-input"
              type="number"
              min={1}
              step={1}
              placeholder={t('packagingUnits.newQuantity')}
              value={newQty}
              disabled={busy}
              aria-label={t('packagingUnits.col.baseQuantity')}
              onChange={(e) => setNewQty(e.target.value)}
            />
            <input
              className="b2b-input"
              type="number"
              inputMode="numeric"
              min={1}
              max={ORDER_MINIMUM_MAX}
              step={1}
              placeholder={t('packagingUnits.newMinimum')}
              value={newMin}
              disabled={busy}
              aria-label={t('packagingUnits.col.minOrderUnits')}
              {...minimumA11y('new')}
              onChange={(e) => {
                setNewMin(e.target.value);
                if (invalidMinimum === 'new') setInvalidMinimum(null);
              }}
            />
            <button
              type="button"
              className="b2b-btn b2b-btn--primary b2b-btn--sm"
              disabled={busy}
              onClick={add}
            >
              {t('packagingUnits.action.add')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
