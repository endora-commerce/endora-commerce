import type { ReactNode } from 'react';
import { LocalizedLink } from '../../lib/i18n/localized-link';
import { tForLocale } from '../../lib/i18n/messages';
import { format } from '../../lib/i18n/format';
import { getServerContext } from '../../lib/server-context';

/**
 * The reference theme's brand mark and name — a brand, not copy, so the same in
 * every language. The tagline beneath it is copy, and comes from the catalogue.
 */
const BRAND_MARK = 'IN';
const BRAND_NAME = 'Industria';

/**
 * Minimal checkout chrome (feature 036, US5). On `/checkout*` routes the root
 * layout swaps the full storefront header (nav, search, mega-menu, cart) for
 * this single-element header — only the brand logo — to remove distractions
 * from the buyer's path to "Place order".
 *
 * A server component that reads the request's language itself (as
 * `CartMergeToast` does), so the layout renders it as `<CheckoutHeader />` with
 * nothing to thread.
 */
export async function CheckoutHeader(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  return <CheckoutHeaderView locale={locale} />;
}

/** The header itself, in `locale`. */
export function CheckoutHeaderView(props: { locale: string }): ReactNode {
  const t = tForLocale(props.locale);
  return (
    <header className="industria-header b2b-checkout-header" role="banner">
      <div className="mx-auto flex h-[64px] max-w-[1360px] items-center justify-center px-[24px]">
        {/* Same brand mark as the full storefront header so the logo looks
            identical across checkout and the rest of the site. */}
        <LocalizedLink
          href="/"
          className="industria-header__brand"
          aria-label={format(t('commerce.checkoutHeader.homeLabel'), { brand: BRAND_NAME })}
        >
          <span className="industria-header__mark">{BRAND_MARK}</span>
          <span className="industria-header__brand__name">
            {BRAND_NAME}
            <small>{t('commerce.checkoutHeader.tagline')}</small>
          </span>
        </LocalizedLink>
      </div>
    </header>
  );
}
