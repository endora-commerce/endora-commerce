import type { ReactNode } from 'react';
import { RfqDraftView } from '../../../components/rfq/RfqDraftView';
import { getServerContext } from '../../../lib/server-context';
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
 */
export default async function QuoteRequestDraftPage(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  return <RfqDraftView locale={locale} />;
}
