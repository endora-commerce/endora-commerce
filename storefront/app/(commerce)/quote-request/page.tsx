import type { ReactNode } from 'react';
import { RfqDraftView } from '../../../components/rfq/RfqDraftView';
import { getServerContext } from '../../../lib/server-context';

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
