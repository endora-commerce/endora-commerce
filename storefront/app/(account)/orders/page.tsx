import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyOrders, resolveOrderStatusLabel } from '../../../lib/api/orders';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { formatMoney } from '../../../lib/i18n/money';

/**
 * Orders list (T159 / FR-053). Backend's `GET /orders` already enforces
 * the access scope — Regular Users see only their own orders, Org Admins
 * see every order on their org. Lives at `/orders` alongside the single
 * order view (`/orders/[id]`); `/account/orders` redirects here.
 */

export default async function OrdersListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/orders');
  const orders = await listMyOrders(session);
  const { locale } = await getServerContext();

  if (orders.length === 0) {
    return (
      <div className="b2b-auth max-w-[720px]">
        <h1>Orders</h1>
        <p>You don&apos;t have any orders yet.</p>
        <p>
          <Link href="/catalog">Browse the catalog</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>Orders</h1>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Placed</th>
            <th>Order</th>
            <th>Status</th>
            <th>Payment</th>
            <th className="text-right">Total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>{new Date(o.placedAt).toLocaleDateString()}</td>
              <td>{o.businessId}</td>
              <td>{resolveOrderStatusLabel(o, locale)}</td>
              <td>{o.paymentStatus}</td>
              <td className="text-right">
                {formatMoney(o.total, o.currency, locale)}
              </td>
              <td>
                <Link href={`/orders/${o.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
