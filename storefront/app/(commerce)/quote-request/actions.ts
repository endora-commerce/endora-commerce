'use server';

import { headers } from 'next/headers';
import { createRfq, type CreateRfqLine } from '../../../lib/api/rfq';
import { getProductMinimumsBySlugs } from '../../../lib/api/catalog';
import { StorefrontApiError, type RequestContext } from '../../../lib/api/client';
import { getSessionCookie } from '../../../lib/session';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';

/**
 * Server action backing the `/quote-request` draft submission.
 *
 * The submit must run on the server: the `b2b_session` cookie is httpOnly and
 * scoped to the storefront origin, so a browser `fetch` to the backend origin
 * never carries the buyer's identity and the backend answers 401 — which used
 * to bounce a logged-in buyer to /login and silently drop the request. Reading
 * the cookie here (via `getSessionCookie`) and forwarding it through `apiMutate`
 * keeps the authenticated identity intact.
 */
export type SubmitQuoteRequestResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'auth' }
  | { ok: false; reason: 'error'; message: string };

export async function submitQuoteRequest(input: {
  headerNote?: string;
  items: CreateRfqLine[];
}): Promise<SubmitQuoteRequestResult> {
  const session = await getSessionCookie();
  if (!session) return { ok: false, reason: 'auth' };
  if (input.items.length === 0) {
    const { locale } = await getServerContext();
    return { ok: false, reason: 'error', message: tForLocale(locale)('commerce.rfqDraft.emptySubmit') };
  }
  try {
    const rfq = await createRfq(session, {
      ...(input.headerNote ? { headerNote: input.headerNote } : {}),
      items: input.items,
    });
    return { ok: true, id: rfq.id };
  } catch (err) {
    if (err instanceof StorefrontApiError) {
      if (err.status === 401) return { ok: false, reason: 'auth' };
      // `detail`, not `message`: `message` carries the `CODE: ` prefix meant
      // for logs, and the buyer is shown this sentence verbatim — e.g. the
      // translated `RFQ_PRICE_PROPOSAL_NOT_ALLOWED` refusal (feature 146, FR-022).
      return { ok: false, reason: 'error', message: err.detail };
    }
    throw err;
  }
}

/**
 * Feature 155 (FR-032, US4 #14) — the current pieces minimum of the draft's products, by slug,
 * so the draft page can floor each line and show one already below its minimum.
 *
 * Read as the buyer (the session is forwarded, so their catalogue visibility applies) in the
 * request's sales channel (Constitution XII). The bounds and the failure tolerance are
 * `getProductMinimumsBySlugs`'s (threat S8, plan I5). Its argument comes from the browser, so
 * anything that is not a list of strings reads nothing.
 */
export async function readDraftMinimums(slugs: string[]): Promise<Record<string, number | null>> {
  if (!Array.isArray(slugs)) return {};
  const [session, requestHeaders] = await Promise.all([getSessionCookie(), headers()]);
  const salesChannelCode = requestHeaders.get('x-sales-channel') ?? undefined;
  const ctx: RequestContext = {
    ...(salesChannelCode !== undefined ? { salesChannelCode } : {}),
    ...(session ? { viewerSession: session } : {}),
  };
  return getProductMinimumsBySlugs(slugs, ctx);
}
