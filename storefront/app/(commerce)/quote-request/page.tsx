import type { ReactNode } from 'react';
import { RfqDraftView } from '../../../components/rfq/RfqDraftView';
import { getServerContext } from '../../../lib/server-context';
import { getSessionCookie } from '../../../lib/session';
import { getQuoteRequestNegotiation } from '../../../lib/api/rfq';
import { getCommerceAbilitiesAction } from '../../../lib/actions/cart';
import type { Metadata } from 'next';

/**
 * Not indexed (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010): an
 * authenticated or transactional surface, of no use to a crawler and not a
 * page a search result should ever land a buyer on.
 */
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Quote-request draft page (`/quote-request`) — the cart-modelled "review &
 * submit" view. The draft lines live client-side in `localStorage`, so this
 * server component only resolves the locale and hands off to the client
 * `<RfqDraftView>`. Submission runs through a server action (see
 * `actions.ts`) so the httpOnly session cookie reaches the backend.
 *
 * Feature 146 (FR-021, FR-025): whether this buyer may propose prices is read
 * here, on the server, with the buyer's own session and no shared cache, and
 * handed to the view. An anonymous visitor has no session and is shown the
 * input (fail-open display; the API decides on submit).
 *
 * `specs/170-organization-roles/` (FR-040, FR-057): submitting needs the
 * member's `quote_requests.create`; a visitor keeps the submit (and signs in).
 */
export default async function QuoteRequestDraftPage(): Promise<ReactNode> {
  const [{ locale }, session, abilities] = await Promise.all([
    getServerContext(),
    getSessionCookie(),
    getCommerceAbilitiesAction(),
  ]);
  const priceProposalsAllowed = await getQuoteRequestNegotiation(session);
  return (
    <RfqDraftView
      locale={locale}
      priceProposalsAllowed={priceProposalsAllowed}
      canSubmit={abilities.requestQuote}
    />
  );
}
