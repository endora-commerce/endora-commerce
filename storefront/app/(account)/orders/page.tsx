import type { ReactNode } from 'react';
import { listMyOrders, resolveOrderStatusLabel } from '../../../lib/api/orders';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { formatMoney } from '../../../lib/i18n/money';
import type { Metadata } from 'next';
import { localeRedirect } from '../../../lib/i18n/navigation';
import { LocalizedLink } from '../../../lib/i18n/localized-link';
import { tForLocale } from '../../../lib/i18n/messages';
import { codeLabel } from '../../../lib/account/labels';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Orders list (T159 / FR-053). Backend's `GET /orders` already enforces
 * the access scope — Regular Users see only their own orders, Org Admins
 * see every order on their org. Lives at `/orders` alongside the single
 * order view (`/orders/[id]`); `/account/orders` redirects here.
 */

export default async function OrdersListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) return await localeRedirect('/login?next=/orders');
  const orders = await listMyOrders(session);
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  if (orders.length === 0) {
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>{t('account.orders.heading')}</h1>
        <p>{t('returns.new.noOrders')}</p>
        <p>
          <LocalizedLink href="/catalog">{t('account.common.browseCatalog')}</LocalizedLink>
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>{t('account.orders.heading')}</h1>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>{t('account.orders.col.placed')}</th>
            <th>{t('account.orders.col.order')}</th>
            <th>{t('account.common.status')}</th>
            <th>{t('account.orders.col.payment')}</th>
            <th className="text-right">{t('account.common.total')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.placedAt).toLocaleDateString(locale)}</td>
              <td>{o.businessId}</td>
              <td>{resolveOrderStatusLabel(o, locale)}</td>
              <td>{codeLabel(t, 'account.paymentStatus', o.paymentStatus)}</td>
              <td className="text-right">
                {formatMoney(o.total, o.currency, locale)}
              </td>
              <td>
                <LocalizedLink href={`/orders/${o.id}`}>{t('account.common.open')}</LocalizedLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
