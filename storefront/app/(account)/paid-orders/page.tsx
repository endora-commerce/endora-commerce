import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';
import { listPaidOrders } from '../../../lib/api/related-payers';
import { PaidOrdersTable } from '../../../components/account/PaidOrders';

/** Not indexed: an authenticated surface (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `specs/182-related-payers/` FR-070 — *Orders we pay for*: the orders other Organizations
 * placed and billed to this one. Not found unless the member holds *View orders we pay for*,
 * the capability is on for the channel and the module is present — the API decides all three.
 */
export default async function PaidOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/paid-orders');
  const { cursor } = await searchParams;
  const { locale, ctx, modules } = await getServerContext();
  if (!modules.isPresent('related_payers')) notFound();
  const page = await listPaidOrders(session, ctx, cursor);
  if (!page) notFound();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth max-w-[820px]">
      <h1>{t('account.paidOrders.heading')}</h1>
      <PaidOrdersTable orders={page.orders} locale={locale} />
      {page.hasMore && page.cursor ? (
        <p className="mt-4">
          <LocalizedLink href={`/paid-orders?cursor=${encodeURIComponent(page.cursor)}`} className="b2b-account__link b2b-account__link--standalone">
            {t('account.paidOrders.next')}
          </LocalizedLink>
        </p>
      ) : null}
    </div>
  );
}
