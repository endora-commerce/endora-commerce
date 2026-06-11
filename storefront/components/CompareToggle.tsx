'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  ComparisonApiError,
  addProductToCompare,
  getMyComparison,
  removeProductFromCompare,
} from '../lib/api/comparisons';

/**
 * `<CompareToggle>` — feature 007 / T030.
 *
 * Per-product Compare button mounted on product cards and the product
 * detail page. Clicking it adds the product to the customer's
 * Comparison or removes it if it's already there. State is the
 * authoritative server state — no localStorage cache; the button
 * refreshes from the backend on mount and after each toggle.
 *
 * Renders inert SSR-side so non-JS visitors never see a non-functional
 * control (Constitution Principle VII).
 */
export function CompareToggle(props: { productId: string }): ReactNode {
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const view = await getMyComparison();
        if (!cancelled) {
          setActive(view?.products.some((p) => p.id === props.productId) ?? false);
          setHydrated(true);
        }
      } catch {
        if (!cancelled) setHydrated(true); // hide the "loading…" but don't paint an error inline
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.productId]);

  if (!hydrated) return null;

  const onClick = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (active) {
        await removeProductFromCompare(props.productId);
        setActive(false);
      } else {
        await addProductToCompare(props.productId);
        setActive(true);
      }
      // Notify any listening counter pill to refresh.
      window.dispatchEvent(new CustomEvent('b2b:compare:changed'));
    } catch (err) {
      setError(
        err instanceof ComparisonApiError ? err.message : 'Could not update compare set.',
      );
    } finally {
      setBusy(false);
    }
  };

  const compareLabel = active ? 'Usuń z porównania' : 'Dodaj do porównania';

  return (
    <>
      <div className="group absolute right-[10px] top-[10px] z-[2]">
        <button
          type="button"
          className={`flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-[6px] border transition disabled:cursor-wait disabled:opacity-50 ${
            active
              ? 'border-accent bg-accent text-white'
              : 'border-line bg-surface text-fg-soft hover:border-[var(--ink-700)] hover:text-fg'
          }`}
          aria-pressed={active}
          disabled={busy}
          onClick={(): void => void onClick()}
          aria-label={compareLabel}
          title={compareLabel}
        >
          <CompareIcon />
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-[color:var(--ink-900)] px-2 py-1 text-[11px] text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {compareLabel}
        </span>
      </div>
      {error ? (
        <span className="absolute bottom-[8px] left-[8px] right-[8px] block rounded bg-bad-soft px-[6px] py-[4px] text-[10px] text-bad">
          {error}
        </span>
      ) : null}
    </>
  );
}

function CompareIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 6h13" />
      <path d="M3 6l4-4" />
      <path d="M3 6l4 4" />
      <path d="M21 18H8" />
      <path d="M21 18l-4-4" />
      <path d="M21 18l-4 4" />
    </svg>
  );
}

/**
 * Header icon-button linking to `/compare` with a numeric badge showing
 * the current Comparison size. Always rendered (matches the Industria
 * design's icon-row); the badge appears only when size > 0. Refreshes
 * on mount and on the `b2b:compare:changed` event the toggle dispatches.
 *
 * `label` and `ariaLabel` come in as already-translated strings so this
 * client component stays free of i18n boundaries.
 */
export function CompareCounterLink(props: {
  href: string;
  ariaLabel: string;
  /** Inline SVG passed in from the server-rendered header. */
  icon: ReactNode;
}): ReactNode {
  const [size, setSize] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const view = await getMyComparison();
        if (!cancelled) setSize(view?.products.length ?? 0);
      } catch {
        if (!cancelled) setSize(0);
      }
    };
    void refresh();
    const onChange = (): void => void refresh();
    window.addEventListener('b2b:compare:changed', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:compare:changed', onChange);
    };
  }, []);

  const label = size > 0 ? `${props.ariaLabel} · ${size}` : props.ariaLabel;
  return (
    <a href={props.href} className="icon-btn" aria-label={label}>
      {props.icon}
      {size > 0 ? (
        <span className="icon-btn__count" aria-hidden="true">
          {size > 99 ? '99+' : size}
        </span>
      ) : null}
    </a>
  );
}
