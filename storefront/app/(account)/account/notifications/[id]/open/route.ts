import type { NextRequest } from 'next/server';
import { getSessionCookie } from '../../../../../../lib/session';
import { getServerContext } from '../../../../../../lib/server-context';
import { localizePath } from '../../../../../../lib/i18n/locale-path';
import {
  listCustomerNotifications,
  markCustomerNotificationRead,
} from '../../../../../../lib/api/customer-notifications';

/**
 * `GET /account/notifications/<id>/open` — how a notification is opened
 * (`specs/179-rfq-and-customer-notifications/` FR-050a, research R-24 (a)).
 *
 * The row is a real link, so it can open in a new tab or be copied; this
 * handler marks the entry read and answers `303` to the entry's own link, in the
 * request's language. A `GET` with that side effect is safe here: marking is
 * idempotent, touches only the caller's own entry, and is a no-op under
 * impersonation (the API answers it without writing). Rows link with
 * `prefetch={false}` and `/account*` is outside the speculation rules, so
 * nothing opens an entry the buyer did not.
 *
 * The centre's API has no read of one entry, so the link is found in the list:
 * from the page cursor the row carried (`?cursor=`), on through at most a few pages —
 * newer entries only ever push an entry further down. The target is always the
 * stored link, never anything the URL says, and only a storefront-relative path
 * is followed (FR-047, checked again here). A failed mark still redirects; an
 * entry with no link, an unknown id, and the module being off all land on the
 * page — which answers the shop's 404 while the module is off (FR-048).
 */

export const dynamic = 'force-dynamic';

const PAGE = '/account/notifications';
/** Read size of each list call while looking for the entry (the API's maximum). */
const SCAN_PAGE_SIZE = 50;
/** How many list pages are read before giving up and landing on the page. */
const SCAN_MAX_PAGES = 5;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { ctx, modules, urlState } = await getServerContext();
  const session = await getSessionCookie();
  if (!session) {
    return seeOther(localizePath(`/login?next=${encodeURIComponent(PAGE)}`, urlState));
  }
  if (!modules.isPresent('customer_notifications')) return seeOther(localizePath(PAGE, urlState));

  const cursorHint = new URL(request.url).searchParams.get('cursor');
  const linkPath = await findLinkPath(session, ctx, id, cursorHint || null);
  if (linkPath === undefined) return seeOther(localizePath(PAGE, urlState));

  try {
    await markCustomerNotificationRead(session, ctx, id);
  } catch (err) {
    // The buyer asked to go to the request; a mark that failed must not stop them.
    console.warn('[storefront] marking a notification read failed', err);
  }
  return seeOther(localizePath(linkPath !== null && isStorefrontPath(linkPath) ? linkPath : PAGE, urlState));
}

/**
 * The entry's link: a path, `null` for an entry without one, `undefined` when
 * the entry is not found (or the list cannot be read).
 */
async function findLinkPath(
  session: string,
  ctx: Parameters<typeof listCustomerNotifications>[1],
  id: string,
  cursor: string | null,
): Promise<string | null | undefined> {
  let next = cursor;
  try {
    for (let read = 0; read < SCAN_MAX_PAGES; read += 1) {
      const page = await listCustomerNotifications(session, ctx, { cursor: next, limit: SCAN_PAGE_SIZE });
      const found = page.items.find((item) => item.id === id);
      if (found) return found.linkPath;
      if (!page.nextCursor) return undefined;
      next = page.nextCursor;
    }
  } catch (err) {
    console.warn('[storefront] reading notifications to open one failed', err);
  }
  return undefined;
}

/** A path on this storefront: rooted, not protocol-relative, no backslash or control character. */
function isStorefrontPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || path[index] === '\\') return false;
  }
  return true;
}

/** A relative `Location`: the browser resolves it against the request's own origin. */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store' } });
}
