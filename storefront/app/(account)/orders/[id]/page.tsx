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
import { retryOrderPayment } from '../../../../lib/api/payments';
import { offersPaymentRetry, paymentRetryDestination } from '../../../../lib/payment-retry';
import { getReturnable } from '../../../../lib/api/returns';
import { listMyOrderInvoices, invoiceDownloadUrl } from '../../../../lib/api/invoices';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { formatMoney } from '../../../../lib/i18n/money';
import { tForLocale } from '../../../../lib/i18n/messages';
import { resolvePaymentReturnNotice } from '../../../../lib/orders/payment-return-notice';

/**
 * Order confirmation page (T158). Renders the order the buyer just placed
 * (or any prior order they own). The page also surfaces the `nextAction`
 * the backend returned — for the bank-transfer driver this is
 * `awaiting_transfer` and the page tells the buyer what to do next.
 */

export default async function OrderConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /**
   * `error` is written by every server action on this page. It had been
   * written and never read — the page took no `searchParams` at all — so a
   * reorder or a comment that failed redirected the buyer back to a page that
   * said nothing. Issue #264 needed the same channel for a refused payment.
   *
   * Issue #274 then made this page where every payment gateway returns the
   * buyer, so it also reads why they are back (`payment`).
   *
   * Kept optional: Next.js always passes it to a page, but the fallback costs
   * nothing and the destructure cannot throw on a caller that does not.
   */
  searchParams?: Promise<{ payment?: string; error?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await params;
  const { payment: paymentReturn, error: actionError } = (await searchParams) ?? {};
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
  const t = tForLocale(locale);
  const paymentNotice = resolvePaymentReturnNotice(paymentReturn, order.paymentStatus);
  // Terminal orders close commenting; a pending payment surfaces a Pay CTA.
  const isTerminal = order.status === 'completed' || order.status === 'cancelled';
  // Deliberately narrow, and it stays narrow after feature 085 widened the two
  // predicates below it: this is the "we are waiting for your money" hint, and
  // an order whose payment was declined gets the stronger retry hint instead —
  // `failed` is only ever written by the gateway settlement ingress, so such an
  // order is always a gateway order and `canRetryPayment` is always true for
  // it. Widening this would print both.
  const awaitingPayment = !isTerminal && order.paymentStatus === 'awaiting_payment';
  // Issue #264 — deliberately not gated on `isTerminal`. It was written when
  // the settlement ingress applied a `status_on_failure` seeded `cancelled`
  // everywhere, so a declined card left a terminal-looking order the buyer
  // still owed money on. Feature 085 holds such an order at `on_hold` instead,
  // which is not terminal — but the decision is unchanged, because the server
  // owns it and the storefront must not re-derive a lifecycle rule. See
  // `lib/payment-retry.ts`.
  const canRetryPayment = offersPaymentRetry(order);

  // Surface a return/complaint entry point directly on the order — only when the
  // order is actually eligible (entered a completing status, items still
  // returnable). Falls back to hidden on any error so the page never breaks.
  let returnEligible = false;
  try {
    const returnable = await getReturnable(session, id);
    returnEligible = returnable.eligible;
  } catch {
    returnEligible = false;
  }

  // Invoices attached to this order (feature 047). Hidden when none are ready.
  let invoices: Awaited<ReturnType<typeof listMyOrderInvoices>> = [];
  try {
    invoices = await listMyOrderInvoices(session, id);
  } catch {
    invoices = [];
  }

  return (
    <div className="b2b-auth max-w-[720px]">
      <h1>Thank you — order placed</h1>
      <p className="b2b-auth__success">
        Order <strong>{order.businessId}</strong> has been received.
      </p>

      {actionError && actionError.trim().length > 0 ? (
        <p role="alert" className="b2b-auth__error">
          {actionError}
        </p>
      ) : null}

      {paymentNotice ? <p className="b2b-auth__hint">{t(paymentNotice)}</p> : null}

      {order.nextAction?.kind === 'awaiting_transfer' ? (
        <p>
          Pay by bank transfer using the reference printed on the proforma invoice we&apos;ll
          email shortly. We&apos;ll update the order once the payment clears.
        </p>
      ) : null}

      {canRetryPayment ? (
        <div className="mb-6">
          <p className="b2b-auth__hint">{t('order.payment.retry.hint')}</p>
          <form action={retryPaymentAction} className="mt-2 inline">
            <input type="hidden" name="id" value={order.id} />
            <input type="hidden" name="code" value={order.paymentMethod.code} />
            <button type="submit" className="btn btn--primary btn--sm">
              {t('order.payment.retry.cta')}
            </button>
          </form>
        </div>
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
        {returnEligible ? (
          <Link href={`/returns/new?orderId=${order.id}`} className="btn btn--outline btn--sm">
            Request return / complaint
          </Link>
        ) : null}
        {(invoices ?? []).map((inv) => (
          <a
            key={inv.id}
            href={invoiceDownloadUrl(order.id, inv.id)}
            target="_blank"
            rel="noreferrer"
            className="btn btn--outline btn--sm"
          >
            Download invoice {inv.number}
          </a>
        ))}
        <Link href="/orders" className="btn btn--ghost btn--sm">
          See all orders
        </Link>
      </div>

      <h2 className="mt-10">Status</h2>
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

      <h2 className="mt-10">Items</h2>
      <table className="b2b-account__table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th>Unit</th>
            <th className="text-right">Line</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => (
            <tr key={it.id}>
              <td>
                <Link href={`/p/${it.productId}`}>{it.productSnapshot.name}</Link>
                <br />
                <small className="text-subtle">
                  SKU: {it.variantSnapshot?.sku ?? it.productSnapshot.sku}
                </small>
              </td>
              <td>{it.quantity}</td>
              <td>
                {formatMoney(it.unitPrice, order.currency, locale)}
              </td>
              <td className="text-right">
                {formatMoney(it.lineTotal, order.currency, locale)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={3} className="text-right">
              Subtotal
            </th>
            <td className="text-right">
              {formatMoney(order.subtotal, order.currency, locale)}
            </td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">
              Tax
            </th>
            <td className="text-right">
              {formatMoney(order.taxTotal, order.currency, locale)}
            </td>
          </tr>
          {order.discountTotal > 0 ? (
            <tr>
              <th colSpan={3} className="text-right">
                Discount
              </th>
              <td className="text-right">
                −{formatMoney(order.discountTotal, order.currency, locale)}
              </td>
            </tr>
          ) : null}
          <tr>
            <th colSpan={3} className="text-right">
              Delivery
            </th>
            <td className="text-right">
              {formatMoney(order.deliveryTotal, order.currency, locale)}
            </td>
          </tr>
          <tr>
            <th colSpan={3} className="text-right">
              <strong>Total</strong>
            </th>
            <td className="text-right">
              <strong>
                {formatMoney(order.total, order.currency, locale)}
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

      <h2 className="mt-10">Comments</h2>
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
        <form action={addCommentAction} className="mt-4">
          <input type="hidden" name="id" value={order.id} />
          <textarea
            name="body"
            required
            aria-label="Add a comment"
            rows={4}
            placeholder="Write a message to our team…"
            className="w-full resize-y rounded-md border border-line bg-surface px-[12px] py-[10px] text-[14px] leading-[1.5] text-fg placeholder:text-muted focus:border-line-strong focus:outline-none"
          />
          <div className="mt-4">
            <button type="submit" className="btn btn--outline btn--sm">
              Add comment
            </button>
          </div>
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

/**
 * Pay this order again (issue #264).
 *
 * The redirect target is computed inside the `try` and taken outside it:
 * `redirect()` works by throwing, so calling it in the `try` would be caught by
 * the very handler meant for API failures.
 */
async function retryPaymentAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  const code = (formData.get('code') as string) ?? '';
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  let target: string;
  try {
    const result = await retryOrderPayment(session, id);
    target =
      paymentRetryDestination(id, result, code) ??
      `/orders/${id}?error=${encodeURIComponent(
        result.opened ? t('order.payment.retry.failed') : t('order.payment.retry.inProgress'),
      )}`;
  } catch (err) {
    const message =
      err instanceof StorefrontApiError ? err.message : t('order.payment.retry.failed');
    target = `/orders/${id}?error=${encodeURIComponent(message)}`;
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
