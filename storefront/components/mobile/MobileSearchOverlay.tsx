'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getSuggestions, SearchSuggestError, type SuggestResponse } from '../../lib/api/search';

const DEBOUNCE_MS = 200;

/**
 * Feature 044 / US5 — full-screen mobile search overlay (Industria Mobile
 * design §01). Tapping the header search field opens a full-screen, auto-
 * focused search that reuses the existing `getSuggestions` typeahead path and
 * shows product suggestions, category/brand shortcut pills, and a
 * "show all results" action. Shown only on phones (`.m-search-overlay` is
 * `md:hidden`).
 */
export function MobileSearchOverlay(props: {
  apiBaseUrl: string;
  locale: string;
  salesChannelCode?: string;
  placeholder: string;
  seeAllResultsLabel: string;
  /** Category/brand shortcut pills (top departments from the megamenu). */
  quickLinks?: { label: string; href: string }[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [response, setResponse] = useState<SuggestResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const minLen = response?.meta.minimumQueryLength ?? 3;

  // Focus the input + lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Debounced suggestion fetch — mirrors SearchAutocomplete's data path.
  useEffect(() => {
    if (!open || trimmed.length < minLen) {
      setResponse(null);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const next = await getSuggestions({
            apiBaseUrl: props.apiBaseUrl,
            q: trimmed,
            ...(props.salesChannelCode !== undefined
              ? { salesChannelCode: props.salesChannelCode }
              : {}),
            signal: ac.signal,
          });
          setResponse(next);
        } catch (err) {
          if ((err as { name?: string }).name === 'AbortError') return;
          if (err instanceof SearchSuggestError) {
            setResponse(null);
            return;
          }
          setResponse(null);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [open, trimmed, minLen, props.apiBaseUrl, props.salesChannelCode]);

  const suggestions = response?.data ?? [];
  const seeAllHref = `/search?q=${encodeURIComponent(trimmed)}`;

  return (
    <>
      <button
        type="button"
        className="industria-search w-full items-center text-left"
        onClick={() => setOpen(true)}
        aria-label={props.placeholder}
      >
        <span className="industria-search__icon" aria-hidden="true">
          <SearchIcon />
        </span>
        <span className="flex flex-1 items-center px-[8px] text-[14px] text-subtle">
          {props.placeholder}
        </span>
      </button>

      {open ? (
        <div className="m-search-overlay" role="dialog" aria-modal="true" aria-label={props.placeholder}>
          <div className="flex items-center gap-2 border-b border-line px-[12px] py-[10px]">
            <button
              type="button"
              className="icon-btn"
              onClick={() => setOpen(false)}
              aria-label="Wstecz"
            >
              <ChevLeftIcon />
            </button>
            <div className="industria-search flex-1 items-center">
              <span className="industria-search__icon" aria-hidden="true">
                <SearchIcon />
              </span>
              <input
                ref={inputRef}
                type="search"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={props.placeholder}
                aria-label={props.placeholder}
                autoComplete="off"
                className="min-w-0 flex-1 border-0 bg-transparent px-[8px] text-[14px] text-fg outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && trimmed) window.location.href = seeAllHref;
                }}
              />
              {value ? (
                <button
                  type="button"
                  className="px-[10px] text-subtle"
                  onClick={() => setValue('')}
                  aria-label="Wyczyść"
                >
                  <XIcon />
                </button>
              ) : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {trimmed.length >= minLen ? (
              <>
                <div className="px-[16px] pt-[14px] pb-[6px] font-mono text-[11px] uppercase tracking-[0.06em] text-subtle">
                  Podpowiedzi
                </div>
                {suggestions.map((p) => (
                  <Link
                    key={p.id}
                    href={`/p/${encodeURIComponent(p.slug)}`}
                    className="flex items-center gap-3 border-b border-line px-[16px] py-[11px]"
                    onClick={() => setOpen(false)}
                  >
                    <span className="flex h-[42px] w-[42px] flex-none items-center justify-center overflow-hidden rounded-[9px] border border-line bg-surface-alt">
                      {p.primaryAssetUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.primaryAssetUrl}
                          alt=""
                          loading="lazy"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span
                          className="h-2/3 w-2/3 rounded-sm opacity-40 bg-[repeating-linear-gradient(45deg,var(--ink-200),var(--ink-200)_4px,transparent_4px,transparent_8px)]"
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[13.5px] font-medium text-fg">{p.name}</span>
                      <span className="truncate font-mono text-[11px] text-subtle">{p.sku}</span>
                    </span>
                    <span className="text-subtle" aria-hidden="true">
                      <ArrowUpRightIcon />
                    </span>
                  </Link>
                ))}
                <div className="px-[16px] py-[16px]">
                  <Link
                    href={seeAllHref}
                    className="btn btn--dark btn--block"
                    onClick={() => setOpen(false)}
                  >
                    <SearchIcon /> {props.seeAllResultsLabel}
                  </Link>
                </div>
              </>
            ) : (
              <div className="px-[16px] pt-[14px]">
                <div className="mb-[10px] font-mono text-[11px] uppercase tracking-[0.06em] text-subtle">
                  Kategorie
                </div>
                <div className="flex flex-wrap gap-2">
                  {(props.quickLinks ?? []).map((q) => (
                    <Link
                      key={q.href + q.label}
                      href={q.href}
                      className="inline-flex items-center rounded-full border border-line bg-surface px-[14px] py-[7px] text-[13px] text-fg-soft"
                      onClick={() => setOpen(false)}
                    >
                      {q.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function svg(children: ReactNode, size = 18): ReactNode {
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
function SearchIcon(): ReactNode {
  return svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
  );
}
function ChevLeftIcon(): ReactNode {
  return svg(<polyline points="15 18 9 12 15 6" />, 22);
}
function XIcon(): ReactNode {
  return svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    17,
  );
}
function ArrowUpRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </>,
    16,
  );
}
