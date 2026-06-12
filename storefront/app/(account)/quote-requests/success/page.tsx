import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { getRfqById } from '../../../../lib/api/rfq';
import { getSessionCookie } from '../../../../lib/session';
import { getServerContext } from '../../../../lib/server-context';
import { StorefrontApiError } from '../../../../lib/api/client';
import { RfqSuccessPanel } from '../../../../components/rfq/RfqSuccessPanel';

/**
 * Quote Request Success Page (feature 008). Reached after a buyer submits a
 * quote request from `/quote-request`. Mirrors the checkout success page: shows
 * the customer-facing business RFQ ID (not the UUID) and a next-steps hint.
 * Authenticated, transactional → noindex.
 *
 * Note: this static `success` segment takes precedence over the sibling `[id]`
 * dynamic route, so `/quote-requests/success` always lands here.
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function QuoteRequestSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}): Promise<ReactNode> {
  const session = await getSessionCookie();
  const { id } = await searchParams;
  if (!session) redirect('/login?next=/quote-requests');
  if (!id) redirect('/quote-requests');

  let rfq;
  try {
    rfq = await getRfqById(session, id);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) {
      redirect('/quote-requests');
    }
    throw err;
  }

  const { locale } = await getServerContext();
  return <RfqSuccessPanel businessId={rfq.businessId} rfqId={rfq.id} locale={locale} />;
}
