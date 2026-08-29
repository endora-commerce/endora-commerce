'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ComparisonAttributeRow,
  ComparisonDisplayMode,
  ComparisonSharedView,
} from '@endora-commerce/contracts';
import { ComparisonApiError, getSharedComparison } from '../lib/api/comparisons';
import { tForLocale } from '../lib/i18n/messages';

/**
 * `<SharedComparisonTable>` — feature 007 / US2 / T043.
 *
 * Read-only recipient view of a Comparison. Shares the Industria
 * markup with `<ComparisonTable>` so the layout is visually identical,
 * minus every mutation affordance (no Remove, no Delete, no Add to
 * cart, no PDF export, no share-link copy). Mode switching is
 * session-local — the recipient cannot persist a mode change to
 * someone else's Comparison.
 *
 * Display-mode contract mirrors the owner table: the persisted value
 * from the owner is honoured initially, then the recipient can toggle
 * "Pokaż tylko różnice" locally (mapping to `'differences' | 'all'`),
 * plus a client-side "Ukryj puste" filter that drops rows where every
 * cell is null.
 *
 * **The table says whose view this is.** The server prices the columns for the
 * reader and drops the products the reader may not see, so a recipient's table
 * legitimately differs from the sender's in its figures and sometimes in its
 * length. Both are stated — `pricedFor` and `hiddenProductCount` — because a
 * difference a reader has to discover is one they will mistake for the
 * sender's numbers.
 */
export function SharedComparisonTable(props: { token: string; locale: string }): ReactNode {
  const t = tForLocale(props.locale);
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'gone' }
    | { kind: 'ready'; view: ComparisonSharedView; viewerIsOwner: boolean }
  >({ kind: 'loading' });

  // Local-only overrides. `localMode` is null until the recipient
  // touches the differences toggle — until then we honour the owner's
  // persisted mode.
  const [localMode, setLocalMode] = useState<ComparisonDisplayMode | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSharedComparison(props.token)
      .then((res) => {
        if (cancelled) return;
        if (!res) {
          setState({ kind: 'gone' });
          return;
        }
        setState({ kind: 'ready', view: res.data, viewerIsOwner: res.viewerIsOwner });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: 'error',
          message: err instanceof ComparisonApiError ? err.message : 'Nie udało się załadować porównania.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [props.token]);

  const activeMode: ComparisonDisplayMode =
    state.kind === 'ready' ? (localMode ?? state.view.displayMode) : 'all';

  const visibleRows = useMemo<ComparisonAttributeRow[]>(() => {
    if (state.kind !== 'ready') return [];
    let rows = filterRowsByMode(state.view.comparableAttributes, activeMode);
    if (hideEmpty) {
      rows = rows.filter((r) => r.values.some((v) => v !== null && v !== ''));
    }
    return rows;
  }, [state, activeMode, hideEmpty]);

  if (state.kind === 'loading') return <p className="muted">Ładowanie…</p>;
  if (state.kind === 'error') return <div className="alert alert--error">{state.message}</div>;
  if (state.kind === 'gone') {
    return (
      <div className="industria-compare-page">
        <p className="muted">
          Ta porównywarka już nie istnieje — autor mógł ją usunąć.
        </p>
      </div>
    );
  }

  const { view } = state;
  if (view.products.length === 0) {
    return (
      <div className="industria-compare-page">
        <p className="muted">
          {view.hiddenProductCount > 0
            ? // Every product in the sender's set is one this reader may not
              // see. "Empty" would be a lie about the sender's comparison.
              t('compare.shared.hiddenProducts')
            : 'Porównywarka jest pusta.'}
        </p>
      </div>
    );
  }

  const showOnlyDifferences = activeMode === 'differences';

  return (
    <div className="industria-compare-page">
      <div className="industria-compare-toolbar">
        <div className="industria-compare-toolbar__left">
          <Switch
            checked={showOnlyDifferences}
            onChange={(next): void => setLocalMode(next ? 'differences' : 'all')}
            label="Pokaż tylko różnice"
          />
          <Switch
            checked={hideEmpty}
            onChange={setHideEmpty}
            label="Ukryj puste"
          />
        </div>
        <div className="industria-compare-toolbar__right">
          <span className="industria-compare-toolbar__readonly" role="status">
            Widok udostępniony · tylko do odczytu
          </span>
        </div>
      </div>

      <p className="muted" role="status">
        {view.pricedFor === 'organization'
          ? t('compare.shared.pricesYours')
          : t('compare.shared.pricesChannel')}
      </p>
      {view.hiddenProductCount > 0 ? (
        <p className="muted" role="status">
          {t('compare.shared.hiddenProducts')}
        </p>
      ) : null}

      <div className="industria-compare-table">
        <table>
          <thead>
            <tr>
              <th aria-hidden="true" />
              {view.products.map((p) => (
                <th key={p.id}>
                  <div className="industria-cmp-card">
                    <div className="industria-cmp-card__media">
                      {p.primaryAssetUrl ? (
                        <img src={p.primaryAssetUrl} alt={localised(p.name)} loading="lazy" />
                      ) : (
                        <PlaceholderGlyph />
                      )}
                    </div>
                    <div className="industria-cmp-card__sku">{p.sku}</div>
                    <a href={`/p/${p.slug}`} className="industria-cmp-card__name">
                      {localised(p.name)}
                    </a>
                    <div className="industria-cmp-card__price">
                      {p.price ? `${p.price.amount} ${p.price.currency}` : '—'}
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={view.products.length + 1} className="muted">
                  {hideEmpty
                    ? 'Wszystkie wiersze są puste dla wybranych produktów — wyłącz „Ukryj puste”, aby zobaczyć atrybuty z brakującymi wartościami.'
                    : 'Brak atrybutów spełniających aktualne filtry.'}
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{localised(row.label)}</th>
                  {row.values.map((v, idx) => (
                    <td key={`${row.key}-${idx}`}>{v ?? '—'}</td>
                  ))}
                </tr>
              ))
            )}
            <tr className="industria-compare-table__action-row">
              <th scope="row">Akcja</th>
              {view.products.map((p) => (
                <td key={p.id}>
                  <div className="industria-compare-table__actions">
                    <a href={`/p/${p.slug}`} className="btn btn--outline btn--sm">
                      Karta produktu
                    </a>
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Switch(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={(): void => props.onChange(!props.checked)}
      className="industria-toggle-row"
    >
      <span
        className={`industria-switch${props.checked ? ' is-on' : ''}`}
        aria-hidden="true"
      />
      <span>{props.label}</span>
    </button>
  );
}

function filterRowsByMode(
  rows: ComparisonAttributeRow[],
  mode: ComparisonDisplayMode,
): ComparisonAttributeRow[] {
  if (mode === 'differences') return rows.filter((r) => r.rowClass === 'different');
  if (mode === 'common') return rows.filter((r) => r.rowClass === 'common');
  return rows;
}

function localised(value: Record<string, string>): string {
  return (
    value['pl-PL'] ??
    value['pl'] ??
    value['en-US'] ??
    value['en'] ??
    Object.values(value)[0] ??
    ''
  );
}

function PlaceholderGlyph(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      aria-hidden="true"
      focusable="false"
      className="industria-cmp-card__placeholder"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M21 15l-5-5L7 19" />
    </svg>
  );
}
