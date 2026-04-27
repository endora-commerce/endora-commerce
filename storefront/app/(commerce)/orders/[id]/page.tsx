import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { StorefrontApiError } from '../../../../lib/api/client';

/**
 * Order confirmation page (T158). Renders the order the buyer just placed
 * (or any prior order they own). The page also surfaces the `nextAction`
 * the backend returned — for the bank-transfer driver this is
 * `awaiting_transfer` and the page tells the buyer what to do next.
 */

export default async function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  if (!session) redirect(`/login?next=/orders/${id}`);

  let order;
  try {
    order = await getMyOrder(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      return (
        <div className="b2b-auth">
          <h1>Order not found</h1>
          <p className="b2b-auth__error">We couldn&apos;t find that order.</p>
        </div>
      );
    }
    throw err;
  }

  return (
    <div className="b2b-auth" style={{ maxWidth: 720 }}>
      <h1>Thank you — order placed</h1>
      <p className="b2b-auth__success">
        Order <strong>#{order.id.slice(0, 8)}</strong> has been received.
      </p>

      {order.nextAction?.kind === 'awaiting_transfer' ? (
        <p>
          Pay by bank transfer using the reference printed on the proforma invoice we&apos;ll
          email shortly. We&apos;ll update the order once the payment clears.
        </p>
      ) : null}

      <h2>Status</h2>
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">Order status</th>
            <td>{order.status}</td>
          </tr>
          <tr>
            <th scope="row">Payment status</th>
            <td>{order.paymentStatus}</td>
          </tr>
          <tr>
            <th scope="row">Placed</th>
            <td>{new Date(order.placedAt).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <h2>Items</h2>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Unit</th>
            <th>Line</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => (
            <tr key={it.id}>
              <td>{it.productId}</td>
              <td>{it.quantity}</td>
              <td>
                {it.unitPrice.toFixed(2)} {order.currency}
              </td>
              <td>
                {it.lineTotal.toFixed(2)} {order.currency}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3} style={{ textAlign: 'right' }}>
              Subtotal
            </th>
            <td>
              {order.subtotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          <tr>
            <th colSpan={3} style={{ textAlign: 'right' }}>
              Tax
            </th>
            <td>
              {order.taxTotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          {order.discountTotal > 0 ? (
            <tr>
              <th colSpan={3} style={{ textAlign: 'right' }}>
                Discount
              </th>
              <td>
                −{order.discountTotal.toFixed(2)} {order.currency}
              </td>
            </tr>
          ) : null}
          <tr>
            <th colSpan={3} style={{ textAlign: 'right' }}>
              Delivery
            </th>
            <td>
              {order.deliveryTotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          <tr>
            <th colSpan={3} style={{ textAlign: 'right' }}>
              <strong>Total</strong>
            </th>
            <td>
              <strong>
                {order.total.toFixed(2)} {order.currency}
              </strong>
            </td>
          </tr>
        </tfoot>
      </table>

      <p className="b2b-auth__hint">
        <Link href="/account/orders">See all orders</Link>
      </p>
    </div>
  );
}
