'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type {
  ComparisonOwnerView,
  ComparisonAttributeRow,
  ComparisonDisplayMode,
} from '@b2b/contracts';
import {
  ComparisonApiError,
  deleteMyComparison,
  exportComparisonPdf,
  getMyComparison,
  removeProductFromCompare,
  setComparisonDisplayMode,
} from '../lib/api/comparisons';
import { CompareModeSwitcher } from './CompareModeSwitcher';
import { CompareAddToCartButton } from './CompareAddToCartButton';

/**
 * Comparison table — feature 007 / T032.
 *
 * Reads the live `ComparisonOwnerView` from the backend, renders the
 * always-on header (name / price / base image), filters the body rows
 * by the active display mode, and offers per-product *Remove* + a
 * top-level *Delete comparison* affordance.
 *
 * Mode switching is instantaneous: the full attribute projection is in
 * the initial response, so changing mode just re-filters which rows
 * are visible. Each switch also fires `PATCH /me` so the customer's
 * choice is persisted across visits (spec FR-008 + the data-model's
 * persisted `displayMode`).
 */
export function ComparisonTable(): ReactNode {
  const [view, setView] = useState<ComparisonOwnerView | null | 'loading'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyComparison()
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err) => {
        if (!cancelled) setError(toMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="alert alert--error">{error}</div>;
  if (view === 'loading') return <p className="muted">Loading…</p>;
  if (!view || view.products.length === 0) return <EmptyState />;

  const visibleRows = filterRowsByMode(view.comparableAttributes, view.displayMode);

  const onRemove = async (productId: string): Promise<void> => {
    try {
      const next = await removeProductFromCompare(productId);
      // If the removal emptied the set, the API still returns the empty
      // shell — the empty-state branch above renders next time.
      setView(next);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const onDelete = async (): Promise<void> => {
    try {
      await deleteMyComparison();
      setView(null);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  const onSetMode = async (mode: ComparisonDisplayMode): Promise<void> => {
    // Optimistically update so the switch feels instantaneous; reconcile
    // with the server response when it returns.
    setView({ ...view, displayMode: mode });
    try {
      const next = await setComparisonDisplayMode(mode);
      setView(next);
    } catch (err) {
      setError(toMessage(err));
    }
  };

  return (
    <>
      <div className="toolbar">
        <CompareModeSwitcher value={view.displayMode} onChange={onSetMode} />
        <CopyShareLinkButton shareToken={view.shareToken} />
        <ExportPdfButton disabled={view.products.length === 0} />
        <button type="button" className="btn" onClick={(): void => void onDelete()}>
          Delete comparison
        </button>
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
                      <img
                        src={p.primaryAssetUrl}
                        alt={localised(p.name)}
                        loading="lazy"
                      />
                    ) : null}
                    <div>{localised(p.name)}</div>
                  </a>
                  <div className="b2b-compare__price">
                    {p.price ? `${p.price.amount} ${p.price.currency}` : '—'}
                  </div>
                  <div className="b2b-compare__col-actions">
                    <CompareAddToCartButton
                      productId={p.id}
                      disabled={!p.available}
                    />
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={(): void => void onRemove(p.id)}
                    >
                      Remove
                    </button>
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
                    <td key={`${row.key}-${idx}`}>
                      {v === null ? '—' : v}
                    </td>
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

function ExportPdfButton(props: { disabled: boolean }): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = async (): Promise<void> => {
    if (busy || props.disabled) return;
    setBusy(true);
    setError(null);
    try {
      await exportComparisonPdf();
    } catch (err) {
      setError(
        err instanceof ComparisonApiError ? err.message : 'Could not generate PDF.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn"
        disabled={busy || props.disabled}
        onClick={(): void => void onClick()}
      >
        {busy ? 'Generating…' : 'Export to PDF'}
      </button>
      {error ? <span className="b2b-compare__pdf-error">{error}</span> : null}
    </>
  );
}

function CopyShareLinkButton(props: { shareToken: string }): ReactNode {
  const [copied, setCopied] = useState(false);
  const onCopy = async (): Promise<void> => {
    const url =
      typeof window !== 'undefined'
        ? `${window.location.origin}/compare/share/${props.shareToken}`
        : '';
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Best-effort — Safari without clipboard permission falls through.
    }
  };
  return (
    <button type="button" className="btn" onClick={(): void => void onCopy()}>
      {copied ? '✓ Link copied' : 'Copy share link'}
    </button>
  );
}

function EmptyState(): ReactNode {
  return (
    <p className="muted">
      Add at least two products from the catalog to compare them side by side.
    </p>
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

function toMessage(err: unknown): string {
  if (err instanceof ComparisonApiError) return err.message;
  return err instanceof Error ? err.message : 'Unexpected error.';
}
