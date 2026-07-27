import type { ReactNode } from 'react';
import type { Viewport } from 'next';
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
import { CartMergeToast } from '../components/CartMergeToast';
import { CheckoutHeader } from '../components/checkout/CheckoutHeader';
import { HeaderSwitch } from '../components/HeaderSwitch';
import { getActiveMegamenu } from '../lib/api/megamenu';
import { getServerContext } from '../lib/server-context';
import { fetchDictionary } from '../lib/dictionary/client';
import { DictionaryProvider } from '../lib/dictionary/DictionaryProvider';
import { getCartItemCount } from '../lib/api/cart';
import { getMe } from '../lib/api/account';
import { getSpeculationRulesConfig } from '../lib/api/speculation-rules';
import { getGoogleAnalyticsConfig } from '../lib/api/analytics-config';
import { GoogleAnalytics } from '../components/analytics/GoogleAnalytics';
import { getLinkedInAdsConfig } from '../lib/api/linkedin-config';
import { LinkedInInsightTag } from '../components/analytics/LinkedInInsightTag';
import { AnalyticsProvider } from '../components/analytics/AnalyticsProvider';
import { ConsentBanner } from '../components/analytics/ConsentBanner';
import { CookieConsentMessage } from '../components/analytics/CookieConsentMessage';
import { getAnonCartCookie, getSessionCookie } from '../lib/session';
import './globals.css';

export const metadata = {
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
  const { config, locale, currency, ctx } = await getServerContext();
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
  const [megamenu, dictionary, cartItemCount, me, speculation, gaConfig, linkedInConfig] =
    await Promise.all([
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
    // Feature 063 — per-channel LinkedIn Ads config, same best-effort contract.
    getLinkedInAdsConfig(ctx),
  ]);
  return (
    <html lang={locale}>
      {/* suppressHydrationWarning: browser extensions (Grammarly, password
          managers, etc.) inject attributes onto <body> before React hydrates
          — e.g. data-gr-ext-installed. This suppresses the warning for the
          <body> element's own attributes only (not its descendants), so real
          mismatches inside the tree are still reported. */}
      <body suppressHydrationWarning>
        <DictionaryProvider
          initialDictionary={dictionary}
          locale={locale}
          channel={ctx.salesChannelCode}
        >
          <div className="flex min-h-screen flex-col bg-bg">
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
            <main className="flex-1">
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
        <ConsentBanner config={gaConfig} message={<CookieConsentMessage ctx={ctx} />} />
      </body>
    </html>
  );
}
