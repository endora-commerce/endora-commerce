import type { ReactNode } from 'react';
import { FailurePanel } from '../../../../components/checkout/FailurePanel';
import { getServerContext } from '../../../../lib/server-context';

/**
 * Checkout Failure Page (feature 036, US4). Reached when order placement
 * fails; the cart is preserved (the placement transaction rolled back).
 * Authenticated, transactional → noindex.
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
