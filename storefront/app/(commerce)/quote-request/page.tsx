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
  // This URL is handed to a client component (`<RfqDraftView>`) that fetches
  // from the browser, so it must be the public, build-time-baked
  // `NEXT_PUBLIC_API_BASE_URL` — never the server-only `BACKEND_BASE_URL`
  // (the internal `http://backend:3001`), which triggers a Mixed Content block
  // when the page is served over HTTPS.
  const apiBase =
    process.env['NEXT_PUBLIC_API_BASE_URL'] ?? 'http://localhost:3001';
  return <RfqDraftView apiBase={apiBase} locale={locale} />;
}
