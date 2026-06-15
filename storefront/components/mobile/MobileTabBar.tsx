'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Feature 044 / US1 — fixed bottom tab bar (Industria Mobile design §01).
 *
 * The primary thumb-reachable navigation on phones; hidden at `md` and up
 * (the desktop header nav takes over). It is a leaf client island so the
 * data-loading layout stays a Server Component (Principle VII).
 *
 * The Cart tab carries a live count badge. Like {@link CartCounterBadge} the
 * count is hydrated from the server-provided `cartItemCount` and then kept in
 * sync: re-fetched on mount, on every client-side navigation, and whenever the
 * page dispatches `b2b:cart:changed` (so add/remove anywhere updates it).
 */
export function MobileTabBar(props: {
  /** Server-provided cart line count for the first paint (see app/layout.tsx). */
  cartItemCount?: number;
  /** Backend base URL for the live cart re-fetch. */
  apiBase: string;
  /** Localized tab captions. */
  labels: {
    home: string;
    quoteRequest: string;
    quickOrder: string;
    cart: string;
    account: string;
  };
}): ReactNode {
  const pathname = usePathname();
  const [count, setCount] = useState<number>(props.cartItemCount ?? 0);

  useEffect(() => {
    setCount(props.cartItemCount ?? 0);
  }, [props.cartItemCount]);

  useEffect(() => {
    let cancelled = false;
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
        if (!cancelled && typeof next === 'number') setCount(next);
      } catch {
        // Swallow — keep the last good value rather than flashing 0.
      }
    };
    void refresh();
    const onChanged = (): void => void refresh();
    window.addEventListener('b2b:cart:changed', onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('b2b:cart:changed', onChanged);
    };
  }, [props.apiBase, pathname]);

  const tabs: { href: string; label: string; icon: ReactNode; match: (p: string) => boolean }[] = [
    { href: '/', label: props.labels.home, icon: <HomeIcon />, match: (p) => p === '/' },
    {
      href: '/quote-request',
      label: props.labels.quoteRequest,
      icon: <QuoteIcon />,
      match: (p) => p.startsWith('/quote-request'),
    },
    {
      href: '/quick-order',
      label: props.labels.quickOrder,
      icon: <LightningIcon />,
      match: (p) => p.startsWith('/quick-order'),
    },
    {
      href: '/cart',
      label: props.labels.cart,
      icon: <CartIcon />,
      match: (p) => p.startsWith('/cart'),
      // count badge handled below
    },
    {
      href: '/account',
      label: props.labels.account,
      icon: <UserIcon />,
      match: (p) => p.startsWith('/account'),
    },
  ];

  return (
    <nav className="m-tabbar" aria-label="Mobile">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        const isCart = tab.href === '/cart';
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={'m-tabbar__item' + (active ? ' is-active' : '')}
            aria-current={active ? 'page' : undefined}
          >
            {isCart && count > 0 ? (
              <span className="m-tabbar__badge" aria-hidden="true">
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
            <span aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* Inline SVG icons — consistent stroke set with the Industria header icons. */
function svg(children: ReactNode): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={20}
      height={20}
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
function HomeIcon(): ReactNode {
  return svg(
    <>
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10h14V10" />
    </>,
  );
}
function QuoteIcon(): ReactNode {
  return svg(
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6" />
      <path d="M9 17h6" />
    </>,
  );
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);
}
function CartIcon(): ReactNode {
  return svg(
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </>,
  );
}
function UserIcon(): ReactNode {
  return svg(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
  );
}
