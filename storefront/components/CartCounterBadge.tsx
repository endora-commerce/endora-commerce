'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { loadCartItemCount } from '../lib/cartCount';

/**
 * Header cart icon + count badge — client component that hydrates with
 * the count fetched server-side in `app/layout.tsx` and then re-reads the
 * live count on mount, on every client-side navigation, and whenever the
 * page dispatches the `b2b:cart:changed` custom event. The re-read goes
 * through `loadCartItemCount` — a server action — never to the backend origin
 * from the browser, which does not hold the buyer's cart cookies.
 *
 * Why re-fetch on navigation: the badge lives in the root layout, whose
 * Server Component is NOT re-run on soft (client-side) navigations, so the
 * server-provided `initialCount` is only accurate for the page that was hard
 * loaded. Without the per-navigation refresh the badge would show a stale
 * count (e.g. 0 on the home page) even though the cart has items — the bug
 * this component is fixing.
 */
export function CartCounterBadge(props: {
  initialCount: number;
  /** aria-label shown when the cart is empty (e.g. "Koszyk"). */
  emptyAriaLabel: string;
  /**
   * aria-label template for a non-empty cart with `{count}` as the
   * placeholder (e.g. "Koszyk · {count} pozycji"). Kept as a plain
   * string because RSC forbids passing functions across the
   * server → client boundary.
   */
  itemsAriaLabelTemplate: string;
}): ReactNode {
  const [count, setCount] = useState<number>(props.initialCount);
  const pathname = usePathname();

  // Keep the badge in sync with the server-provided value when the layout is
  // hard-rendered; the prop changes when the layout actually re-runs.
  useEffect(() => {
    setCount(props.initialCount);
  }, [props.initialCount]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        // Through the storefront's own server: the cart identity cookies are
        // httpOnly and scoped to this origin, so a browser fetch to the
        // backend origin is answered for a caller with no cart.
        const next = await loadCartItemCount();
        if (!cancelled && next !== null) setCount(next);
      } catch {
        // Swallow — the badge stays at its current value rather than flashing 0.
      }
    };
    // Refresh on mount and on every client-side navigation (pathname change),
    // so the badge reflects the real cart on every page — not just the one
    // that was hard-loaded.
    void refresh();
    const onChanged = (): void => void refresh();
    window.addEventListener('b2b:cart:changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:cart:changed', onChanged);
    };
  }, [pathname]);

  const ariaLabel =
    count > 0
      ? props.itemsAriaLabelTemplate.replace('{count}', String(count))
      : props.emptyAriaLabel;

  return (
    <Link href="/cart" className="icon-btn" aria-label={ariaLabel}>
      <CartIcon />
      {count > 0 ? (
        <span className="icon-btn__count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

function CartIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={19}
      height={19}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </svg>
  );
}
