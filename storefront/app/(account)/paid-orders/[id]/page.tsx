import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { localeRedirect } from '../../../../lib/i18n/navigation';
import { tForLocale } from '../../../../lib/i18n/messages';
import { format } from '../../../../lib/i18n/format';
import { getPaidOrder } from '../../../../lib/api/related-payers';
import { PaidOrderDetailView } from '../../../../components/account/PaidOrders';

/** Not indexed: an authenticated surface (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010). */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * `specs/182-related-payers/` FR-071 — one order billed to this Organization, read-only, with
 * its invoices (RP-13). Any order that does not name the caller's Organization as payer is not
 * found, exactly as one that does not exist (FR-072).
 */
export default async function PaidOrderPage({ params }: { params: Promise<{ id: string }> }): Promise<ReactNode> {
  const { id } = await params;
  const session = await getSessionCookie();
  if (!session) return await localeRedirect(`/login?next=/paid-orders/${id}`);
  const { locale, ctx, modules } = await getServerContext();
  if (!modules.isPresent('related_payers')) notFound();
  const order = await getPaidOrder(session, ctx, id);
  if (!order) notFound();
  const t = tForLocale(locale);

  return (
    <div className="b2b-auth max-w-[820px]">
      <h1>{format(t('account.paidOrders.heading.detail'), { number: order.businessId })}</h1>
      <PaidOrderDetailView order={order} locale={locale} />
    </div>
  );
}
