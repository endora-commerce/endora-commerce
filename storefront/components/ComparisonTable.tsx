'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ComparisonOwnerView,
  ComparisonAttributeRow,
  ComparisonDisplayMode,
} from '@endora-commerce/contracts';
import {
  ComparisonApiError,
  deleteMyComparison,
  exportComparisonPdf,
  getMyComparison,
  removeProductFromCompare,
  setComparisonDisplayMode,
} from '../lib/api/comparisons';
import { CompareAddToCartButton } from './CompareAddToCartButton';
import { toAbsoluteAssetUrl } from '../lib/asset-url';
import { tForLocale } from '../lib/i18n/messages';
import { format } from '../lib/i18n/format';
import { LocalizedAnchor } from '../lib/i18n/localized-link';

/**
 * Comparison table — feature 007 / T032, restyled to match the Industria
 * storefront design (specs/b2b-platform-storefront-ui).
 *
 * Layout maps onto:
 *   `.industria-compare-page`     — page padding wrapper
 *   `.industria-compare-toolbar`  — top toolbar (switches on the left,
 *                                   PDF / share / delete on the right)
 *   `.industria-compare-table`    — bordered, scrollable table card
 *   `.industria-cmp-card`         — column header (media + SKU + name + ✕)
 *   `.industria-switch`           — slider toggle (Show only differences /
 *                                   Hide empty rows)
 *
 * Display-mode contract: the backend persists one of
 * `'all' | 'common' | 'differences'`, but the Industria design exposes a
 * single "Show only differences" switch. We model that as a boolean
 * toggle between `all` and `differences`; a persisted `common` value
 * surfaces as "show only differences = off" (i.e. treated like `all`).
 * "Hide empty" is a client-only row filter — rows whose every value is
 * `null` are skipped client-side.
 */
export function ComparisonTable(props: {
  /**
   * The storefront's language — the PDF is printed in it
   * (`specs/152-compare-pdf-template/` FR-032), and feature 155's minimum
   * statement under "add to cart" is rendered in it.
   */
  readonly locale?: string;
  /** The active sales channel, sent on the browser-side calls. Supplied by the page. */
  readonly salesChannelCode: string | undefined;
}): ReactNode {
  const locale = props.locale ?? 'en-US';
  const t = tForLocale(locale);
  const localised = (value: Record<string, string>): string => localisedValue(value, locale);
  const [view, setView] = useState<ComparisonOwnerView | null | 'loading'>('loading');
  // `text: null` is an error with no message of its own: the catalogue's fallback is used.
  const [error, setError] = useState<{ text: string | null } | null>(null);
  const [hideEmpty, setHideEmpty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getMyComparison(props.salesChannelCode)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err) => {
        if (!cancelled) setError({ text: toMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [props.salesChannelCode]);

  const visibleRows = useMemo<ComparisonAttributeRow[]>(() => {
    if (!view || view === 'loading') return [];
    let rows = filterRowsByMode(view.comparableAttributes, view.displayMode);
    if (hideEmpty) {
      rows = rows.filter((r) => r.values.some((v) => v !== null && v !== ''));
    }
    return rows;
  }, [view, hideEmpty]);

  if (error) {
    return <div className="alert alert--error">{error.text ?? t('commerce.compare.unexpectedError')}</div>;
  }
  if (view === 'loading') return <p className="muted">{t('commerce.common.loading')}</p>;
  if (!view || view.products.length === 0) return <EmptyState text={t('commerce.compare.empty')} />;

  const showOnlyDifferences = view.displayMode === 'differences';

  const onRemove = async (productId: string): Promise<void> => {
    try {
      const next = await removeProductFromCompare(productId, props.salesChannelCode);
      setView(next);
    } catch (err) {
      setError({ text: toMessage(err) });
    }
  };

  const onDelete = async (): Promise<void> => {
    try {
      await deleteMyComparison(props.salesChannelCode);
      setView(null);
    } catch (err) {
      setError({ text: toMessage(err) });
    }
  };

  const onToggleDifferences = async (next: boolean): Promise<void> => {
    const mode: ComparisonDisplayMode = next ? 'differences' : 'all';
    setView({ ...view, displayMode: mode });
    try {
      const fresh = await setComparisonDisplayMode(mode, props.salesChannelCode);
      setView(fresh);
    } catch (err) {
      setError({ text: toMessage(err) });
    }
  };

  return (
    <div className="industria-compare-page">
      <div className="industria-compare-toolbar">
        <div className="industria-compare-toolbar__left">
          <Switch
            checked={showOnlyDifferences}
            onChange={(next): void => void onToggleDifferences(next)}
            label={t('commerce.compare.showOnlyDifferences')}
          />
          <Switch
            checked={hideEmpty}
            onChange={setHideEmpty}
            label={t('commerce.compare.hideEmpty')}
          />
        </div>
        <div className="industria-compare-toolbar__right">
          <ExportPdfButton
            disabled={view.products.length === 0}
            locale={locale}
            hideEmptyRows={hideEmpty}
            salesChannelCode={props.salesChannelCode}
          />
          <CopyShareLinkButton shareToken={view.shareToken} locale={locale} />
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={(): void => void onDelete()}
          >
            <TrashIcon /> {t('commerce.compare.clear')}
          </button>
        </div>
      </div>

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
                        <img src={toAbsoluteAssetUrl(p.primaryAssetUrl)} alt={localised(p.name)} loading="lazy" />
                      ) : (
                        <PlaceholderGlyph />
                      )}
                    </div>
                    <div className="industria-cmp-card__sku">{p.sku}</div>
                    <LocalizedAnchor
                      href={`/p/${p.slug}`}
                      className="industria-cmp-card__name"
                    >
                      {localised(p.name)}
                    </LocalizedAnchor>
                    <div className="industria-cmp-card__price">
                      {p.price
                        ? `${p.price.amount} ${p.price.currency}`
                        : '—'}
                    </div>
                    <button
                      type="button"
                      className="industria-cmp-card__remove"
                      onClick={(): void => void onRemove(p.id)}
                      aria-label={format(t('commerce.compare.removeProduct'), { name: localised(p.name) })}
                      title={t('commerce.compare.remove')}
                    >
                      <XIcon />
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
                  {hideEmpty ? t('commerce.compare.allRowsEmpty') : t('commerce.compare.noRows')}
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
              <th scope="row">{t('commerce.compare.actionRow')}</th>
              {view.products.map((p) => (
                <td key={p.id}>
                  <div className="industria-compare-table__actions">
                    <CompareAddToCartButton
                      productId={p.id}
                      disabled={!p.available}
                      minOrderQuantity={p.minOrderQuantity ?? null}
                      locale={locale}
                    />
                    <LocalizedAnchor href={`/p/${p.slug}`} className="btn btn--outline btn--sm">
                      {t('commerce.compare.productPage')}
                    </LocalizedAnchor>
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

function ExportPdfButton(props: {
  disabled: boolean;
  locale: string;
  hideEmptyRows: boolean;
  salesChannelCode: string | undefined;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = tForLocale(props.locale);
  const onClick = async (): Promise<void> => {
    if (busy || props.disabled) return;
    setBusy(true);
    setError(null);
    try {
      // The language the page is shown in and the rows it shows (FR-020, FR-032).
      await exportComparisonPdf({
        locale: props.locale,
        hideEmptyRows: props.hideEmptyRows,
        channelCode: props.salesChannelCode,
      });
    } catch {
      // FR-035 — the existing "PDF could not be generated" message, in the
      // buyer's language whatever the API answered in.
      setError(t('compare.pdf.failed'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={busy || props.disabled}
        onClick={(): void => void onClick()}
      >
        <DownloadIcon /> {busy ? t('compare.pdf.busy') : t('commerce.compare.pdf')}
      </button>
      {error ? <span className="b2b-compare__pdf-error">{error}</span> : null}
    </>
  );
}

function CopyShareLinkButton(props: { shareToken: string; locale: string }): ReactNode {
  const t = tForLocale(props.locale);
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
      // Safari without clipboard permission — best-effort.
    }
  };
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      onClick={(): void => void onCopy()}
    >
      <LinkIcon /> {copied ? t('commerce.compare.copied') : t('commerce.compare.shareLink')}
    </button>
  );
}

function EmptyState(props: { text: string }): ReactNode {
  return (
    <div className="industria-compare-page">
      <p className="muted">{props.text}</p>
    </div>
  );
}

/**
 * Filter comparison rows by the active display mode. Exported for unit testing
 * the "show only differences" behaviour (feature 044 / US6) — the table itself
 * fetches on mount, so the toggle is otherwise device-verified.
 */
export function filterRowsByMode(
  rows: ComparisonAttributeRow[],
  mode: ComparisonDisplayMode,
): ComparisonAttributeRow[] {
  if (mode === 'differences') return rows.filter((r) => r.rowClass === 'different');
  if (mode === 'common') return rows.filter((r) => r.rowClass === 'common');
  return rows;
}

/**
 * A product name or attribute label in the page's language: the exact locale,
 * then its language, then English, then whatever the map holds.
 */
export function localisedValue(value: Record<string, string>, locale: string): string {
  const language = locale.split('-')[0] ?? locale;
  return (
    value[locale] ??
    value[language] ??
    value['en-US'] ??
    value['en'] ??
    Object.values(value)[0] ??
    ''
  );
}

function toMessage(err: unknown): string | null {
  if (err instanceof ComparisonApiError) return err.message;
  return err instanceof Error ? err.message : null;
}

/* Inline SVG icons — same stroke set as the rest of the Industria header. */

function svg(children: ReactNode, size = 14): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function XIcon(): ReactNode {
  return svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    12,
  );
}
function DownloadIcon(): ReactNode {
  return svg(
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </>,
    13,
  );
}
function LinkIcon(): ReactNode {
  return svg(
    <>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </>,
    13,
  );
}
function TrashIcon(): ReactNode {
  return svg(
    <>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </>,
    13,
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
