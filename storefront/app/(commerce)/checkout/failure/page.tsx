import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { FailurePanel } from '../../../../components/checkout/FailurePanel';
import { PaymentFailurePanel } from '../../../../components/checkout/PaymentFailurePanel';
import { getMyOrder } from '../../../../lib/api/orders';
import { retryOrderPayment } from '../../../../lib/api/payments';
import { offersPaymentRetry, paymentRetryDestination } from '../../../../lib/payment-retry';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { tForLocale } from '../../../../lib/i18n/messages';
import {
  checkoutSuccessUrl,
  parseReturnOutcome,
  paymentReturnUrl,
  resolvePostPaymentLanding,
} from '../../../../lib/payments/post-payment-landing';

/**
 * Checkout Failure Page — **two readers**, told different things (issue #287).
 *
 * *No `id`*: the buyer feature 036 wrote this page for. Placement threw, the
 * transaction rolled back, and the cart is genuinely intact — so the copy
 * promises exactly that and "Try again" belongs on `/checkout`. Its one caller
 * is `submitAction` in `../page.tsx`.
 *
 * *With an `id`*: the buyer the owner's ruling sends here — their order exists
 * and the payment did not settle. Both of the sentences above are false for
 * them: the placement completed the cart (`order-service.ts` sets
 * `cart.status = 'completed'`), and `/checkout` would place a second order for
 * goods they already owe for. They are offered one thing, paying *this* order.
 *
 * The `outcome` is a hint the buyer can bookmark and replay, so this page
 * re-applies the landing rule against the order's live payment status and
 * forwards rather than repeating a verdict the order has moved past.
 *
 * Authenticated, transactional → noindex.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutFailurePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; id?: string; outcome?: string }>;
}): Promise<ReactNode> {
  const { reason, id, outcome: rawOutcome } = await searchParams;
  const { locale } = await getServerContext();

  // The placement failure: no order was ever created, so there is nothing to
  // read and nothing to pay.
  if (!id) return <FailurePanel reason={reason ?? null} locale={locale} />;

  const outcome = parseReturnOutcome(rawOutcome);
  const session = await getSessionCookie();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent(paymentReturnUrl(id, outcome))}`);
  }

  let order;
  try {
    order = await getMyOrder(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      redirect('/account/orders');
    }
    throw err;
  }

  const landing = resolvePostPaymentLanding({
    paymentStatus: order.paymentStatus,
    paymentKind: order.paymentMethod.kind,
    outcome,
  });
  // The payment settled after the buyer was sent here, or the notification is
  // still in flight. Either way this page's verdict is out of date.
  if (landing.kind === 'success') redirect(checkoutSuccessUrl(order.id));
  if (landing.kind === 'pending') redirect(paymentReturnUrl(order.id, outcome));

  return (
    <PaymentFailurePanel
      businessId={order.businessId}
      orderId={order.id}
      reason={landing.reason}
      canRetry={offersPaymentRetry(order)}
      payAgainAction={payAgainAction}
      locale={locale}
    />
  );
}

/**
 * Start a fresh payment attempt for this order (issue #287).
 *
 * The same call the order page's control makes — this page is simply where a
 * gateway return puts the buyer, so it must not send them anywhere else to
 * find it. The redirect target is computed inside the `try` and taken outside
 * it: `redirect()` works by throwing, so calling it in the `try` would be
 * caught by the handler meant for API failures.
 *
 * A refusal goes to the order page's own `?error=` channel, which is the
 * platform's sentence about the order rather than about this page.
 */
async function payAgainAction(formData: FormData): Promise<void> {
  'use server';
  const session = await getSessionCookie();
  if (!session) redirect('/login');
  const id = (formData.get('id') as string) ?? '';
  const { locale } = await getServerContext();
  const t = tForLocale(locale);

  let target: string;
  try {
    const order = await getMyOrder(session, id);
    const result = await retryOrderPayment(session, id);
    target =
      paymentRetryDestination(id, result, order.paymentMethod.code) ??
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
