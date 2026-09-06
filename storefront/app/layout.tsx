import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { MobileTabBar } from '../components/mobile/MobileTabBar';
import { tForLocale } from '../lib/i18n/messages';
import { Hook } from '../components/Hook';
import { PwaRegister } from '../components/PwaRegister';
import { InstallPrompt } from '../components/pwa/InstallPrompt';
import { PushOptIn } from '../components/pwa/PushOptIn';
import { SpeculationRules } from '../components/SpeculationRules';
import { RouteTransition } from '../components/RouteTransition';
import { NavigationFeedback } from '../components/NavigationFeedback';
import { CartMergeToast } from '../components/CartMergeToast';
import { CheckoutHeader } from '../components/checkout/CheckoutHeader';
import { HeaderSwitch } from '../components/HeaderSwitch';
import { getActiveMegamenu } from '../lib/api/megamenu';
import { getServerContext } from '../lib/server-context';
import { siteUrl } from '../lib/seo/site-url';
import { StorefrontDocument } from '../lib/theme/StorefrontDocument';
import { fetchDictionary } from '../lib/dictionary/client';
import { DictionaryProvider } from '../lib/dictionary/DictionaryProvider';
import { getCartItemCount } from '../lib/api/cart';
import { getMe } from '../lib/api/account';
import { getSpeculationRulesConfig } from '../lib/api/speculation-rules';
import { getGoogleAnalyticsConfig } from '../lib/api/analytics-config';
import { GoogleAnalytics } from '../components/analytics/GoogleAnalytics';
import { getLinkedInAdsConfig } from '../lib/api/linkedin-config';
import { LinkedInInsightTag } from '../components/analytics/LinkedInInsightTag';
import { getMetaAdsConfig } from '../lib/api/meta-config';
import { MetaPixel } from '../components/analytics/MetaPixel';
import { getGoogleTagManagerConfig } from '../lib/api/gtm-config';
import { GoogleTagManager } from '../components/analytics/GoogleTagManager';
import { GtmProvider } from '../components/analytics/GtmProvider';
import { AnalyticsProvider } from '../components/analytics/AnalyticsProvider';
import { ConsentBanner } from '../components/analytics/ConsentBanner';
import { CookieConsentMessage } from '../components/analytics/CookieConsentMessage';
import { getAnonCartCookie, getSessionCookie } from '../lib/session';
import { headers } from 'next/headers';
import { DEFAULT_STOREFRONT_THEME_CODE } from '../lib/theme/instance-themes';
import { UNAVAILABLE_HEADER } from '../lib/service-unavailable';
import { outageLocale } from './service-unavailable/page';
import './globals.css';

/**
 * Did the reachability gate rewrite this request to the unavailable notice?
 *
 * A request header rather than the pathname: the rewrite deliberately leaves
 * the buyer's own URL in place, so `x-pathname` still names the page they asked
 * for and there is nothing in the path to branch on.
 */
async function isUnreachableBackendRender(): Promise<boolean> {
  return (await headers()).get(UNAVAILABLE_HEADER) === '1';
}

/**
 * `metadataBase` is what makes every route's `alternates.canonical` a **path**
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-012). The deployment's origin
 * is declared once, here; a route that spelled its own absolute URL would go on
 * naming the old origin after a move, with nothing to notice.
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: 'B2B Platform',
  description:
    'A B2B commerce platform supporting Quote Requests and direct purchase for business customers.',
  manifest: '/manifest.webmanifest',
};

/**
 * Feature 044 — the mobile experience uses fixed top/bottom chrome (bottom
 * tab bar, sticky action bars). `viewportFit: 'cover'` lets `env(safe-area-inset-*)`
 * resolve to real notch / home-indicator insets so that chrome is neither
 * clipped nor floating over content on notched devices.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Force dynamic rendering tree-wide. The reference theme is SSR-first
 * (Principle VII) and every page reads request headers (locale, sales
 * channel) before fetching the backend. Themes that want a static
 * landing or marketing page override `dynamic` per-route.
 */
export const dynamic = 'force-dynamic';

/**
 * Root layout — fetches the i18n config server-side, resolves the active
 * locale from the request, and stamps `<html lang>` accordingly so search
 * engines and LLM crawlers see the correct language without JavaScript
 * (Principle VII / FR-103).
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  // The reachability gate in `middleware.ts` rewrote this request to the
  // service-unavailable notice because the backend cannot be reached. Every
  // read below would fail — `getServerContext()` first, on `getI18nConfig()`,
  // which is the throw this whole feature exists to replace — so the layout
  // returns the document shell and nothing else.
  //
  // It is not only a necessity. The header's megamenu, cart badge and user pill
  // have no data during an outage, and the footer's links point at pages that
  // are equally unreachable; chrome rendered from defaults would be chrome that
  // lies. See `app/service-unavailable/page.tsx`.
  if (await isUnreachableBackendRender()) {
    return (
      <StorefrontDocument
        lang={await outageLocale()}
        theme={{ code: DEFAULT_STOREFRONT_THEME_CODE, unknownRequest: null }}
      >
        <div className="flex min-h-screen flex-col bg-bg">
          <main id="main-content" tabIndex={-1} className="flex-1">
            {children}
          </main>
        </div>
      </StorefrontDocument>
    );
  }

  const { config, locale, currency, ctx, theme } = await getServerContext();
  const t = tForLocale(locale);
  // Handed to the <MobileTabBar> client component, which fetches the mini-cart
  // from the browser, so it must be the public, build-time-baked
  // `NEXT_PUBLIC_API_BASE_URL` — never the server-only `BACKEND_BASE_URL`
  // (internal `http://backend:3001`) that triggers a Mixed Content block over
  // HTTPS.
  const apiBaseUrl =
    process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
  // Feature 036 US5 — checkout uses a minimal, logo-only header. The full vs
  // minimal switch is decided per-route by the <HeaderSwitch> client component
  // (`usePathname`), because this Server-Component layout is NOT re-run on
  // client-side navigations and so cannot decide the header itself without it
  // "sticking" across routes. We therefore always fetch the chrome data.
  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  const cartJar = {
    ...(session ? { session } : {}),
    ...(anon ? { anon } : {}),
  };
  const [
    megamenu,
    dictionary,
    cartItemCount,
    me,
    speculation,
    gaConfig,
    linkedInConfig,
    metaConfig,
    gtmConfig,
  ] = await Promise.all([
    getActiveMegamenu(ctx),
    fetchDictionary({ ctx }),
    // Header cart-icon badge. Never blocks the render — getCartItemCount
    // swallows all errors and returns 0 on the worst case.
    session || anon ? getCartItemCount(cartJar) : Promise.resolve(0),
    // Header user pill. Best-effort — a missing/expired session must render the
    // signed-out state, never crash the layout, so swallow all errors → null.
    session ? getMe(session).catch(() => null) : Promise.resolve(null),
    // Speculation Rules toggle (Settings module). Best-effort — defaults to
    // enabled + 'moderate' on any read error.
    getSpeculationRulesConfig(),
    // Feature 049 — per-channel Google Analytics config. Best-effort; returns a
    // disabled config on any read error so analytics never breaks the render.
    getGoogleAnalyticsConfig(ctx),
    // Features 063 / 064 — per-channel ad-platform configs, same best-effort
    // contract as GA above.
    getLinkedInAdsConfig(ctx),
    getMetaAdsConfig(ctx),
    // Feature 066 — per-channel Google Tag Manager config, same best-effort
    // contract again.
    getGoogleTagManagerConfig(ctx),
  ]);
  return (
    // <html lang> + <html data-theme>. Both are server-stamped: the locale for
    // crawlers, the theme because the channel's token set has to be in the
    // first byte of HTML or the buyer sees the reference brand and then the
    // channel's (feature 005-sales-channels).
    //
    // `theme` is the whole decision, not the code alone: the document also
    // carries `data-theme-requested` when the channel named a theme this
    // storefront does not have, and deriving that inside the component is what
    // stops a caller from forgetting it (feature 102).
    <StorefrontDocument lang={locale} theme={theme}>
      <DictionaryProvider
        initialDictionary={dictionary}
        locale={locale}
        channel={ctx.salesChannelCode}
      >
        <div className="flex min-h-screen flex-col bg-bg">
          {/* Bypass Blocks (WCAG 2.4.1). The first tab stop on every page,
              visible only while focused, so a keyboard reader is not made to
              traverse the header and the megamenu on every navigation. It is
              the first child of the layout deliberately: the tab order is the
              document order, and a skip link that is not first skips nothing.
              `conformance:storefront` asserts both halves — that it is there,
              and that one Tab reaches it. */}
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:absolute focus:left-[16px] focus:top-[16px] focus:z-50 focus:rounded-[4px] focus:bg-bg focus:px-[16px] focus:py-[10px] focus:text-fg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t('a11y.skipToContent')}
          </a>
          {/* Client-side navigation feedback. It replaces the route-level
              `loading.tsx` skeleton and adds no Suspense boundary, so every
              page keeps setting its own response status. Silent below 200 ms;
              see the component for the timings and their reasons. */}
          <NavigationFeedback
            label={t('a11y.navigating')}
            slowLabel={t('a11y.navigatingSlow')}
          />
          <HeaderSwitch
            minimal={<CheckoutHeader />}
            full={
              <>
                <Hook code="header.top" />
                <Header
                  config={config}
                  locale={locale}
                  {...(currency !== undefined ? { currency } : {})}
                  cartItemCount={cartItemCount}
                  megamenu={megamenu}
                  user={me}
                  {...(ctx.salesChannelCode !== undefined
                    ? { salesChannelCode: ctx.salesChannelCode }
                    : {})}
                />
                <Hook code="header.bottom" />
              </>
            }
          />
          <main id="main-content" tabIndex={-1} className="flex-1">
            {/* Feature 037 — post-login cart-merge confirmation. The
                component reads-and-clears its own flash cookie, so it
                renders to `null` on every page except the one that
                immediately follows a successful merge. */}
            <CartMergeToast />
            {/* Feature 046 — PWA install prompt + push opt-in. Both render to
                null unless supported and enabled (graceful degradation). */}
            <InstallPrompt />
            <PushOptIn />
            <Hook code="page.top" />
            <RouteTransition>{children}</RouteTransition>
            <Hook code="page.bottom" />
          </main>
          {/* Footer is shown on every route, including checkout (the buyer
              still needs the legal/support links). */}
          <Hook code="footer.before" />
          <Footer
            top={<Hook code="footer.top" />}
            bottom={<Hook code="footer.bottom" />}
            copyright={<Hook code="footer.copyright" />}
          />
          <Hook code="footer.after" />
          {/* Feature 044 / US1 — fixed bottom tab bar (md:hidden). Renders on
              every route; the body reserves its height on the mobile band so
              it never covers content (globals.css). */}
          <MobileTabBar
            cartItemCount={cartItemCount}
            apiBase={apiBaseUrl}
            labels={{
              home: t('nav.home'),
              quoteRequest: t('nav.quoteRequest'),
              quickOrder: t('nav.quickOrder'),
              cart: t('nav.cart'),
              account: t('nav.account'),
            }}
          />
        </div>
      </DictionaryProvider>
      <PwaRegister />
      <SpeculationRules enabled={speculation.enabled} eagerness={speculation.eagerness} />
      {/* Feature 049 — Google Analytics 4. Renders nothing for untracked
          channels; page views are emitted per navigation by the provider. */}
      <GoogleAnalytics config={gaConfig} />
      <AnalyticsProvider config={gaConfig} />
      <LinkedInInsightTag config={linkedInConfig} />
      <MetaPixel config={metaConfig} />
      {/* Feature 066 — the operator's GTM container plus the client-side
          bootstrap for the platform's own dataLayer vocabulary. */}
      <GoogleTagManager config={gtmConfig} />
      <GtmProvider config={gtmConfig} />
      {/* The prompt is owed whenever any enabled integration on the channel
          requires consent — not only Google Analytics (FR-015). */}
      <ConsentBanner
        platforms={[gaConfig, linkedInConfig, metaConfig, gtmConfig]}
        message={<CookieConsentMessage ctx={ctx} />}
      />
    </StorefrontDocument>
  );
}
