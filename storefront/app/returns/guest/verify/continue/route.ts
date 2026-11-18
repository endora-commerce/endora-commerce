import { redeemGuestLink } from '../../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../../lib/api/client';
import { localizePath } from '../../../../../lib/i18n/locale-path';
import { GUEST_SESSION_MAX_AGE, RETURNS_GUEST_SESSION_COOKIE, forwardedForOf, setCookie } from '../../../../../lib/returns/guest';
import { getServerContext } from '../../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/guest/verify/continue` — the *Continue* button: redeem the link
 * (`specs/181-guest-complaints/` contract G3, research R-3 item 4, R-4; design review F-3).
 *
 * A sibling of the verify page rather than its `route.ts`: Next refuses a page and a route
 * handler in one segment, and R-13's table put both at `/returns/guest/verify`.
 *
 * - Redeemed: the session cookie `b2b_returns_guest` (`HttpOnly`, `SameSite=Lax`, `Path=/`,
 *   `Max-Age` = what the session has left) and `303` to the form.
 * - Refused (`410`, or anything the backend did not accept): `303` to the page's invalid
 *   state, which continues to the form while a guest session is live — so the second POST
 *   of a double click lands where the first did (F-3), not on an error.
 * - The setting off: the entry's notice. The throttle: back to *Continue*, saying so.
 */
function seeOther(location: string, cookie?: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
}

export async function POST(request: Request): Promise<Response> {
  const { ctx, urlState } = await getServerContext();
  const at = (path: string): string => (urlState ? localizePath(path, urlState) : path);
  let token = '';
  try {
    const value = (await request.formData()).get('token');
    token = typeof value === 'string' ? value.trim() : '';
  } catch {
    token = '';
  }
  if (!token || token.length > 512) return seeOther(at('/returns/guest/verify?state=invalid'));
  try {
    const session = await redeemGuestLink(token, { ctx, forwardedFor: forwardedForOf(request) });
    const left = Math.min(GUEST_SESSION_MAX_AGE, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
    const secure = new URL(request.url).protocol === 'https:';
    return seeOther(
      at('/returns/guest/new'),
      setCookie(RETURNS_GUEST_SESSION_COOKIE, encodeURIComponent(session.sessionToken), { path: '/', maxAge: left, secure }),
    );
  } catch (error) {
    if (error instanceof StorefrontApiError && error.status === 403) return seeOther(at('/returns/guest?error=disabled'));
    if (error instanceof StorefrontApiError && error.status === 429) {
      return seeOther(at(`/returns/guest/verify?token=${encodeURIComponent(token)}&error=rate_limited`));
    }
    return seeOther(at('/returns/guest/verify?state=invalid'));
  }
}
