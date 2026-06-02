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

  return (
    <>
      <button
        type="button"
        className={`absolute right-[10px] top-[10px] z-[2] cursor-pointer rounded-[6px] border px-[9px] py-[5px] font-mono text-[11px] transition disabled:cursor-wait disabled:opacity-50 ${
          active
            ? 'border-accent bg-accent text-white'
            : 'border-line bg-surface text-fg-soft hover:border-[var(--ink-700)] hover:text-fg'
        }`}
        aria-pressed={active}
        disabled={busy}
        onClick={(): void => void onClick()}
        title={active ? 'Remove from comparison' : 'Add to comparison'}
      >
        {active ? '✓ Compared' : 'Compare'}
      </button>
      {error ? (
        <span className="absolute bottom-[8px] left-[8px] right-[8px] block rounded bg-bad-soft px-[6px] py-[4px] text-[10px] text-bad">
          {error}
        </span>
      ) : null}
    </>
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
