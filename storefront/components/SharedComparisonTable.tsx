'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type {
  ComparisonAttributeRow,
  ComparisonDisplayMode,
  ComparisonSharedView,
} from '@b2b/contracts';
import { ComparisonApiError, getSharedComparison } from '../lib/api/comparisons';
import { CompareModeSwitcher } from './CompareModeSwitcher';

/**
 * `<SharedComparisonTable>` — feature 007 / US2 / T043.
 *
 * Read-only recipient view of a Comparison. Shape mirrors
 * `<ComparisonTable>` for the always-on row + body rows but omits every
 * mutation control: no Remove, no Delete, no Add to cart. Mode
 * switching is session-local — the recipient cannot persist a mode
 * change to someone else's Comparison.
 */
export function SharedComparisonTable(props: { token: string }): ReactNode {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'gone' }
    | { kind: 'ready'; view: ComparisonSharedView; viewerIsOwner: boolean }
  >({ kind: 'loading' });

  // Recipient's session-local mode override; null = honour the owner's
  // persisted mode from `view.displayMode`.
  const [localMode, setLocalMode] = useState<ComparisonDisplayMode | null>(null);

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
          message: err instanceof ComparisonApiError ? err.message : 'Failed to load.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [props.token]);

  if (state.kind === 'loading') return <p className="muted">Loading…</p>;
  if (state.kind === 'error') return <div className="alert alert--error">{state.message}</div>;
  if (state.kind === 'gone') {
    return (
      <p className="muted">
        This comparison no longer exists. The original creator may have deleted it.
      </p>
    );
  }

  const { view } = state;
  const activeMode: ComparisonDisplayMode = localMode ?? view.displayMode;
  const visibleRows = filterRowsByMode(view.comparableAttributes, activeMode);

  return (
    <>
      <div className="toolbar">
        <CompareModeSwitcher value={activeMode} onChange={setLocalMode} />
      </div>
      <div className="b2b-compare">
        <table className="b2b-compare__table">
          <thead>
            <tr>
              <th></th>
              {view.products.map((p) => (
                <th key={p.id}>
                  <a href={`/p/${p.slug}`}>
                    {p.primaryAssetUrl ? (
                      <img src={p.primaryAssetUrl} alt={localised(p.name)} loading="lazy" />
                    ) : null}
                    <div>{localised(p.name)}</div>
                  </a>
                  <div className="b2b-compare__price">
                    {p.price ? `${p.price.amount} ${p.price.currency}` : '—'}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={view.products.length + 1} className="muted">
                  No attribute rows match the current display mode.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr
                  key={row.key}
                  className={`b2b-compare__row b2b-compare__row--${row.rowClass}`}
                >
                  <th scope="row">{localised(row.label)}</th>
                  {row.values.map((v, idx) => (
                    <td key={`${row.key}-${idx}`}>{v === null ? '—' : v}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function filterRowsByMode(
  rows: ComparisonAttributeRow[],
  mode: ComparisonDisplayMode,
): ComparisonAttributeRow[] {
  if (mode === 'all') return rows;
  if (mode === 'common') return rows.filter((r) => r.rowClass === 'common');
  return rows.filter((r) => r.rowClass === 'different');
}

function localised(value: Record<string, string>): string {
  return value['en-US'] ?? value['en'] ?? Object.values(value)[0] ?? '';
}
