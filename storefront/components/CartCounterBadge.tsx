'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Header cart icon + count badge — client component that hydrates with
 * the count fetched server-side in `app/layout.tsx` and refreshes when
 * something on the page dispatches the `b2b:cart:changed` custom event
 * (e.g. `<CompareAddToCartButton>` on the /compare page).
 *
 * Most cart mutations go through server actions and trigger a full
 * server re-render — those paths don't need the event, the SSR-rendered
 * badge is already up to date. This component covers the client-only
 * mutation paths that can't invalidate the layout from the server.
 */
export function CartCounterBadge(props: {
  initialCount: number;
  apiBase: string;
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

  // Keep the badge in sync with the server-provided value across
  // navigation; the prop changes when the layout re-renders.
  useEffect(() => {
    setCount(props.initialCount);
  }, [props.initialCount]);

  useEffect(() => {
    const refresh = async (): Promise<void> => {
      try {
        const res = await fetch(`${props.apiBase}/api/v1/cart?view=mini`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { data?: { itemCount?: number } };
        const next = payload.data?.itemCount;
        if (typeof next === 'number') setCount(next);
      } catch {
        // Swallow — the badge stays at its current value rather than flashing 0.
      }
    };
    const onChanged = (): void => void refresh();
    window.addEventListener('b2b:cart:changed', onChanged);
    return () => window.removeEventListener('b2b:cart:changed', onChanged);
  }, [props.apiBase]);

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
