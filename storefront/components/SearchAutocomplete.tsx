'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { SearchSuggestItem } from '@endora-commerce/contracts';
import {
  getSuggestions,
  SearchSuggestError,
  type SuggestResponse,
} from '../lib/api/search';
import { toAbsoluteAssetUrl } from '../lib/asset-url';

/**
 * SearchAutocomplete — feature 006 / US1 / T015.
 *
 * Progressive enhancement on top of the existing
 * `<form action="/search" method="GET">` in the page header. When the
 * browser has JS, this component owns the input value, debounces typing,
 * and renders a popup of typeahead suggestions backed by
 * `GET /api/v1/search/suggest`. When JS is absent, the component never
 * mounts, the static `<input name="q">` keeps working, and the form
 * submits to `/search?q=…` natively (Constitution VII).
 *
 * Keyboard model: Arrow up/down moves selection; Enter on a selected
 * suggestion navigates to its product (and on no selection, falls
 * through to the form's native submit which lands on `/search?q=…`);
 * Escape closes the popup and returns focus to the input; clicking
 * outside the component hides the popup.
 */

const DEBOUNCE_MS = 200;

export interface SearchAutocompleteProps {
  /** Backend base URL passed in from the server-rendered shell. */
  apiBaseUrl: string;
  /** Active locale — drives the currency/number formatting of suggestion prices. */
  locale: string;
  /** Suggestion-count default until the first response echoes the resolved value. */
  initialLimit?: number;
  /** Minimum-query-length default until the first response echoes the resolved value. */
  initialMinimumQueryLength?: number;
  /** Forwarded as `X-Sales-Channel`. */
  salesChannelCode?: string;
  /** Translated placeholder + button label (matches the server-rendered fallback). */
  placeholder: string;
  searchActionLabel: string;
  /**
   * Translated label shown in the price slot when the resolved
   * `priceDisplayMode` is `none` (price hidden for this customer).
   */
  requestQuoteLabel: string;
  /**
   * Translated "see all results" link label. Kept as a plain string so
   * the prop is serialisable across the Server → Client component
   * boundary (Next.js 15+ rejects functions as props from Server
   * Components).
   */
  seeAllResultsLabel: string;
  unavailableLabel: string;
  /**
   * When true, render the keyboard-shortcut hint (`⌘K` on macOS,
   * `Ctrl K` elsewhere) inside the search frame and bind a global
   * `Cmd/Ctrl+K` handler that focuses the input. Hydration-only —
   * the SSR markup always paints `⌘K`, and the client swaps it after
   * platform detection if needed.
   */
  showKeyboardHint?: boolean;
}

export function SearchAutocomplete(props: SearchAutocompleteProps): ReactNode {
  const [value, setValue] = useState('');
  const [response, setResponse] = useState<SuggestResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [open, setOpen] = useState(false);
  /**
   * Platform-aware modifier label for the keyboard hint. Initial value
   * matches the SSR-rendered `⌘K` so hydration stays stable; the
   * effect below corrects it to `Ctrl K` on non-Apple platforms.
   */
  const [modifierLabel, setModifierLabel] = useState<'⌘K' | 'Ctrl K'>('⌘K');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const minimumQueryLength =
    response?.meta.minimumQueryLength ?? props.initialMinimumQueryLength ?? 3;

  // Debounced fetch.
  useEffect(() => {
    const trimmed = value.trim();
    if (trimmed.length < minimumQueryLength) {
      setResponse(null);
      setUnavailable(false);
      setActiveIndex(-1);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await getSuggestions({
            apiBaseUrl: props.apiBaseUrl,
            q: trimmed,
            ...(props.initialLimit !== undefined ? { limit: props.initialLimit } : {}),
            ...(props.salesChannelCode !== undefined
              ? { salesChannelCode: props.salesChannelCode }
              : {}),
            signal: ac.signal,
          });
          setResponse(next);
          setUnavailable(false);
          setActiveIndex(-1);
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') return;
          if (err instanceof SearchSuggestError && err.code === 'QUERY_TOO_SHORT') {
            // Server-side threshold disagreed with our local view (e.g. it
            // changed since the page rendered) — refresh from the response
            // metadata next time the user types.
            setResponse(null);
            setUnavailable(false);
            return;
          }
          if (err instanceof SearchSuggestError && err.status === 503) {
            setUnavailable(true);
            setResponse(null);
            return;
          }
          // Any other error: hide the popup but leave the static form working.
          setResponse(null);
          setUnavailable(false);
        }
      })();
    }, DEBOUNCE_MS);

    return (): void => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [
    value,
    minimumQueryLength,
    props.apiBaseUrl,
    props.initialLimit,
    props.salesChannelCode,
  ]);

  // Hide popup on outside click.
  useEffect(() => {
    function handle(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Platform detection + global Cmd/Ctrl+K shortcut to focus the search.
  // Active only when the caller opted into the keyboard hint UI, since
  // a non-visible binding would surprise users (no discoverable cue).
  useEffect(() => {
    if (!props.showKeyboardHint) return undefined;
    // Browsers still expose `navigator.platform`; the newer
    // `userAgentData.platform` is Chromium-only. Fall back to UA string.
    const platform =
      typeof navigator === 'undefined'
        ? ''
        : navigator.platform || navigator.userAgent;
    const isApple = /Mac|iPhone|iPad|iPod/i.test(platform);
    setModifierLabel(isApple ? '⌘K' : 'Ctrl K');

    function onKey(e: globalThis.KeyboardEvent): void {
      if (e.repeat) return;
      if (e.key.toLowerCase() !== 'k') return;
      const usesMeta = isApple ? e.metaKey : e.ctrlKey;
      if (!usesMeta) return;
      e.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
      setOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return (): void => document.removeEventListener('keydown', onKey);
  }, [props.showKeyboardHint]);

  const showPopup = useMemo<boolean>(() => {
    if (!open) return false;
    if (unavailable) return true;
    if (response && response.data.length > 0) return true;
    return false;
  }, [open, unavailable, response]);

  function onChange(e: ChangeEvent<HTMLInputElement>): void {
    setValue(e.target.value);
    setOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>): void {
    if (!response || response.data.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(response.data.length - 1, i + 1));
      setOpen(true);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      const hit = response.data[activeIndex];
      if (hit) {
        e.preventDefault();
        window.location.href = `/p/${encodeURIComponent(hit.slug)}`;
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={containerRef} className="b2b-search-autocomplete">
      <input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={onChange}
        onFocus={(): void => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={props.placeholder}
        aria-label={props.searchActionLabel}
        aria-autocomplete="list"
        aria-expanded={showPopup}
        autoComplete="off"
      />
      {props.showKeyboardHint ? (
        <kbd className="industria-search__kbd" aria-hidden="true">
          {modifierLabel}
        </kbd>
      ) : null}
      <button type="submit" className="industria-search__cta">
        {props.searchActionLabel}
      </button>
      {showPopup ? (
        <ul
          className="absolute left-0 right-0 top-full z-50 m-0 mt-1 max-h-[400px] list-none overflow-auto rounded-md border border-line bg-surface py-1 shadow-lg"
          role="listbox"
          aria-label={props.searchActionLabel}
        >
          {unavailable ? (
            <li className="px-3 py-2 text-[13px] text-muted" aria-disabled="true">
              {props.unavailableLabel}
            </li>
          ) : (
            <>
              {response?.data.map((p, i) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`text-[13px] ${
                    i === activeIndex ? 'bg-surface-alt' : 'hover:bg-surface-alt'
                  }`}
                >
                  <a
                    href={`/p/${encodeURIComponent(p.slug)}`}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <span className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded border border-line bg-surface-alt">
                      {p.primaryAssetUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={toAbsoluteAssetUrl(p.primaryAssetUrl)}
                          alt=""
                          loading="lazy"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span
                          className="h-1/2 w-1/2 rounded-sm opacity-40 bg-[repeating-linear-gradient(45deg,var(--ink-200),var(--ink-200)_4px,transparent_4px,transparent_8px)]"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-fg">{p.name}</span>
                      <span className="truncate font-mono text-[11px] text-muted">
                        {p.sku}
                      </span>
                    </span>
                    <span className="flex-none whitespace-nowrap text-right">
                      {renderSuggestionPrice(p, props.locale, props.requestQuoteLabel)}
                    </span>
                  </a>
                </li>
              ))}
              <li className="text-[13px] font-medium text-accent [&>a]:block [&>a]:px-3 [&>a]:py-2 hover:bg-surface-alt">
                <a href={`/search?q=${encodeURIComponent(value.trim())}`}>
                  {props.seeAllResultsLabel}
                </a>
              </li>
            </>
          )}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Price slot for one suggestion. Honours the per-customer price-list
 * resolution the backend attaches:
 *   - `priceDisplayMode === 'none'` → the price is hidden for this customer;
 *     show the "request a quote" label instead.
 *   - a resolved sale price → show it, with the base price struck through.
 *   - otherwise → the resolved base price, falling back to the legacy
 *     `ProductSummary.price` projection when the resolver wasn't wired.
 */
function renderSuggestionPrice(
  p: SearchSuggestItem,
  locale: string,
  requestQuoteLabel: string,
): ReactNode {
  if (p.priceDisplayMode === 'none') {
    return (
      <span className="text-[11px] font-medium text-muted">{requestQuoteLabel}</span>
    );
  }

  const base = p.basePrice
    ? formatMoney(p.basePrice.amount, p.basePrice.currency, locale)
    : p.price
      ? formatMoney(p.price.amount, p.price.currency, locale)
      : null;
  const sale = p.salePrice
    ? formatMoney(p.salePrice.amount, p.salePrice.currency, locale)
    : null;

  if (sale) {
    return (
      <span className="flex flex-col items-end leading-tight">
        <span className="font-mono text-[13px] font-semibold text-fg">{sale}</span>
        {base ? (
          <span className="font-mono text-[11px] text-muted line-through">{base}</span>
        ) : null}
      </span>
    );
  }
  if (base) {
    return <span className="font-mono text-[13px] font-semibold text-fg">{base}</span>;
  }
  return <span className="text-[11px] font-medium text-muted">{requestQuoteLabel}</span>;
}

function formatMoney(
  amount: string | number,
  currency: string,
  locale: string,
): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}
