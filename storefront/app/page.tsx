import Link from 'next/link';
import type { ReactNode } from 'react';
import { tForLocale } from '../lib/i18n/messages';
import { getServerContext } from '../lib/server-context';

/**
 * Landing page. Reference-theme content; themes typically replace it
 * with a hero + featured-product grid. Server-rendered so it shows up in
 * the initial HTML for crawlers.
 */
export default async function HomePage(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return (
    <section>
      <h1>B2B Platform</h1>
      <p className="muted">
        Reference storefront. Browse the <Link href="/catalog">{t('nav.catalog')}</Link> or use{' '}
        <Link href="/search">{t('nav.search')}</Link> to find products.
      </p>
    </section>
  );
}
