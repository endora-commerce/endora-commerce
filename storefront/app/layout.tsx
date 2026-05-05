import type { ReactNode } from 'react';
import { Header } from '../components/Header';
import { Footer } from '../components/Footer';
import { Hook } from '../components/Hook';
import { PwaRegister } from '../components/PwaRegister';
import { getServerContext } from '../lib/server-context';
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
  const { config, locale } = await getServerContext();
  return (
    <html lang={locale}>
      <body>
        <div className="b2b-shell">
          <Hook code="header.top" />
          <Header config={config} locale={locale} />
          <Hook code="header.bottom" />
          <main className="b2b-shell__main">
            <Hook code="page.top" />
            {children}
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
        <PwaRegister />
      </body>
    </html>
  );
}
