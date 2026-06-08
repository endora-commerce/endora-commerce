import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Hook } from '../components/Hook';
import { PwaRegister } from '../components/PwaRegister';
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
import { getAnonCartCookie, getSessionCookie } from '../lib/session';
import './globals.css';

export const metadata = {
  title: 'B2B Platform',
  description:
    'A B2B commerce platform supporting Quote Requests and direct purchase for business customers.',
  manifest: '/manifest.webmanifest',
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
  const { config, locale, ctx } = await getServerContext();
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
  const [megamenu, dictionary, cartItemCount, me] = await Promise.all([
    getActiveMegamenu(ctx),
    fetchDictionary({ ctx }),
    // Header cart-icon badge. Never blocks the render — getCartItemCount
    // swallows all errors and returns 0 on the worst case.
    session || anon ? getCartItemCount(cartJar) : Promise.resolve(0),
    // Header user pill. Best-effort — a missing/expired session must render the
    // signed-out state, never crash the layout, so swallow all errors → null.
    session ? getMe(session).catch(() => null) : Promise.resolve(null),
  ]);
  return (
    <html lang={locale}>
      <body>
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
          </div>
        </DictionaryProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
