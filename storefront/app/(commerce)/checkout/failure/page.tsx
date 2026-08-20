import type { ReactNode } from 'react';
import { FailurePanel } from '../../../../components/checkout/FailurePanel';
import { getServerContext } from '../../../../lib/server-context';

/**
 * Checkout Failure Page (feature 036, US4). Reached when order placement
 * fails; the cart is preserved (the placement transaction rolled back).
 * Authenticated, transactional → noindex.
 *
 * Issue #274 — **placement failures only**, and that is what makes the copy
 * true: `checkout.failure.cartKept` promises an untouched cart, which holds
 * only while no order exists. The one caller left is `submitAction` in
 * `../page.tsx`. A buyer whose order was already placed goes to `/orders/:id`
 * instead — this page's "Try again" button leads back to checkout, which for
 * such a buyer means placing a second order for the same goods.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function CheckoutFailurePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}): Promise<ReactNode> {
  const { reason } = await searchParams;
  const { locale } = await getServerContext();
  return <FailurePanel reason={reason ?? null} locale={locale} />;
}
