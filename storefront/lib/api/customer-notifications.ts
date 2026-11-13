// Server-only client of the customer notification centre's storefront API
// (`specs/179-rfq-and-customer-notifications/contracts/customer-notifications-storefront-api.md`).
// Every route is the signed-in buyer's own (`requireCustomer`), so each call
// forwards the session cookie, and the request's channel and language through
// the shared transport: the API scopes the list to the channel and translates
// the sentences into the language (FR-043, FR-044).

import { cache } from 'react';
import type {
  CustomerNotification,
  CustomerNotificationListResponse,
  CustomerNotificationUnreadCountResponse,
} from '@endora-commerce/contracts';
import { StorefrontApiError, type RequestContext } from './client';
import { apiGetAuthed, apiMutate } from './mutations';

/** One page of the centre, as the API answers it. */
export type CustomerNotificationPage = CustomerNotificationListResponse['data'];

/** The page size of `/account/notifications`. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** One page of the buyer's entries, newest first; throws on any refusal. */
export async function listCustomerNotifications(
  sessionCookie: string,
  ctx: RequestContext | undefined,
  page: { cursor: string | null; limit?: number },
): Promise<CustomerNotificationPage> {
  const query = new URLSearchParams({ limit: String(page.limit ?? NOTIFICATIONS_PAGE_SIZE) });
  if (page.cursor) query.set('cursor', page.cursor);
  return await apiGetAuthed<CustomerNotificationPage>({
    path: `/api/v1/storefront/notifications?${query.toString()}`,
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

/**
 * One of the buyer's entries, read by id under the list's visibility; marks
 * nothing. Throws on any refusal — `404 NOT_FOUND` for an id the list would not
 * show (another account's, another channel's, an absent producer's, unknown).
 */
export async function getCustomerNotification(
  sessionCookie: string,
  ctx: RequestContext | undefined,
  id: string,
): Promise<CustomerNotification> {
  return await apiGetAuthed<CustomerNotification>({
    path: `/api/v1/storefront/notifications/${encodeURIComponent(id)}`,
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

/**
 * The buyer's unread count, or `0` when it cannot be read. The account entry
 * renders the count on every page, so a failure must never fail the page: it
 * shows no indicator and is logged.
 *
 * Wrapped in React's `cache` so the root layout, the account layout and the
 * overview — all three render it — read it once per request. Keyed on
 * primitives, because `cache` compares its arguments by identity.
 */
export const getUnreadNotificationCount = cache(
  async (sessionCookie: string, salesChannelCode?: string, locale?: string): Promise<number> => {
    try {
      const data = await apiGetAuthed<CustomerNotificationUnreadCountResponse['data']>({
        path: '/api/v1/storefront/notifications/unread-count',
        sessionCookie,
        ctx: { salesChannelCode, locale },
      });
      return data.unreadCount;
    } catch (err) {
      // A session that has expired is the signed-out state, not a failure worth a log line.
      if (!(err instanceof StorefrontApiError && err.status === 401)) {
        console.warn('[storefront] notification unread count read failed', err);
      }
      return 0;
    }
  },
);

/** Marks one of the buyer's entries read; throws on a refusal (`404` for one that is not theirs). */
export async function markCustomerNotificationRead(
  sessionCookie: string,
  ctx: RequestContext | undefined,
  id: string,
): Promise<void> {
  await apiMutate<null>({
    method: 'POST',
    path: `/api/v1/storefront/notifications/${encodeURIComponent(id)}/read`,
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
}

/** Marks every entry the list shows read; answers how many changed. Throws on a refusal. */
export async function markAllCustomerNotificationsRead(
  sessionCookie: string,
  ctx: RequestContext | undefined,
): Promise<number> {
  const result = await apiMutate<{ updated: number }>({
    method: 'POST',
    path: '/api/v1/storefront/notifications/read-all',
    sessionCookie,
    ...(ctx ? { ctx } : {}),
  });
  return result.data?.updated ?? 0;
}
