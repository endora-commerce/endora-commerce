'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Header heart icon + count badge for the customer's default shopping list.
 * Mirrors CartCounterBadge: hydrates, re-fetches the default list (id +
 * item count) on mount, on every client-side navigation, and whenever the
 * page dispatches `b2b:shopping-list:changed`. The icon links to the default
 * list's detail page so the heart always opens the default list.
 *
 * For signed-out visitors the default-list endpoint is unauthorised, so the
 * heart is a plain link to the shopping-lists area (which gates on login) and
 * shows no count.
 */
export function ShoppingListHeartBadge(props: {
  apiBase: string;
  loggedIn: boolean;
  ariaLabel: string;
}): ReactNode {
  const [count, setCount] = useState<number>(0);
  const [listId, setListId] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!props.loggedIn) return;
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const res = await fetch(`${props.apiBase}/api/v1/shopping-lists/default`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const payload = (await res.json()) as { data?: { id?: string; itemCount?: number } };
        if (cancelled) return;
        if (typeof payload.data?.itemCount === 'number') setCount(payload.data.itemCount);
        if (typeof payload.data?.id === 'string') setListId(payload.data.id);
      } catch {
        // Swallow — keep the current value rather than flashing.
      }
    };
    void refresh();
    const onChanged = (): void => void refresh();
    window.addEventListener('b2b:shopping-list:changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:shopping-list:changed', onChanged);
    };
  }, [props.apiBase, props.loggedIn, pathname]);

  const href = listId ? `/shopping-lists/${listId}` : '/shopping-lists';

  return (
    <Link href={href} className="icon-btn" aria-label={props.ariaLabel}>
      <HeartIcon />
      {count > 0 ? (
        <span className="icon-btn__count" aria-hidden="true">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </Link>
  );
}

function HeartIcon(): ReactNode {
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
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}
