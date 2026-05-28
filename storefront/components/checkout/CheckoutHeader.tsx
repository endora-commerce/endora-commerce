import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Minimal checkout chrome (feature 036, US5). On `/checkout*` routes the root
 * layout swaps the full storefront header (nav, search, mega-menu, cart) for
 * this single-element header — only the brand logo — to remove distractions
 * from the buyer's path to "Place order".
 */
export function CheckoutHeader(): ReactNode {
  return (
    <header
      className="b2b-checkout-header"
      role="banner"
      style={{
        padding: '16px 24px',
        borderBottom: '1px solid var(--b2b-border-color, #e5e7eb)',
        textAlign: 'center',
      }}
    >
      <Link
        href="/"
        className="b2b-checkout-header__logo"
        aria-label="B2B Platform — go to home"
        style={{ fontWeight: 700, fontSize: '20px', color: 'inherit', textDecoration: 'none' }}
      >
        B2B Platform
      </Link>
    </header>
  );
}
