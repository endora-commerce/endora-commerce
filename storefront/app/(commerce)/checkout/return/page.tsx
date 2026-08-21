import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { PaymentPendingPanel } from '../../../../components/checkout/PaymentPendingPanel';
import {
  nextPendingPoll,
  parsePollAttempt,
  parseReturnOutcome,
  paymentReturnUrl,
  postPaymentDestination,
} from '../../../../lib/payments/post-payment-landing';

/**
 * Post-payment landing (issue #287) — the one page every gateway hands the
 * buyer back to.
 *
 * The owner ruled that a correct payment lands on the success page and a
 * failed one on the failure page. PayU's `continueUrl` and Autopay's
 * `ReturnURL` are a single URL used for every outcome, so no gateway
 * configuration can express that ruling: the platform has to decide **after**
 * the buyer lands. This route is that decision, and the gateways with two
 * hooks point both of them here as well — one behaviour, not two.
 *
 * It places nothing and renders nothing of its own except the wait. The
 * gateway's `outcome` is a hint the buyer can replay, so the order's own
 * payment state is what decides; see `lib/payments/post-payment-landing.ts`
 * for the rule and its tests.
 *
 * Authenticated, transactional → noindex.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    /** Older gateway configurations spelled it `orderId`; still accepted. */
    orderId?: string;
    outcome?: string;
    /** How many times the pending wait has already looked. */
    attempt?: string;
    /** Autopay appends its own return fields; none of them decides anything. */
    OrderID?: string;
    ServiceID?: string;
    Hash?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const params = await searchParams;
  const id = params.id ?? params.orderId;
  const outcome = parseReturnOutcome(params.outcome);
  if (!session) {
    const next = id ? paymentReturnUrl(id, outcome) : '/account/orders';
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!id) redirect('/account/orders');

  let order;
  try {
    order = await getMyOrder(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      redirect('/account/orders');
    }
    throw err;
  }

  const destination = postPaymentDestination(order, outcome);
  if (destination) redirect(destination);

  // The webhook race. The buyer is back before the gateway's notification, so
  // the order is neither paid nor failed and neither page would be true.
  const { locale } = await getServerContext();
  return (
    <PaymentPendingPanel
      businessId={order.businessId}
      orderId={order.id}
      checkAgainUrl={paymentReturnUrl(order.id, outcome)}
      poll={nextPendingPoll(order.id, outcome, parsePollAttempt(params.attempt))}
      locale={locale}
    />
  );
}
