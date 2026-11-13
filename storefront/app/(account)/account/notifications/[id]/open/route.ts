import type { NextRequest } from 'next/server';
import { getSessionCookie } from '../../../../../../lib/session';
import { getServerContext } from '../../../../../../lib/server-context';
import { localizePath } from '../../../../../../lib/i18n/locale-path';
import { StorefrontApiError } from '../../../../../../lib/api/client';
import {
  getCustomerNotification,
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
 * The entry is read by id (`GET /api/v1/storefront/notifications/:id`, T086),
 * under the list's own visibility, so wherever it sits in the list it is found
 * in one call. The target is always the stored link, never anything the URL
 * says, and only a storefront-relative path is followed (FR-047, checked again
 * here). A failed mark still redirects; an entry with no link, an id the API
 * refuses (`404` for an unknown or foreign one), a failed read, and the module
 * being off all land on the page, marking nothing — the page answers the
 * shop's 404 while the module is off (FR-048).
 */

export const dynamic = 'force-dynamic';

const PAGE = '/account/notifications';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const { ctx, modules, urlState } = await getServerContext();
  const session = await getSessionCookie();
  if (!session) {
    return seeOther(localizePath(`/login?next=${encodeURIComponent(PAGE)}`, urlState));
  }
  if (!modules.isPresent('customer_notifications')) return seeOther(localizePath(PAGE, urlState));

  const linkPath = await findLinkPath(session, ctx, id);
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
 * the entry cannot be read (refused as not the caller's, or any failure).
 */
async function findLinkPath(
  session: string,
  ctx: Parameters<typeof getCustomerNotification>[1],
  id: string,
): Promise<string | null | undefined> {
  try {
    return (await getCustomerNotification(session, ctx, id)).linkPath;
  } catch (err) {
    // A 404 is the expected answer for an id that is not the caller's; anything else is worth a line.
    if (!(err instanceof StorefrontApiError && err.status === 404)) {
      console.warn('[storefront] reading a notification to open it failed', err);
    }
    return undefined;
  }
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
