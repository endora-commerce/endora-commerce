import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Hook } from '../components/Hook';
import { Megamenu } from '../components/Megamenu/Megamenu';
import { PwaRegister } from '../components/PwaRegister';
import { RouteTransition } from '../components/RouteTransition';
import { getActiveMegamenu } from '../lib/api/megamenu';
import { getServerContext } from '../lib/server-context';
import { fetchDictionary } from '../lib/dictionary/client';
import { DictionaryProvider } from '../lib/dictionary/DictionaryProvider';
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
  const [megamenu, dictionary] = await Promise.all([
    getActiveMegamenu(ctx),
    fetchDictionary({ ctx }),
  ]);
  return (
    <html lang={locale}>
      <body>
        <DictionaryProvider
          initialDictionary={dictionary}
          locale={locale}
          channel={ctx.salesChannelCode}
        >
          <div className="b2b-shell">
            <Hook code="header.top" />
            <Header config={config} locale={locale} />
            <Megamenu megamenu={megamenu} />
            <Hook code="header.bottom" />
            <main className="b2b-shell__main">
              <Hook code="page.top" />
              <RouteTransition>{children}</RouteTransition>
              <Hook code="page.bottom" />
            </main>
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
