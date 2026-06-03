import Link from 'next/link';
import type { ReactNode } from 'react';
import type { I18nConfigResponse, ResolvedMegamenu } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { CategoriesMega } from './Megamenu/CategoriesMega';
import { CompareCounterLink } from './CompareToggle';
import { CartCounterBadge } from './CartCounterBadge';
import { SearchAutocomplete } from './SearchAutocomplete';
import { CurrencyPicker } from '../lib/dictionary/pickers/CurrencyPicker';
import { LanguagePicker } from '../lib/dictionary/pickers/LanguagePicker';

/**
 * Industria-themed storefront header. Three rows:
 *   1) top utility strip (phone, shipping cutoff, Faktura VAT chip,
 *      NIP chip, currency/locale, B2B support),
 *   2) main header (brand mark + search + icon buttons + user pill),
 *   3) main nav (categories + status pill + Quick Order CTA).
 *
 * The component is server-rendered; only the search autocomplete and
 * compare counter hydrate on the client.
 */
export function Header(props: {
  config: I18nConfigResponse;
  locale: string;
  /** Optional sales-channel code for the autocomplete's `X-Sales-Channel` header. */
  salesChannelCode?: string;
  /** Feature 027 — buyer's cart line count for the icon-btn badge. */
  cartItemCount?: number;
  /** Feature 015 — resolved megamenu powering the "Wszystkie kategorie" panel. */
  megamenu?: ResolvedMegamenu | null;
}): ReactNode {
  const t = tForLocale(props.locale);
  const apiBaseUrl =
    process.env['NEXT_PUBLIC_BACKEND_BASE_URL'] ??
    process.env['BACKEND_BASE_URL'] ??
    'http://localhost:3001';

  return (
    <>
      <div className="industria-topbar">
        <div className="mx-auto max-w-[1360px] px-[24px] industria-topbar__inner">
          <div className="industria-topbar__left">
            <span className="industria-topbar__item">
              <PhoneIcon /> +48 22 397 12 84
            </span>
            <span className="industria-topbar__sep" aria-hidden="true" />
            <span className="industria-topbar__item">
              <TruckIcon /> Wysyłka dziś, jeśli zamówisz do 14:00
            </span>
            <span className="industria-topbar__sep" aria-hidden="true" />
            <span className="industria-topbar__item">
              <DocIcon /> Faktura VAT
            </span>
          </div>
          <div className="industria-topbar__right">
            <span className="industria-topbar__chip">
              <strong>NIP</strong> 5252736418
            </span>
            <CurrencySwitcher />
            <span className="industria-topbar__sep" aria-hidden="true" />
            <a href="/help" className="industria-topbar__item">
              <HelpIcon /> Wsparcie B2B
            </a>
            {props.config.languages.length > 1 ? (
              <LocaleSwitcher locale={props.locale} />
            ) : null}
          </div>
        </div>
      </div>

      <header className="industria-header">
        <div className="mx-auto max-w-[1360px] px-[24px] industria-header__inner">
          <Link href="/" className="industria-header__brand">
            <span className="industria-header__mark">IN</span>
            <span className="industria-header__brand__name">
              Industria
              <small>B2B · Komponenty przemysłowe</small>
            </span>
          </Link>
          <form
            action="/search"
            method="GET"
            className="industria-search b2b-header__search"
            role="search"
          >
            <span className="industria-search__icon" aria-hidden="true">
              <SearchIcon />
            </span>
            <SearchAutocomplete
              apiBaseUrl={apiBaseUrl}
              locale={props.locale}
              placeholder={t('search.placeholder')}
              searchActionLabel={t('common.searchAction')}
              seeAllResultsLabel={t('search.seeAllResults')}
              unavailableLabel={t('search.unavailable')}
              requestQuoteLabel={t('product.requestQuote')}
              showKeyboardHint
              {...(props.salesChannelCode !== undefined
                ? { salesChannelCode: props.salesChannelCode }
                : {})}
            />
          </form>
          <div className="industria-header__actions">
            <Link href="/account/wishlist" className="icon-btn" aria-label="Ulubione">
              <HeartIcon />
            </Link>
            <CompareCounterLink
              href="/compare"
              ariaLabel="Porównaj produkty"
              icon={<CompareIcon />}
            />
            <Link href="/account/notifications" className="icon-btn" aria-label="Powiadomienia">
              <BellIcon />
            </Link>
            <CartCounterBadge
              initialCount={props.cartItemCount ?? 0}
              apiBase={apiBaseUrl}
              emptyAriaLabel="Koszyk"
              itemsAriaLabelTemplate="Koszyk · {count} pozycji"
            />
            <Link href="/account" className="industria-header__user">
              <span className="industria-header__user__avatar">MK</span>
              <span className="industria-header__user__name">
                <strong>Marek Kowalski</strong>
                <em>Stalmontaż Sp. z o.o.</em>
              </span>
              <ChevDownIcon />
            </Link>
          </div>
        </div>
      </header>

      <nav className="industria-nav" aria-label="Primary">
        <div className="mx-auto max-w-[1360px] px-[24px] industria-nav__inner">
          {/* Data-driven "Wszystkie kategorie" trigger + mega panel
              (seeded "Main navigation"). Replaces the old static link and
              the hardcoded per-category links. */}
          <CategoriesMega megamenu={props.megamenu ?? null} />
          <div className="industria-nav__right">
            <span className="industria-nav__pill" role="status">
              <span className="industria-nav__pill__dot" aria-hidden="true" />
              System sprzedażowy aktywny
            </span>
            <Link href="/quote-requests" className="industria-nav__btn">RFQ</Link>
            <Link
              href="/quick-order"
              className="industria-nav__btn industria-nav__btn--primary"
            >
              <LightningIcon /> Quick Order
            </Link>
          </div>
        </div>
      </nav>
    </>
  );
}

function LocaleSwitcher(props: { locale: string }): ReactNode {
  return (
    <form action="" method="GET" className="industria-topbar__switcher">
      <label htmlFor="b2b-locale">Język:</label>
      <LanguagePicker id="b2b-locale" name="lang" defaultValue={props.locale} />
    </form>
  );
}

function CurrencySwitcher(): ReactNode {
  return (
    <form action="" method="GET" className="industria-topbar__switcher">
      <label htmlFor="b2b-currency">Waluta:</label>
      <CurrencyPicker id="b2b-currency" name="currency" />
    </form>
  );
}

/* Inline SVG icons — kept tiny and consistent with the Industria icon set */

function svg(children: ReactNode, size = 16): ReactNode {
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

function PhoneIcon(): ReactNode {
  return svg(
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
    13,
  );
}
function TruckIcon(): ReactNode {
  return svg(
    <>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </>,
    13,
  );
}
function DocIcon(): ReactNode {
  return svg(
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="14" y2="17" />
    </>,
    13,
  );
}
function HelpIcon(): ReactNode {
  return svg(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </>,
    13,
  );
}
function SearchIcon(): ReactNode {
  return svg(
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
    17,
  );
}
function HeartIcon(): ReactNode {
  return svg(
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
    19,
  );
}
function CompareIcon(): ReactNode {
  return svg(
    <>
      <path d="M3 6h13" />
      <path d="M3 6l4-4" />
      <path d="M3 6l4 4" />
      <path d="M21 18H8" />
      <path d="M21 18l-4-4" />
      <path d="M21 18l-4 4" />
    </>,
    19,
  );
}
function BellIcon(): ReactNode {
  return svg(
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </>,
    19,
  );
}
function ChevDownIcon(): ReactNode {
  return svg(<polyline points="6 9 12 15 18 9" />, 14);
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, 13);
}
