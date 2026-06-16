'use server';

import { createRfq, type CreateRfqLine } from '../../../lib/api/rfq';
import { StorefrontApiError } from '../../../lib/api/client';
import { getSessionCookie } from '../../../lib/session';

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
    return { ok: false, reason: 'error', message: 'Empty quote request.' };
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
      return { ok: false, reason: 'error', message: err.message };
    }
    throw err;
  }
}
