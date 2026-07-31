import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { SuccessPanel } from '../../../../components/checkout/SuccessPanel';
import { PurchaseTracker } from '../../../../components/analytics/EcommerceTrackers';

/**
 * Checkout Success Page (feature 036, US1). Reached after a successful
 * placement. Shows the customer-facing business Order ID (not the UUID) and a
 * payment-method next-step hint. Authenticated, transactional → noindex.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; orderId?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const params = await searchParams;
  // Prefer `id` (canonical); accept legacy `orderId` from older gateway continueUrls.
  const id = params.id ?? params.orderId;
  if (!session) redirect('/login?next=/account/orders');
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
  return (
    <>
      {/* Feature 049 — GA4 purchase (no-op unless Enhanced Ecommerce is on). */}
      <PurchaseTracker
        order={{
          transactionId: order.businessId,
          value: order.total,
          currency: order.currency,
          items: order.items.map((it) => ({
            sku: it.productSnapshot.sku,
            name: it.productSnapshot.name,
            price: it.unitPrice,
            quantity: it.quantity,
            currency: order.currency,
          })),
        }}
      />
      <SuccessPanel
        businessId={order.businessId}
        orderId={order.id}
        paymentKind={order.paymentMethod.kind}
        locale={locale}
      />
    </>
  );
}
