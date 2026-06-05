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
    <header className="industria-header b2b-checkout-header" role="banner">
      <div className="mx-auto flex h-[64px] max-w-[1360px] items-center justify-center px-[24px]">
        {/* Same brand mark as the full storefront header so the logo looks
            identical across checkout and the rest of the site. */}
        <Link
          href="/"
          className="industria-header__brand"
          aria-label="Industria — strona główna"
        >
          <span className="industria-header__mark">IN</span>
          <span className="industria-header__brand__name">
            Industria
            <small>B2B · Komponenty przemysłowe</small>
          </span>
        </Link>
      </div>
    </header>
  );
}
