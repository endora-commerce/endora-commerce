import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { SuccessPanel } from '../../../../components/checkout/SuccessPanel';
import { PurchaseTracker } from '../../../../components/analytics/EcommerceTrackers';
import { purchaseTrackingPayload } from '../../../../lib/analytics/purchase-eligibility';

/**
 * Checkout Success Page (feature 036, US1). Reached after a successful
 * placement. Shows the customer-facing business Order ID (not the UUID) and a
 * payment-method next-step hint. Authenticated, transactional → noindex.
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

  const { locale } = await getServerContext();
  // Issue #274 — the tracker used to fire for whatever order this page was
  // handed, and PayU and Autopay returned every buyer here whatever the
  // outcome, so declined payments counted as revenue. A gateway order now has
  // to be confirmed; an order settled out of band (bank transfer, cash on
  // pickup, credit limit) still counts at placement, because its payment
  // never arrives while the buyer is on this page.
  const purchase = purchaseTrackingPayload(order);
  return (
    <>
      {/* Feature 049 — GA4 purchase (no-op unless Enhanced Ecommerce is on). */}
      {purchase ? <PurchaseTracker order={purchase} /> : null}
      <SuccessPanel
        businessId={order.businessId}
        orderId={order.id}
        paymentKind={order.paymentMethod.kind}
        locale={locale}
      />
    </>
  );
}
