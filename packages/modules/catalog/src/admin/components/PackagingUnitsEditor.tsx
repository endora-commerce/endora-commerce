import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { PackagingUnitDto } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Feature 043 — Packaging units editor, rendered inside the product card's
 * Inventory tab. Lets operators define named ordering units (e.g. "Paleta" =
 * 480 pieces): add / edit / remove / reorder, and pick one default. Calls the
 * catalog admin packaging-unit endpoints directly via `apiClient`, mirroring
 * the rest of the Inventory tab.
 */
export function PackagingUnitsEditor({ productId }: { productId: string }): ReactNode {
  const t = useTranslation('catalog');
  const base = `/api/v1/admin/catalog/products/${productId}/packaging-units`;

  const [units, setUnits] = useState<PackagingUnitDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newQty, setNewQty] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: PackagingUnitDto[] }>(base);
      setUnits(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('packagingUnits.error.load'));
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
      try {
        await fn();
        await load();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('packagingUnits.error.save'));
      } finally {
        setBusy(false);
      }
    },
    [load, t],
  );

  const add = (): void => {
    const name = newName.trim();
    const qty = Number(newQty);
    if (name === '' || !Number.isInteger(qty) || qty < 1) {
      setError(t('packagingUnits.error.invalid'));
      return;
    }
    void run(async () => {
      await apiClient.post(base, { name, baseQuantity: qty });
      setNewName('');
      setNewQty('');
    });
  };

  const patch = (id: string, body: Record<string, unknown>): void => {
    void run(async () => {
      await apiClient.patch(`${base}/${id}`, body);
    });
  };

  const remove = (id: string): void => {
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
      <div className="b2b-card__head">{t('packagingUnits.title')}</div>
      <div className="b2b-card__body b2b-col" style={{ gap: 12 }}>
        <div className="b2b-help">{t('packagingUnits.help')}</div>
        {error ? <div className="b2b-alert b2b-alert--error">{error}</div> : null}

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
                <th>{t('packagingUnits.col.default')}</th>
                <th>{t('packagingUnits.col.order')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={u.id}>
                  <td>
                    <input
                      className="b2b-input"
                      defaultValue={u.name}
                      disabled={busy}
                      aria-label={t('packagingUnits.col.name')}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== u.name) patch(u.id, { name: v });
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="b2b-input"
                      type="number"
                      min={1}
                      step={1}
                      defaultValue={u.baseQuantity}
                      disabled={busy}
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
                      type="radio"
                      name={`pkg-default-${productId}`}
                      checked={u.isDefault}
                      disabled={busy}
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
                      disabled={busy || i === 0}
                      aria-label={t('packagingUnits.action.moveUp')}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy || i === units.length - 1}
                      aria-label={t('packagingUnits.action.moveDown')}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="b2b-btn b2b-btn--ghost b2b-btn--sm"
                      disabled={busy}
                      onClick={() => remove(u.id)}
                    >
                      {t('packagingUnits.action.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

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
          <button
            type="button"
            className="b2b-btn b2b-btn--primary b2b-btn--sm"
            disabled={busy}
            onClick={add}
          >
            {t('packagingUnits.action.add')}
          </button>
        </div>
      </div>
    </div>
  );
}
