import type { ReactNode } from 'react';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ComparisonTable } from '../../components/ComparisonTable';
import { tForLocale } from '../../lib/i18n/messages';
import { getServerContext } from '../../lib/server-context';

const apiBaseUrl =
  process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';

/**
 * /compare — server-rendered shell with a client-only table that reads
 * from localStorage. The page itself works offline (the SW caches the
 * shell); client-side reload of comparison data needs the network.
 */
export default async function ComparePage(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  const t = tForLocale(locale);
  return (
    <>
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/compare', label: 'Compare' },
        ]}
      />
      <h1>Compare products</h1>
      <ComparisonTable apiBaseUrl={apiBaseUrl} />
    </>
  );
}
