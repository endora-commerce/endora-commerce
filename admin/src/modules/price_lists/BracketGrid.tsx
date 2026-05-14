import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Copy, Plus, Save, Trash2, AlertTriangle, RotateCcw } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { useTranslation } from '@/i18n/useTranslation';

export interface Bracket {
  minQuantity: number;
  maxQuantity: number | null;
  /** Decimal amount as a string (matches the wire shape on bracket endpoints). */
  amount: string;
}

export type BracketsByCurrency = Record<string, Bracket[]>;

/**
 * Per-product per-currency multi-bracket editor (US3 / T047).
 *
 * Surfaces every currency the price list already carries on this
 * product as a tab, plus an "Add currency" picker fed by the
 * `/admin/pricing/rule-targets/currencies` endpoint. Inline overlap
 * + open-end + decimal-format validation runs client-side; the same
 * rules are enforced by the service layer so the save call surfaces
 * a structured `400 bracket_overlap` / `400 invalid_bracket` error
 * if a slip-through reaches the backend.
 */
export function BracketGrid(props: {
  priceListId: string;
  productId: string;
  productName: string;
  initial: BracketsByCurrency;
  /** Whether the parent list is the system Default — disables saving. */
  systemList: boolean;
  onSaved: (next: BracketsByCurrency) => void;
}): ReactNode {
  const t = useTranslation('core');
  const { priceListId, productId, productName, initial, systemList, onSaved } = props;
  const initialCurrencies = Object.keys(initial).sort();
  const [draft, setDraft] = useState<BracketsByCurrency>(() => normaliseInitial(initial));
  const [activeCurrency, setActiveCurrency] = useState<string>(initialCurrencies[0] ?? '');
  const [allCurrencies, setAllCurrencies] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showCopy, setShowCopy] = useState(false);

  useEffect(() => {
    setDraft(normaliseInitial(initial));
    const next = Object.keys(initial).sort();
    if (next.length > 0 && !next.includes(activeCurrency)) {
      setActiveCurrency(next[0]!);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, productId]);

  useEffect(() => {
    apiClient
      .get<{ data: { items: { code: string; exposedByChannels: string[] }[] } }>(
        '/api/v1/admin/pricing/rule-targets/currencies',
      )
      .then((res) => setAllCurrencies(res.data.items.map((i) => i.code)))
      .catch(() => setAllCurrencies([]));
  }, []);

  const validation = useMemo(() => validate(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(normaliseInitial(initial)) !== JSON.stringify(draft),
    [initial, draft],
  );

  const currencies = Object.keys(draft).sort();
  const rows = activeCurrency ? draft[activeCurrency] ?? [] : [];

  const setRows = (next: Bracket[]): void => {
    setDraft((prev) => ({ ...prev, [activeCurrency]: next }));
  };

  const addBracket = (): void => {
    const last = rows[rows.length - 1];
    const nextMin = last ? Math.max(last.minQuantity + 1, (last.maxQuantity ?? last.minQuantity) + 1) : 1;
    setRows([...rows, { minQuantity: nextMin, maxQuantity: null, amount: '0.00' }]);
  };

  const removeBracket = (idx: number): void => {
    setRows(rows.filter((_, i) => i !== idx));
  };

  const updateRow = (idx: number, patch: Partial<Bracket>): void => {
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addCurrency = (code: string): void => {
    const upper = code.toUpperCase();
    if (draft[upper]) return;
    setDraft((prev) => ({ ...prev, [upper]: [{ minQuantity: 1, maxQuantity: null, amount: '0.00' }] }));
    setActiveCurrency(upper);
  };

  const removeCurrency = (): void => {
    if (!activeCurrency) return;
    if (!confirm(t('priceLists.bracket.confirmRemoveCurrency', { code: activeCurrency }))) return;
    setDraft((prev) => {
      const { [activeCurrency]: _, ...rest } = prev;
      return rest;
    });
    const remaining = Object.keys(draft).filter((c) => c !== activeCurrency).sort();
    setActiveCurrency(remaining[0] ?? '');
  };

  const handleReset = (): void => {
    setDraft(normaliseInitial(initial));
    setError(null);
    setInfo(null);
  };

  const handleSave = async (): Promise<void> => {
    if (validation.errors.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiClient.put<{ data: { bracketsByCurrency: BracketsByCurrency } }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(priceListId)}/products/${encodeURIComponent(productId)}/brackets`,
        { bracketsByCurrency: draft },
      );
      onSaved(res.data.bracketsByCurrency);
      setInfo(t('priceLists.bracket.info.saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.bracket.error.save'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyCurrency = async (toCurrencies: string[]): Promise<void> => {
    if (!activeCurrency || toCurrencies.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post<{ data: { added: number } }>(
        `/api/v1/admin/price-lists-engine/${encodeURIComponent(priceListId)}/products/${encodeURIComponent(productId)}/brackets/copy`,
        { fromCurrency: activeCurrency, toCurrencies },
      );
      // Re-load the persisted brackets via PUT response shape; the simplest
      // path is to mirror the source brackets locally (server-side does the
      // identity copy) and let the parent refresh the list view too.
      setDraft((prev) => {
        const next = { ...prev };
        for (const cur of toCurrencies) {
          next[cur] = [...(prev[activeCurrency] ?? [])].map((r) => ({ ...r }));
        }
        return next;
      });
      setInfo(t('priceLists.bracket.info.copied', {
        source: activeCurrency,
        targets: toCurrencies.join(', '),
      }));
      setShowCopy(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('priceLists.bracket.error.copy'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="b2b-col" style={{ gap: 12 }}>
      <div
        className="b2b-row"
        style={{ alignItems: 'baseline', gap: 8, paddingBottom: 4, borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="b2b-grow">
          <div style={{ fontSize: 13, fontWeight: 600 }}>{productName}</div>
          <div className="b2b-help" style={{ marginTop: 2 }}>
            {t('priceLists.bracket.help')}
          </div>
        </div>
        {dirty && !systemList ? (
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            onClick={handleReset}
          >
            <RotateCcw size={12} /> {t('priceLists.bracket.discard')}
          </button>
        ) : null}
        <button
          type="button"
          className="b2b-btn b2b-btn--primary b2b-btn--sm"
          disabled={systemList || submitting || !dirty || validation.errors.length > 0}
          onClick={(): void => {
            void handleSave();
          }}
        >
          <Save size={13} /> {submitting ? t('priceLists.bracket.saving') : t('priceLists.bracket.save')}
        </button>
      </div>

      {info ? (
        <div
          style={{
            padding: 8,
            background: 'var(--success-soft)',
            color: 'var(--success-soft-fg)',
            borderRadius: 6,
            border: '1px solid hsl(142 50% 80%)',
            fontSize: 12,
          }}
        >
          {info}
        </div>
      ) : null}
      {error ? (
        <div
          style={{
            padding: 8,
            background: 'var(--danger-soft)',
            color: 'var(--danger-soft-fg)',
            borderRadius: 6,
            border: '1px solid hsl(8 80% 85%)',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="b2b-row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {currencies.length === 0 ? (
          <span className="b2b-help">{t('priceLists.bracket.noCurrencies')}</span>
        ) : (
          currencies.map((c) => {
            const isActive = c === activeCurrency;
            const cErrors = validation.perCurrency[c]?.length ?? 0;
            return (
              <button
                key={c}
                type="button"
                className="b2b-btn b2b-btn--sm"
                onClick={(): void => setActiveCurrency(c)}
                style={{
                  background: isActive ? 'var(--primary-color)' : 'var(--surface-color)',
                  color: isActive ? 'var(--primary-soft)' : 'var(--fg-default)',
                  border: `1px solid ${isActive ? 'var(--primary-color)' : 'var(--border-color)'}`,
                }}
              >
                {c}
                {cErrors > 0 ? (
                  <AlertTriangle
                    size={11}
                    style={{ marginLeft: 4, color: isActive ? '#fff' : 'hsl(8 80% 50%)' }}
                  />
                ) : null}
              </button>
            );
          })
        )}
        <AddCurrencyMenu
          allCurrencies={allCurrencies}
          existing={currencies}
          onAdd={addCurrency}
          disabled={systemList}
        />
        {currencies.length > 1 ? (
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            disabled={systemList}
            onClick={(): void => setShowCopy(true)}
          >
            <Copy size={12} /> {t('priceLists.bracket.copyFrom', { code: activeCurrency })}
          </button>
        ) : null}
        {activeCurrency ? (
          <button
            type="button"
            className="b2b-btn b2b-btn--ghost b2b-btn--sm"
            disabled={systemList}
            onClick={removeCurrency}
            style={{ color: 'hsl(8 80% 50%)' }}
          >
            <Trash2 size={12} /> {t('priceLists.bracket.removeCurrency', { code: activeCurrency })}
          </button>
        ) : null}
      </div>

      {activeCurrency ? (
        <table className="b2b-tbl">
          <thead>
            <tr>
              <th style={{ width: 100 }}>{t('priceLists.bracket.column.minQty')}</th>
              <th style={{ width: 100 }}>{t('priceLists.bracket.column.maxQty')}</th>
              <th>{t('priceLists.bracket.column.unitPrice', { code: activeCurrency })}</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="b2b-help" style={{ padding: 16 }}>
                  {t('priceLists.bracket.emptyForCurrency', { code: activeCurrency })}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const rowErrors = validation.perRow[`${activeCurrency}#${idx}`] ?? [];
                return (
                  <tr key={idx} style={rowErrors.length > 0 ? { background: 'var(--danger-soft)' } : undefined}>
                    <td>
                      <input
                        type="number"
                        className="b2b-field b2b-field--mono"
                        min={1}
                        value={r.minQuantity}
                        disabled={systemList}
                        onChange={(e): void => updateRow(idx, { minQuantity: Number(e.target.value) || 1 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        className="b2b-field b2b-field--mono"
                        min={1}
                        placeholder="∞"
                        value={r.maxQuantity ?? ''}
                        disabled={systemList}
                        onChange={(e): void =>
                          updateRow(idx, {
                            maxQuantity: e.target.value === '' ? null : Number(e.target.value) || null,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="b2b-field b2b-field--mono"
                        inputMode="decimal"
                        value={r.amount}
                        disabled={systemList}
                        onChange={(e): void => updateRow(idx, { amount: e.target.value })}
                      />
                      {rowErrors.length > 0 ? (
                        <div style={{ fontSize: 11, color: 'hsl(8 80% 40%)', marginTop: 2 }}>
                          {rowErrors.join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="b2b-btn b2b-btn--ghost b2b-btn--icon b2b-btn--sm"
                        disabled={systemList}
                        onClick={(): void => removeBracket(idx)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      ) : null}

      {activeCurrency && !systemList ? (
        <button
          type="button"
          className="b2b-btn b2b-btn--default b2b-btn--sm"
          style={{ alignSelf: 'flex-start' }}
          onClick={addBracket}
        >
          <Plus size={12} /> {t('priceLists.bracket.addBracket')}
        </button>
      ) : null}

      {showCopy ? (
        <CopyDialog
          source={activeCurrency}
          allCurrencies={allCurrencies}
          existing={currencies}
          onClose={(): void => setShowCopy(false)}
          onConfirm={(targets): void => {
            void handleCopyCurrency(targets);
          }}
        />
      ) : null}
    </div>
  );
}

function AddCurrencyMenu({
  allCurrencies,
  existing,
  onAdd,
  disabled,
}: {
  allCurrencies: string[];
  existing: string[];
  onAdd: (code: string) => void;
  disabled: boolean;
}): ReactNode {
  const t = useTranslation('core');
  const [open, setOpen] = useState(false);
  const candidates = allCurrencies.filter((c) => !existing.includes(c));
  if (candidates.length === 0) return null;
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="b2b-btn b2b-btn--ghost b2b-btn--sm"
        disabled={disabled}
        onClick={(): void => setOpen((v) => !v)}
      >
        <Plus size={12} /> {t('priceLists.bracket.addCurrency')}
      </button>
      {open ? (
        <div
          className="b2b-card"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            zIndex: 10,
            padding: 4,
            minWidth: 80,
          }}
        >
          {candidates.map((c) => (
            <button
              key={c}
              type="button"
              className="b2b-btn b2b-btn--ghost b2b-btn--sm"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={(): void => {
                onAdd(c);
                setOpen(false);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CopyDialog({
  source,
  allCurrencies,
  existing,
  onClose,
  onConfirm,
}: {
  source: string;
  allCurrencies: string[];
  existing: string[];
  onClose: () => void;
  onConfirm: (targets: string[]) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const candidates = Array.from(new Set([...allCurrencies, ...existing])).filter((c) => c !== source).sort();
  const toggle = (c: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };
  return (
    <>
      <div className="b2b-scrim" onClick={onClose} />
      <aside className="b2b-drawer" role="dialog" aria-modal="true" style={{ maxWidth: 360 }}>
        <div className="b2b-drawer__head">
          <div className="b2b-drawer__title">{t('priceLists.bracket.copy.title', { source })}</div>
          <div className="b2b-card__sub">
            {t('priceLists.bracket.copy.description')}
          </div>
        </div>
        <div className="b2b-drawer__body">
          {candidates.length === 0 ? (
            <div className="b2b-help">{t('priceLists.bracket.copy.noOthers')}</div>
          ) : (
            <div className="b2b-col" style={{ gap: 6 }}>
              {candidates.map((c) => (
                <label
                  key={c}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    className="b2b-cbx"
                    checked={selected.has(c)}
                    onChange={(): void => toggle(c)}
                  />
                  {c}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="b2b-drawer__foot">
          <button type="button" className="b2b-btn b2b-btn--ghost" onClick={onClose}>
            {t('priceLists.bracket.copy.cancel')}
          </button>
          <button
            type="button"
            className="b2b-btn b2b-btn--primary"
            disabled={selected.size === 0}
            onClick={(): void => onConfirm(Array.from(selected))}
          >
            {selected.size === 1
              ? t('priceLists.bracket.copy.confirmSingle', { count: selected.size })
              : t('priceLists.bracket.copy.confirmPlural', { count: selected.size })}
          </button>
        </div>
      </aside>
    </>
  );
}

function normaliseInitial(input: BracketsByCurrency): BracketsByCurrency {
  const out: BracketsByCurrency = {};
  for (const [cur, rows] of Object.entries(input)) {
    out[cur] = [...rows]
      .map((r) => ({ ...r }))
      .sort((a, b) => a.minQuantity - b.minQuantity);
  }
  return out;
}

interface ValidationResult {
  errors: string[];
  perCurrency: Record<string, string[]>;
  perRow: Record<string, string[]>;
}

function validate(draft: BracketsByCurrency): ValidationResult {
  const result: ValidationResult = { errors: [], perCurrency: {}, perRow: {} };
  for (const [cur, rows] of Object.entries(draft)) {
    const cErrors: string[] = [];
    const sorted = [...rows].sort((a, b) => a.minQuantity - b.minQuantity);
    for (let i = 0; i < sorted.length; i += 1) {
      const r = sorted[i]!;
      const orig = rows.findIndex((x) => x === r);
      const key = `${cur}#${orig}`;
      const rowErrors: string[] = [];
      if (!Number.isInteger(r.minQuantity) || r.minQuantity < 1) {
        rowErrors.push('min must be ≥ 1');
      }
      if (r.maxQuantity !== null) {
        if (!Number.isInteger(r.maxQuantity) || r.maxQuantity < r.minQuantity) {
          rowErrors.push('max must be ≥ min');
        }
      }
      if (!/^\d+(\.\d{1,4})?$/.test(r.amount)) {
        rowErrors.push('amount must be a decimal');
      }
      if (i > 0) {
        const prev = sorted[i - 1]!;
        const prevMax = prev.maxQuantity ?? Infinity;
        if (prevMax >= r.minQuantity) rowErrors.push(`overlap with row above (${prev.minQuantity}–${prev.maxQuantity ?? '∞'})`);
        if (i < sorted.length - 1 && prev.maxQuantity === null) {
          rowErrors.push('previous row is open-ended; remove it or cap it first');
        }
      }
      if (rowErrors.length > 0) {
        result.perRow[key] = rowErrors;
        cErrors.push(...rowErrors.map((e) => `Row ${orig + 1}: ${e}`));
      }
    }
    if (cErrors.length > 0) {
      result.perCurrency[cur] = cErrors;
      result.errors.push(...cErrors);
    }
  }
  return result;
}
