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
import {
  getSuggestions,
  SearchSuggestError,
  type SuggestResponse,
} from '../lib/api/search';

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
   * Translated "see all results" link label. Kept as a plain string so
   * the prop is serialisable across the Server → Client component
   * boundary (Next.js 15+ rejects functions as props from Server
   * Components).
   */
  seeAllResultsLabel: string;
  unavailableLabel: string;
}

export function SearchAutocomplete(props: SearchAutocompleteProps): ReactNode {
  const [value, setValue] = useState('');
  const [response, setResponse] = useState<SuggestResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [open, setOpen] = useState(false);
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
        window.location.href = `/products/${encodeURIComponent(hit.slug)}`;
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
      <button type="submit">{props.searchActionLabel}</button>
      {showPopup ? (
        <ul
          className="b2b-search-autocomplete__popup"
          role="listbox"
          aria-label={props.searchActionLabel}
        >
          {unavailable ? (
            <li className="b2b-search-autocomplete__unavailable" aria-disabled="true">
              {props.unavailableLabel}
            </li>
          ) : (
            <>
              {response?.data.map((p, i) => (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`b2b-search-autocomplete__hit${
                    i === activeIndex ? ' is-active' : ''
                  }`}
                >
                  <a href={`/products/${encodeURIComponent(p.slug)}`}>{p.name}</a>
                </li>
              ))}
              <li className="b2b-search-autocomplete__see-all">
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
