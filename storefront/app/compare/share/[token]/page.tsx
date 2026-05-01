import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { SharedComparisonTable } from '../../../../components/SharedComparisonTable';
import { tForLocale } from '../../../../lib/i18n/messages';
import { getServerContext } from '../../../../lib/server-context';

/**
 * `/compare/share/[token]` — feature 007 / US2 / T043.
 *
 * Recipient view of a comparison shared by another customer. Server
 * shell renders the breadcrumbs and locale-aware heading; the table is
 * a client component that fetches via the share-token endpoint. Per
 * spec FR-013 / FR-014, this page is read-only — no add/remove/delete,
 * no add-to-cart. Per Constitution VII the page is `noindex,nofollow`.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharedComparePage(props: {
  params: Promise<{ token: string }>;
}): Promise<ReactNode> {
  const { token } = await props.params;
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
      <h1>Shared product comparison</h1>
      <SharedComparisonTable token={token} />
    </>
  );
}
