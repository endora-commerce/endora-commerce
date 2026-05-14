import Link from 'next/link';
import type { ReactNode } from 'react';
import type { I18nConfigResponse } from '@b2b/contracts';
import { tForLocale } from '../lib/i18n/messages';
import { CompareCounterLink } from './CompareToggle';
import { SearchAutocomplete } from './SearchAutocomplete';
import { CurrencyPicker } from '../lib/dictionary/pickers/CurrencyPicker';
import { LanguagePicker } from '../lib/dictionary/pickers/LanguagePicker';

/**
 * Industria-themed storefront header. Three rows:
 *   1) top utility strip (phone, shipping cutoff, NIP chip, locale + help),
 *   2) main header (brand mark + search + icon buttons + user pill),
 *   3) main nav (categories + RFQ + Quick Order CTA).
 *
 * The component is server-rendered; only the search autocomplete and
 * compare counter hydrate on the client.
 */
export function Header(props: {
  config: I18nConfigResponse;
  locale: string;
  /** Optional sales-channel code for the autocomplete's `X-Sales-Channel` header. */
  salesChannelCode?: string;
}): ReactNode {
  const t = tForLocale(props.locale);
  const apiBaseUrl =
    process.env['NEXT_PUBLIC_BACKEND_BASE_URL'] ??
    process.env['BACKEND_BASE_URL'] ??
    'http://localhost:3001';

  return (
    <>
      <div className="industria-topbar">
        <div className="container industria-topbar__inner">
          <div className="industria-topbar__left">
            <span>
              <PhoneIcon /> +48 22 397 12 84
            </span>
            <span>
              <TruckIcon /> Wysyłka dziś, jeśli zamówisz do 14:00
            </span>
            <span className="industria-topbar__chip">NIP 7251234567</span>
          </div>
          <div className="industria-topbar__right">
            <CurrencySwitcher />
            <a href="/help">
              <HelpIcon /> Wsparcie techniczne
            </a>
            {props.config.languages.length > 1 ? (
              <LocaleSwitcher locale={props.locale} />
            ) : null}
          </div>
        </div>
      </div>

      <header className="industria-header">
        <div className="container industria-header__inner">
          <Link href="/" className="industria-header__brand">
            <span className="industria-header__mark">IN</span>
            <span>
              Industria
              <small>B2B · komponenty przemysłowe</small>
            </span>
          </Link>
          <form action="/search" method="GET" className="industria-search b2b-header__search" role="search">
            <SearchAutocomplete
              apiBaseUrl={apiBaseUrl}
              placeholder={t('search.placeholder')}
              searchActionLabel={t('common.searchAction')}
              seeAllResultsLabel={t('search.seeAllResults')}
              unavailableLabel={t('search.unavailable')}
              {...(props.salesChannelCode !== undefined
                ? { salesChannelCode: props.salesChannelCode }
                : {})}
            />
          </form>
          <div className="industria-header__actions">
            <Link href="/account/wishlist" className="icon-btn" aria-label="Ulubione">
              <HeartIcon />
            </Link>
            <CompareCounterLink href="/compare" />
            <Link href="/cart" className="icon-btn" aria-label="Koszyk">
              <CartIcon />
            </Link>
            <Link href="/account" className="industria-header__user">
              <span className="industria-header__user__avatar">MK</span>
              <span>
                <strong>Marek Kowalski</strong>
                <em>Stalmontaż Sp. z o.o.</em>
              </span>
            </Link>
          </div>
        </div>
      </header>

      <nav className="industria-nav" aria-label="Primary">
        <div className="container industria-nav__inner">
          <Link href="/catalog" className="industria-nav__btn">
            <MenuIcon /> Wszystkie kategorie
          </Link>
          <Link href="/c/lozyska" className="industria-nav__btn">Łożyska</Link>
          <Link href="/c/napedy" className="industria-nav__btn">Napędy</Link>
          <Link href="/c/automatyka" className="industria-nav__btn">Automatyka</Link>
          <Link href="/c/elektryka" className="industria-nav__btn">Elektryka</Link>
          <Link href="/c/pneumatyka" className="industria-nav__btn">Pneumatyka</Link>
          <Link href="/c/narzedzia" className="industria-nav__btn">Narzędzia</Link>
          <span style={{ flex: 1 }} />
          <Link href="/quote-requests" className="industria-nav__btn">RFQ</Link>
          <Link href="/quick-order" className="industria-nav__btn industria-nav__btn--primary">
            <LightningIcon /> Quick Order
          </Link>
        </div>
      </nav>
    </>
  );
}

function LocaleSwitcher(props: { locale: string }): ReactNode {
  return (
    <form action="" method="GET" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <label htmlFor="b2b-locale" style={{ fontSize: 11, opacity: 0.85 }}>Język:</label>
      <LanguagePicker
        id="b2b-locale"
        name="lang"
        defaultValue={props.locale}
        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
      />
    </form>
  );
}

function CurrencySwitcher(): ReactNode {
  return (
    <form action="" method="GET" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <label htmlFor="b2b-currency" style={{ fontSize: 11, opacity: 0.85 }}>Waluta:</label>
      <CurrencyPicker
        id="b2b-currency"
        name="currency"
        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.16)', color: '#fff', fontSize: 11, padding: '2px 6px', borderRadius: 4 }}
      />
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
function HeartIcon(): ReactNode {
  return svg(
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
    16,
  );
}
function CartIcon(): ReactNode {
  return svg(
    <>
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
    </>,
    16,
  );
}
function MenuIcon(): ReactNode {
  return svg(
    <>
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>,
    14,
  );
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, 13);
}
