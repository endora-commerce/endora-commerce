import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getMyOrder } from '../../../../lib/api/orders';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { SuccessPanel } from '../../../../components/checkout/SuccessPanel';

/**
 * Checkout Success Page (feature 036, US1). Reached after a successful
 * placement. Shows the customer-facing business Order ID (not the UUID) and a
 * payment-method next-step hint. Authenticated, transactional → noindex.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await searchParams;
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
    <SuccessPanel
      businessId={order.businessId}
      orderId={order.id}
      paymentKind={order.paymentMethod.kind}
      locale={locale}
    />
  );
}
