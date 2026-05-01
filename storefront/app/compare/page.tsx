import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { ComparisonTable } from '../../components/ComparisonTable';
import { tForLocale } from '../../lib/i18n/messages';
import { getServerContext } from '../../lib/server-context';

/**
 * `/compare` — server-rendered shell with a client-side table that
 * fetches the live ComparisonOwnerView from the backend (feature 007 /
 * T033). The page itself is per-customer state, so it emits
 * `noindex, nofollow` (per plan.md Constitution Check VII).
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

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
      <ComparisonTable />
    </>
  );
}
