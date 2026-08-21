import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { SuccessPanel } from '../../../../components/checkout/SuccessPanel';
import { PurchaseTracker } from '../../../../components/analytics/EcommerceTrackers';
import { purchaseTrackingPayload } from '../../../../lib/analytics/purchase-eligibility';
import {
  paymentFailureUrl,
  resolvePostPaymentLanding,
} from '../../../../lib/payments/post-payment-landing';

/**
 * Checkout Success Page (feature 036, US1). Shows the customer-facing business
 * Order ID (not the UUID) and a payment-method next-step hint.
 *
 * Two readers reach it. An **offline placement** — bank transfer, cash on
 * pickup, a credit-limit draw — arrives straight from `submitAction`, because
 * its settlement is arranged out of band and there is nothing to wait for. A
 * **gateway payment** arrives from `/checkout/return`, which only forwards
 * here once the order's own payment state says the money landed (issue #287).
 *
 * It is also a URL the buyer can bookmark and replay, so it re-applies the
 * landing rule with no gateway hint: an order whose payment has since been
 * recorded as failed is forwarded to the failure page rather than thanked
 * again. Authenticated, transactional → noindex.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{
    id?: string;
    orderId?: string;
    /** Autopay return query (OrderID is merchant id, not platform order UUID). */
    OrderID?: string;
    ServiceID?: string;
    Hash?: string;
  }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const params = await searchParams;
  // Prefer `id` (canonical); accept legacy `orderId` from older gateway continueUrls.
  // Autopay appends ServiceID/OrderID/Hash — keep `id` from ReturnURL when present.
  const id = params.id ?? params.orderId;
  if (!session) {
    const next = id
      ? `/checkout/success?id=${encodeURIComponent(id)}`
      : '/account/orders';
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

  // Issue #287 — no gateway hint, so this only fires on the order's own
  // `paymentStatus`: a payment recorded as failed, whose buyer is holding a
  // success URL. The pending state is deliberately *not* redirected — a
  // gateway adapter that opens no provider session lands its buyer here at
  // placement, and that buyer has an order and no wait to sit through.
  const landing = resolvePostPaymentLanding({
    paymentStatus: order.paymentStatus,
    paymentKind: order.paymentMethod.kind,
    outcome: undefined,
  });
  if (landing.kind === 'failure') redirect(paymentFailureUrl(order.id, landing.reason));

  const { locale } = await getServerContext();
  // Issue #274 — the tracker used to fire for whatever order this page was
  // handed, and PayU and Autopay returned every buyer here whatever the
  // outcome, so declined payments counted as revenue. A gateway order now has
  // to be confirmed; an order settled out of band (bank transfer, cash on
  // pickup, credit limit) still counts at placement, because its payment
  // never arrives while the buyer is on this page.
  //
  // Issue #277 — this page is no longer the only one that may count an order.
  // A PayU or Autopay redirect, a Stripe cancel and a TPay failure now return
  // the buyer to `/orders/:id`, which counts them there. Plenty still lands
  // here: an offline placement, Stripe's `success_url`, TPay's `successUrl`,
  // and every inline `/checkout/pay` form (PayU, TPay, Stripe) on success. The
  // two pages do not need to know about each other, because the conversion is
  // a claim the platform hands out once — see
  // `lib/analytics/purchase-conversion.ts`.
  const purchase = purchaseTrackingPayload(order);
  return (
    <>
      {/* Feature 049 — GA4 purchase (no-op unless Enhanced Ecommerce is on). */}
      {purchase ? <PurchaseTracker order={purchase} orderId={order.id} /> : null}
      <SuccessPanel
        businessId={order.businessId}
        orderId={order.id}
        paymentKind={order.paymentMethod.kind}
        locale={locale}
      />
    </>
  );
}
