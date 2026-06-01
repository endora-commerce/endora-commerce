import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listMyOrders, resolveOrderStatusLabel } from '../../../lib/api/orders';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';

/**
 * Orders list (T159 / FR-053). Backend's `GET /orders` already enforces
 * the access scope — Regular Users see only their own orders, Org Admins
 * see every order on their org. The list intentionally lives under the
 * `(account)` route group so the same sidebar gates it.
 */

export default async function OrdersListPage(): Promise<ReactNode> {
  const session = await getSessionCookie();
  if (!session) redirect('/login?next=/account/orders');
  const orders = await listMyOrders(session);
  const { locale } = await getServerContext();

  if (orders.length === 0) {
    return (
      <>
        <h2>Orders</h2>
        <p>You don&apos;t have any orders yet.</p>
        <p>
          <Link href="/catalog">Browse the catalog</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h2>Orders</h2>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Placed</th>
            <th>Order</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
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
              <td>
                {o.total.toFixed(2)} {o.currency}
              </td>
              <td>
                <Link href={`/orders/${o.id}`}>Open</Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
