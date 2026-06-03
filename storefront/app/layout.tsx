import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Hook } from '../components/Hook';
import { PwaRegister } from '../components/PwaRegister';
import { RouteTransition } from '../components/RouteTransition';
import { CartMergeToast } from '../components/CartMergeToast';
import { CheckoutHeader } from '../components/checkout/CheckoutHeader';
import { getActiveMegamenu } from '../lib/api/megamenu';
import { getServerContext } from '../lib/server-context';
import { fetchDictionary } from '../lib/dictionary/client';
import { DictionaryProvider } from '../lib/dictionary/DictionaryProvider';
import { getCartItemCount } from '../lib/api/cart';
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
  // Feature 036 US5 — pathname comes from middleware (`x-pathname`); on a
  // /checkout* route the layout switches to a minimal logo-only header and
  // drops the megamenu/footer/cart-count fetches to remove distraction from
  // the buyer's path to "Place order".
  const pathname = (await headers()).get('x-pathname') ?? '';
  const isCheckoutRoute = pathname.startsWith('/checkout');

  const session = await getSessionCookie();
  const anon = await getAnonCartCookie();
  const cartJar = {
    ...(session ? { session } : {}),
    ...(anon ? { anon } : {}),
  };
  const [megamenu, dictionary, cartItemCount] = await Promise.all([
    isCheckoutRoute ? Promise.resolve(null) : getActiveMegamenu(ctx),
    fetchDictionary({ ctx }),
    // Header cart-icon badge. Never blocks the render — getCartItemCount
    // swallows all errors and returns 0 on the worst case. Skipped on
    // checkout (no cart icon in the minimal header).
    !isCheckoutRoute && (session || anon)
      ? getCartItemCount(cartJar)
      : Promise.resolve(0),
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
            {isCheckoutRoute ? (
              <CheckoutHeader />
            ) : (
              <>
                <Hook code="header.top" />
                <Header
                  config={config}
                  locale={locale}
                  cartItemCount={cartItemCount}
                  megamenu={megamenu}
                  {...(ctx.salesChannelCode !== undefined
                    ? { salesChannelCode: ctx.salesChannelCode }
                    : {})}
                />
                <Hook code="header.bottom" />
              </>
            )}
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
            {isCheckoutRoute ? null : (
              <>
                <Hook code="footer.before" />
                <Footer
                  top={<Hook code="footer.top" />}
                  bottom={<Hook code="footer.bottom" />}
                  copyright={<Hook code="footer.copyright" />}
                />
                <Hook code="footer.after" />
              </>
            )}
          </div>
        </DictionaryProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
