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
 * shell mirrors `/compare` (container + Industria catalog title block);
 * the table is a client component that fetches via the share-token
 * endpoint. Per spec FR-013 / FR-014, this page is read-only — no
 * add/remove/delete, no add-to-cart, no PDF export. Per Constitution
 * VII the page is `noindex,nofollow`.
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
    <div className="mx-auto max-w-[1360px] px-[24px]" style={{ paddingTop: 24, paddingBottom: 56 }}>
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/compare', label: 'Porównywarka' },
          { href: `/compare/share/${token}`, label: 'Udostępniona' },
        ]}
      />
      <div className="industria-catalog__title">
        <div>
          <h1>Udostępniona porównywarka</h1>
          <p>
            Tylko do odczytu — autor porównywarki udostępnił ci ten zestaw produktów. Zmiany trybu
            wyświetlania są lokalne i nie wpływają na widok autora.
          </p>
        </div>
      </div>
      <SharedComparisonTable token={token} />
    </div>
  );
}
