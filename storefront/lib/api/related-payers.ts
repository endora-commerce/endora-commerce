import type {
  CheckoutPayer,
  CheckoutPayersResponse,
  CreateRelatedPayerRequestBody,
  CustomerRelatedPayerLink,
  PaidOrderDetail,
  PaidOrderSummary,
  RelatedPayerIncomingRequest,
  RelatedPayerSentRequest,
} from '@endora-commerce/contracts';
import { cache } from 'react';
import { relatedPayerInvitationLookupResponseSchema, relatedPayersAvailabilityResponseSchema } from '@endora-commerce/contracts';
import type { RequestContext } from './client';
import { apiGet, StorefrontApiError } from './client';
import { apiGetAuthed, apiGetAuthedEnvelope, apiMutate } from './mutations';
import { isModuleDisabled, withModuleAbsence } from './module-absence';

/**
 * `specs/182-related-payers/` FR-002 — whether the capability is on for the request's channel
 * (`GET /api/v1/related-payers/availability`). Module presence alone is not enough: where
 * `related_payers.enabled` is off on the channel every account route answers `404`, so the
 * account offers neither *Payers* nor *Orders we pay for*, as if the module were absent.
 *
 * `false` on any failure — the module off (`MODULE_DISABLED`), a malformed answer, the API down:
 * the surfaces it gates cannot work without the routes it describes, so hiding them is the
 * absence those routes would answer anyway.
 */
export function getRelatedPayersAvailability(sessionCookie: string, ctx: RequestContext): Promise<boolean> {
  return readAvailability(sessionCookie, ctx.salesChannelCode, ctx.locale);
}

/**
 * Wrapped in React's `cache` so the account layout and the *Payers* page read it once per
 * request; keyed on primitives, because `cache` compares its arguments by identity.
 */
const readAvailability = cache(async (sessionCookie: string, salesChannelCode?: string, locale?: string): Promise<boolean> => {
  try {
    const data = await apiGetAuthed<unknown>({
      path: '/api/v1/related-payers/availability',
      sessionCookie,
      ctx: { salesChannelCode, locale },
    });
    const parsed = relatedPayersAvailabilityResponseSchema.shape.data.safeParse(data);
    return parsed.success && parsed.data.enabled;
  } catch (err) {
    // A session that has expired is the signed-out state, not a failure worth a log line.
    if (!isModuleDisabled(err) && !(err instanceof StorefrontApiError && err.status === 401)) {
      console.warn('[storefront] related payers availability read failed', err instanceof Error ? err.message : String(err));
    }
    return false;
  }
});

/**
 * `specs/182-related-payers/` — the payers this buyer may order with now, on the request's
 * channel (`GET /api/v1/checkout/payers`, FR-060).
 *
 * Empty when there are none, and equally when the capability is absent: the route answers
 * `404` where it is off on the channel (FR-002) and `MODULE_DISABLED` while the module is off.
 * Both mean "no *Paid by* choice", which is the unchanged checkout (SC-007). Anything else
 * still throws to the checkout error boundary.
 */
export async function listCheckoutPayers(sessionCookie: string, ctx: RequestContext): Promise<CheckoutPayer[]> {
  try {
    return await withModuleAbsence(async () => {
      return await apiGetAuthed<CheckoutPayersResponse['data']>({ path: '/api/v1/checkout/payers', sessionCookie, ctx });
    }, []);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return [];
    throw err;
  }
}

/** One page of `GET /api/v1/account/paid-orders` (FR-070). */
export interface PaidOrdersPage {
  readonly orders: PaidOrderSummary[];
  readonly cursor: string | null;
  readonly hasMore: boolean;
}

/**
 * `specs/182-related-payers/` FR-070 — the orders billed to the caller's Organization.
 * `null` when the list is not the caller's to read — no `view_paid_orders`, the capability off
 * on the channel (`404`) or the module off — so the page answers not-found for all three.
 */
export async function listPaidOrders(
  sessionCookie: string,
  ctx: RequestContext,
  cursor?: string,
): Promise<PaidOrdersPage | null> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  try {
    return await withModuleAbsence(async () => {
      // `apiGetAuthed` answers `data` alone and would drop the cursor: this list reads its envelope.
      const payload = await apiGetAuthedEnvelope<{ data: PaidOrderSummary[]; pagination: { cursor: string | null; hasMore: boolean } }>({
        path: `/api/v1/account/paid-orders${query}`,
        sessionCookie,
        ctx,
      });
      return { orders: payload.data, cursor: payload.pagination.cursor, hasMore: payload.pagination.hasMore };
    }, null);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/** FR-071 — one order billed to the caller's Organization, read-only; `null` when not theirs to read. */
export async function getPaidOrder(sessionCookie: string, ctx: RequestContext, id: string): Promise<PaidOrderDetail | null> {
  try {
    return await withModuleAbsence(async () => {
      return await apiGetAuthed<PaidOrderDetail>({
        path: `/api/v1/account/paid-orders/${encodeURIComponent(id)}`,
        sessionCookie,
        ctx,
      });
    }, null);
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * `specs/182-related-payers/` FR-047 — one list of the **Payers** page. Empty when the list is not
 * the caller's to read (`403`/`404`: the permission, the capability off on the channel) or the
 * module is off: the page shows each section by permission, and a refused one shows nothing.
 */
async function payerList<T>(path: string, sessionCookie: string, ctx: RequestContext): Promise<T[]> {
  try {
    return await withModuleAbsence(() => apiGetAuthed<T[]>({ path, sessionCookie, ctx }), []);
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 403)) return [];
    throw err;
  }
}

export const listPayerLinks = (session: string, ctx: RequestContext) =>
  payerList<CustomerRelatedPayerLink>('/api/v1/account/related-payers', session, ctx);
export const listSentPayerRequests = (session: string, ctx: RequestContext) =>
  payerList<RelatedPayerSentRequest>('/api/v1/account/related-payers/requests', session, ctx);
export const listIncomingPayerRequests = (session: string, ctx: RequestContext) =>
  payerList<RelatedPayerIncomingRequest>('/api/v1/account/related-payers/incoming', session, ctx);
export const listPayees = (session: string, ctx: RequestContext) =>
  payerList<CustomerRelatedPayerLink>('/api/v1/account/payees', session, ctx);

/** FR-040 — always answered `202 pending` whatever the tax ID (FR-041); `429` past the daily limit. */
export async function sendPayerRequest(session: string, ctx: RequestContext, body: CreateRelatedPayerRequestBody): Promise<void> {
  await apiMutate({ method: 'POST', path: '/api/v1/account/related-payers/requests', body, sessionCookie: session, ctx });
}

export async function withdrawPayerRequest(session: string, ctx: RequestContext, requestId: string): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: `/api/v1/account/related-payers/requests/${encodeURIComponent(requestId)}/withdraw`,
    sessionCookie: session,
    ctx,
  });
}

export async function acceptPayerRequest(session: string, ctx: RequestContext, requestId: string): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: `/api/v1/account/related-payers/incoming/${encodeURIComponent(requestId)}/accept`,
    sessionCookie: session,
    ctx,
  });
}

export async function rejectPayerRequest(session: string, ctx: RequestContext, requestId: string, reason: string | null): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: `/api/v1/account/related-payers/incoming/${encodeURIComponent(requestId)}/reject`,
    body: reason ? { reason } : {},
    sessionCookie: session,
    ctx,
  });
}

/** FR-050 — X revokes a payer link (`buyer`), or Y a link where it pays (`payer`). */
export async function revokePayerLinkFrom(
  side: 'buyer' | 'payer',
  session: string,
  ctx: RequestContext,
  linkId: string,
): Promise<void> {
  const base = side === 'buyer' ? '/api/v1/account/related-payers' : '/api/v1/account/payees';
  await apiMutate({ method: 'POST', path: `${base}/${encodeURIComponent(linkId)}/revoke`, sessionCookie: session, ctx });
}

/**
 * US6 (FR-040) — the invitations this payer sent buyers, as their sender reads them; `null` when the
 * route is absent — the channel's `payer_may_invite_buyers` off (`404`), no `approve` (`403`) or the
 * module off — so the page offers no invitation at all (US6-3).
 */
export async function listPayeeInvitations(session: string, ctx: RequestContext): Promise<RelatedPayerSentRequest[] | null> {
  try {
    return await withModuleAbsence(
      () => apiGetAuthed<RelatedPayerSentRequest[]>({ path: '/api/v1/account/payees/invitations', sessionCookie: session, ctx }),
      null,
    );
  } catch (err) {
    if (err instanceof StorefrontApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

/** FR-045 — the payer withdraws a pending invitation it sent. */
export async function withdrawPayeeInvitation(session: string, ctx: RequestContext, requestId: string): Promise<void> {
  await apiMutate({
    method: 'POST',
    path: `/api/v1/account/payees/invitations/${encodeURIComponent(requestId)}/withdraw`,
    sessionCookie: session,
    ctx,
  });
}

/** US6 — the request route's one reply (`202 pending`) whatever the tax ID; `429` past the daily limit. */
export async function sendPayeeInvitation(session: string, ctx: RequestContext, body: CreateRelatedPayerRequestBody): Promise<void> {
  await apiMutate({ method: 'POST', path: '/api/v1/account/payees/invitations', body, sessionCookie: session, ctx });
}

/**
 * FR-044, T092 — the tax ID a live invitation to register names, for the registration form; `null`
 * for anything else (unknown, used up, expired, the capability or module off, the API down): the
 * form then starts empty, as it always did. Never cached: the token is single-purpose.
 */
export async function lookupPayerInvitation(token: string, ctx: RequestContext = {}): Promise<{ taxId: string } | null> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  try {
    const payload = await apiGet<unknown>(`/api/v1/related-payers/invitations/${encodeURIComponent(token)}`, ctx, { revalidate: false });
    const parsed = relatedPayerInvitationLookupResponseSchema.safeParse(payload);
    return parsed.success ? parsed.data.data : null;
  } catch {
    return null;
  }
}
