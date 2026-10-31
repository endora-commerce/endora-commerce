import type { ReactNode } from 'react';
import type { I18nConfigResponse, ResolvedMegamenu } from '@endora-commerce/contracts';
import type { MeResult } from '../lib/api/account';
import { tForLocale } from '../lib/i18n/messages';
import { format } from '../lib/i18n/format';
import { REFERENCE_BRAND_MARK, REFERENCE_BRAND_NAME } from '../lib/theme/reference-brand';
import { NavigationBar } from './Megamenu/NavigationBar';
import { MegamenuMobileDrawer } from './Megamenu/MegamenuMobileDrawer';
import { MobileSearchOverlay } from './mobile/MobileSearchOverlay';
import { CompareCounterLink } from './CompareToggle';
import { CartCounterBadge } from './CartCounterBadge';
import { RfqDraftBadge } from './rfq/RfqDraftBadge';
import { ShoppingListHeartBadge } from './ShoppingListHeartBadge';
import { SearchAutocomplete } from './SearchAutocomplete';
import { CurrencySwitcher, LocaleSwitcher } from './HeaderPreferenceSwitchers';
import { publicApiBaseUrl } from '../lib/env.mjs';
import { LocalizedLink, LocalizedAnchor, LocalizedForm } from '../lib/i18n/localized-link';

/**
 * Industria-themed storefront header. Three rows:
 *   1) top utility strip (phone, shipping cutoff, Faktura VAT chip,
 *      NIP chip, currency/locale, B2B support),
 *   2) main header (brand mark + search + icon buttons + user pill),
 *   3) main nav (categories + Quick Order CTA).
 *
 * The component is server-rendered; only the search autocomplete and
 * compare counter hydrate on the client.
 */
export function Header(props: {
  config: I18nConfigResponse;
  locale: string;
  /** Currently-selected display currency (from the `currency` cookie), if any. */
  currency?: string;
  /**
   * The active sales-channel code, sent by the search box and the comparison
   * counter on their browser-side calls. Required: the layout always has one.
   */
  salesChannelCode: string | undefined;
  /** Feature 027 — buyer's cart line count for the icon-btn badge. */
  cartItemCount?: number;
  /** Feature 015 / 168 — the resolved megamenu: the navigation bar's tabs. */
  megamenu?: ResolvedMegamenu | null;
  /** Logged-in customer + organization, or null when signed out. */
  user?: MeResult | null;
}): ReactNode {
  const t = tForLocale(props.locale);
  // Handed to client components (shopping-list heart badge, search
  // autocomplete) that fetch from the browser, so it must be the
  // public, build-time-baked `NEXT_PUBLIC_API_BASE_URL` — never the
  // server-only `BACKEND_BASE_URL` (internal `http://backend:3001`) that
  // triggers a Mixed Content block over HTTPS.
  const apiBaseUrl = publicApiBaseUrl();
  const cutoff = new Intl.DateTimeFormat(props.locale, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(SHIPPING_CUTOFF);

  // Category/brand shortcut pills for the mobile search overlay: the catalogue
  // tab's departments when the menu has one (feature 168), else the tabs.
  const tabs = props.megamenu?.items ?? [];
  const departments = tabs.find((tab) => tab.presentation === 'catalog')?.children ?? tabs;
  const mobileSearchQuickLinks = departments
    .filter((i): i is typeof i & { url: string } => typeof i.url === 'string' && i.url.length > 0)
    .slice(0, 6)
    .map((i) => ({ label: i.label, href: i.url }));

  // Logged-in buyer summary for the mobile mega-menu footer.
  const drawerAccount = props.user
    ? {
        initials: initials(props.user),
        name:
          `${props.user.customerAccount.firstName} ${props.user.customerAccount.lastName}`.trim() ||
          props.user.customerAccount.email,
        subtitle: props.user.organization?.name ?? props.user.customerAccount.email,
      }
    : null;

  return (
    <>
      <div className="industria-topbar hidden min-[877px]:block">
        <div className="mx-auto max-w-[1360px] px-[24px] industria-topbar__inner">
          <div className="industria-topbar__left">
            <span className="industria-topbar__item">
              <PhoneIcon /> +48 22 397 12 84
            </span>
            <span className="industria-topbar__sep" aria-hidden="true" />
            <span className="industria-topbar__item">
              <TruckIcon /> {format(t('chrome.header.shipsTodayBy'), { time: cutoff })}
            </span>
            <span className="industria-topbar__sep" aria-hidden="true" />
            <span className="industria-topbar__item">
              <DocIcon /> {t('chrome.shared.vatInvoice')}
            </span>
          </div>
          <div className="industria-topbar__right">
            <span className="industria-topbar__chip">
              <strong>{t('chrome.header.taxId')}</strong> {DEMO_TAX_ID}
            </span>
            <CurrencySwitcher currency={props.currency} label={t('chrome.header.currency')} />
            <span className="industria-topbar__sep" aria-hidden="true" />
            <LocalizedAnchor href="/help" className="industria-topbar__item">
              <HelpIcon /> {t('chrome.header.support')}
            </LocalizedAnchor>
            {/* Feature 167 — the channel's languages decide; it hides itself for one. */}
            <LocaleSwitcher label={t('header.language')} />
          </div>
        </div>
      </div>

      <header className="industria-header">
        <div className="mx-auto max-w-[1360px] px-[24px] industria-header__inner hidden min-[877px]:grid">
          <LocalizedLink href="/" className="industria-header__brand">
            <span className="industria-header__mark">{REFERENCE_BRAND_MARK}</span>
            <span className="industria-header__brand__name">
              {REFERENCE_BRAND_NAME}
              <small>{t('chrome.header.tagline')}</small>
            </span>
          </LocalizedLink>
          <LocalizedForm
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
              listPriceLabel={t('product.listPrice')}
              yourPriceLabel={t('product.yourPrice')}
              showKeyboardHint
              salesChannelCode={props.salesChannelCode}
            />
          </LocalizedForm>
          <div className="industria-header__actions">
            <ShoppingListHeartBadge
              apiBase={apiBaseUrl}
              loggedIn={Boolean(props.user)}
              ariaLabel={t('chrome.header.shoppingList')}
            />
            <RfqDraftBadge
              ariaLabel={t('chrome.header.quoteRequest')}
              itemsAriaLabelTemplate={t('chrome.header.quoteRequestItems')}
            />
            <CompareCounterLink
              href="/compare"
              ariaLabel={t('chrome.header.compare')}
              icon={<CompareIcon />}
              salesChannelCode={props.salesChannelCode}
            />
            <CartCounterBadge
              initialCount={props.cartItemCount ?? 0}
              emptyAriaLabel={t('nav.cart')}
              itemsAriaLabelTemplate={t('chrome.header.cartItems')}
            />
            <UserPill user={props.user ?? null} loginLabel={t('nav.login')} />
          </div>
        </div>

        {/* Mobile / compact header (feature 044 / US1) — hamburger drawer,
            compact brand, compare + cart badges, and a tappable search entry on
            a second row. Shown up to 876px; the desktop rows above take over at
            877px. The flip boundary is 876/877 (not the `md` 768px default)
            because the desktop topbar + header only fit from ~877px upward —
            between 768 and 876 the desktop rows overflowed the viewport. */}
        <div className="min-[877px]:hidden">
          <div className="flex h-[56px] items-center gap-[6px] px-[16px]">
            {props.megamenu ? (
              <MegamenuMobileDrawer
                megamenu={props.megamenu}
                account={drawerAccount}
                labels={{
                  open: t('nav.megamenu.open'),
                  close: t('nav.megamenu.close'),
                  title: t('nav.megamenu.title'),
                  seeAll: t('nav.megamenu.seeAll'),
                  allIn: t('nav.megamenu.allIn'),
                  account: t('nav.account'),
                  login: t('nav.login'),
                  go: t('nav.megamenu.go'),
                }}
              />
            ) : (
              <LocalizedLink href="/catalog" className="icon-btn" aria-label={t('nav.catalog')}>
                <MenuIcon />
              </LocalizedLink>
            )}
            <LocalizedLink href="/" className="mr-auto inline-flex items-center gap-[8px]">
              <span className="industria-header__mark">{REFERENCE_BRAND_MARK}</span>
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold text-fg">{REFERENCE_BRAND_NAME}</span>
                <small className="mt-[2px] text-[9px] font-medium uppercase tracking-[0.12em] text-subtle">
                  {t('chrome.header.taglineCompact')}
                </small>
              </span>
            </LocalizedLink>
            <CompareCounterLink
              href="/compare"
              ariaLabel={t('chrome.header.compare')}
              icon={<CompareIcon />}
              salesChannelCode={props.salesChannelCode}
            />
            <CartCounterBadge
              initialCount={props.cartItemCount ?? 0}
              emptyAriaLabel={t('nav.cart')}
              itemsAriaLabelTemplate={t('chrome.header.cartItems')}
            />
          </div>
          <div className="px-[16px] pb-[10px]">
            <MobileSearchOverlay
              apiBaseUrl={apiBaseUrl}
              locale={props.locale}
              placeholder={t('search.placeholder')}
              seeAllResultsLabel={t('search.seeAllResults')}
              quickLinks={mobileSearchQuickLinks}
              salesChannelCode={props.salesChannelCode}
            />
          </div>
        </div>
      </header>

      {/* Feature 168 — the active menu's tabs, and nothing the menu does not
          hold: the former "Wszystkie kategorie" trigger and Quick Order button
          are tabs an operator configures (FR-004, FR-011). */}
      <NavigationBar
        className="industria-nav hidden min-[877px]:block"
        megamenu={props.megamenu ?? null}
        labels={{
          navigation: t('nav.megamenu.label'),
          more: t('nav.megamenu.more'),
          allIn: t('nav.megamenu.allIn'),
          expand: t('nav.megamenu.expand'),
        }}
      />
    </>
  );
}

/** The demo shop's 14:00 shipping cut-off, as a time of day (read in UTC, so the zone never moves it). */
const SHIPPING_CUTOFF = new Date(Date.UTC(2000, 0, 1, 14, 0));

/** The demo shop's tax identification number. */
const DEMO_TAX_ID = '7251234567';

/** Two-letter initials from the customer's name (falls back to the email). */
function initials(user: MeResult): string {
  const { firstName, lastName, email } = user.customerAccount;
  const a = firstName?.trim()?.[0] ?? '';
  const b = lastName?.trim()?.[0] ?? '';
  const fromName = `${a}${b}`.toUpperCase();
  return fromName || (email?.trim()?.[0]?.toUpperCase() ?? '?');
}

/**
 * Header user pill. Signed in → avatar initials, full name, and organization
 * name (or email when the customer has no organization), linking to /account.
 * Signed out → a "sign in" link to /login.
 */
function UserPill({
  user,
  loginLabel,
}: {
  user: MeResult | null;
  loginLabel: string;
}): ReactNode {
  if (!user) {
    return (
      <LocalizedLink href="/login" className="industria-header__user">
        <span className="industria-header__user__avatar" aria-hidden="true">
          <UserIcon />
        </span>
        <span className="industria-header__user__name">
          <strong>{loginLabel}</strong>
        </span>
      </LocalizedLink>
    );
  }

  const { firstName, lastName, email } = user.customerAccount;
  const fullName = `${firstName} ${lastName}`.trim() || email;
  const subtitle = user.organization?.name ?? email;

  return (
    <LocalizedLink href="/account" className="industria-header__user">
      <span className="industria-header__user__avatar">{initials(user)}</span>
      <span className="industria-header__user__name">
        <strong>{fullName}</strong>
        <em>{subtitle}</em>
      </span>
      <ChevDownIcon />
    </LocalizedLink>
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
function ChevDownIcon(): ReactNode {
  return svg(<polyline points="6 9 12 15 18 9" />, 14);
}
function UserIcon(): ReactNode {
  return svg(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
    17,
  );
}
function MenuIcon(): ReactNode {
  return svg(
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>,
    22,
  );
}
