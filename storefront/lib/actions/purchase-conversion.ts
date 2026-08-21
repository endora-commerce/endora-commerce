'use server';

import { getSessionCookie } from '../session';
import { claimPurchaseConversion } from '../api/orders';

/**
 * Spend an order's GA4 `purchase` conversion claim (issue #277).
 *
 * A server action rather than a call inside the page render, because the claim
 * must be spent when the conversion is actually reported and not when the page
 * is produced. Next.js renders a page on `<Link>` prefetch and may render it
 * again on a retry; a claim spent there would be spent for a buyer who never
 * saw the page, and the conversion would be lost with nothing to say so.
 *
 * It must also run on the server: `b2b_session` is httpOnly and scoped to the
 * storefront origin, so a browser `fetch` to the backend carries no identity
 * and the backend would answer 401 — the same reason the shopping-list actions
 * beside this one exist.
 *
 * Answers `false` for a signed-out caller, which is the same answer as "already
 * counted": either way this view reports nothing.
 */
export async function claimPurchaseConversionAction(orderId: string): Promise<boolean> {
  const session = await getSessionCookie();
  if (!session) return false;
  return claimPurchaseConversion(session, orderId);
}
