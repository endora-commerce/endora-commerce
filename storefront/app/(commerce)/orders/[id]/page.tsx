import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  addOrderComment,
  cloneOrderToQuote,
  getMyOrder,
  listOrderComments,
  reorderOrder,
  resolveOrderStatusLabel,
  type OrderComment,
} from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
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

  let comments: OrderComment[] = [];
  try {
    comments = await listOrderComments(session, id);
  } catch {
    comments = [];
  }

  const { locale } = await getServerContext();
  // Terminal orders close commenting; a pending payment surfaces a Pay CTA.
  const isTerminal = order.status === 'completed' || order.status === 'cancelled';
  const awaitingPayment = !isTerminal && order.paymentStatus === 'awaiting_payment';

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>Thank you — order placed</h1>
      <p className="b2b-auth__success">
        Order <strong>{order.businessId}</strong> has been received.
      </p>

      {order.nextAction?.kind === 'awaiting_transfer' ? (
        <p>
          Pay by bank transfer using the reference printed on the proforma invoice we&apos;ll
          email shortly. We&apos;ll update the order once the payment clears.
        </p>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-2">
        <form action={reorderAction} className="inline">
          <input type="hidden" name="id" value={order.id} />
          <button type="submit" className="btn btn--outline btn--sm">
            Order again → cart
          </button>
        </form>
        <form action={reorderToQuoteAction} className="inline">
          <input type="hidden" name="id" value={order.id} />
          <button type="submit" className="btn btn--outline btn--sm">
            Order again → quote request
          </button>
        </form>
        <Link href="/orders" className="btn btn--ghost btn--sm">
          See all orders
        </Link>
      </div>

      <h2>Status</h2>
      <table className="b2b-account__table">
        <tbody>
          <tr>
            <th scope="row">Order status</th>
            <td>{resolveOrderStatusLabel(order, locale)}</td>
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
            <th colSpan={3} className="text-right">
              Subtotal
            </th>
            <td>
              {order.subtotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">
              Tax
            </th>
            <td>
              {order.taxTotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          {order.discountTotal > 0 ? (
            <tr>
              <th colSpan={3} className="text-right">
                Discount
              </th>
              <td>
                −{order.discountTotal.toFixed(2)} {order.currency}
              </td>
            </tr>
          ) : null}
          <tr>
            <th colSpan={3} className="text-right">
              Delivery
            </th>
            <td>
              {order.deliveryTotal.toFixed(2)} {order.currency}
            </td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">
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

      {awaitingPayment ? (
        <p className="b2b-auth__hint">
          This order is awaiting payment.{' '}
          {order.nextAction?.kind === 'awaiting_transfer'
            ? 'Use the bank-transfer details above to pay.'
            : 'Complete payment to proceed.'}
        </p>
      ) : null}

      <h2>Comments</h2>
      {comments.length === 0 ? (
        <p className="b2b-auth__hint">No comments yet.</p>
      ) : (
        <ul className="b2b-account__comments">
          {comments.map((c) => (
            <li key={c.id}>
              <small>{new Date(c.createdAt).toLocaleString()}</small>
              <p>{c.body}</p>
            </li>
          ))}
        </ul>
      )}
      {isTerminal ? (
        <p className="b2b-auth__hint">Commenting is closed for this order.</p>
      ) : (
        <form action={addCommentAction} className="mt-3">
          <input type="hidden" name="id" value={order.id} />
          <textarea name="body" required aria-label="Add a comment" rows={3} />
          <button type="submit" className="btn btn--outline btn--sm mt-2">
            Add comment
          </button>
        </form>
      )}
    </div>
  );
}

async function addCommentAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  const body = ((formData.get('body') as string) ?? '').trim();
  if (body) {
    try {
      await addOrderComment(session, id, body);
    } catch (err) {
      const message = err instanceof StorefrontApiError ? err.message : 'Could not add comment.';
      redirect(`/orders/${id}?error=${encodeURIComponent(message)}`);
    }
  }
  redirect(`/orders/${id}`);
}

async function reorderAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  let target = '/cart';
  try {
    const result = await reorderOrder(session, id);
    target = result.checkoutUrl || '/cart';
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not reorder.';
    redirect(`/orders/${id}?error=${encodeURIComponent(message)}`);
  }
  redirect(target);
}

async function reorderToQuoteAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  try {
    await cloneOrderToQuote(session, id);
  } catch (err) {
    const message = err instanceof StorefrontApiError ? err.message : 'Could not create quote request.';
    redirect(`/orders/${id}?error=${encodeURIComponent(message)}`);
  }
  redirect('/quote-requests');
}
