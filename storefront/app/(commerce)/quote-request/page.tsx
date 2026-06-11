import type { ReactNode } from 'react';
import { RfqDraftView } from '../../../components/rfq/RfqDraftView';
import { getServerContext } from '../../../lib/server-context';

/**
 * Quote-request draft page (`/quote-request`) — the cart-modelled "review &
 * submit" view. The draft lines live client-side in `localStorage`, so this
 * server component only resolves the locale + backend base URL and hands off
 * to the client `<RfqDraftView>`.
 */
export default async function QuoteRequestDraftPage(): Promise<ReactNode> {
  const { locale } = await getServerContext();
  const apiBase =
    process.env['NEXT_PUBLIC_BACKEND_BASE_URL'] ??
    process.env['BACKEND_BASE_URL'] ??
    'http://localhost:3001';
  return <RfqDraftView apiBase={apiBase} locale={locale} />;
}
