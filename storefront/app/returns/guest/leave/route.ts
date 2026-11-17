import { leaveGuestSession } from '../../../../lib/api/returns-guest';
import { localizePath } from '../../../../lib/i18n/locale-path';
import {
  RETURNS_GUEST_PENDING_COOKIE,
  RETURNS_GUEST_SESSION_COOKIE,
  clearCookie,
  forwardedForOf,
  requestCookie,
} from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/guest/leave` — end the guest session (`specs/181-guest-complaints/` contract
 * G4, FR-023; design review F-16): *Use a different address* on the form, *Done – end
 * session* on the success page.
 *
 * The backend ends the session (`ended_at`); the cookies go whatever it answers, so a
 * visitor is never left holding one they cannot end. Back to the entry.
 */
export async function POST(request: Request): Promise<Response> {
  const { ctx, urlState } = await getServerContext();
  const at = (path: string): string => (urlState ? localizePath(path, urlState) : path);
  const secure = new URL(request.url).protocol === 'https:';
  const session = requestCookie(request, RETURNS_GUEST_SESSION_COOKIE);
  if (session) {
    try {
      await leaveGuestSession(session, { ctx, forwardedFor: forwardedForOf(request) });
    } catch {
      // Ended or unknown already, or unreachable: the cookie goes either way.
    }
  }
  const headers = new Headers({ Location: at('/returns/guest'), 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', clearCookie(RETURNS_GUEST_SESSION_COOKIE, '/', secure));
  headers.append('Set-Cookie', clearCookie(RETURNS_GUEST_PENDING_COOKIE, at('/returns/guest'), secure));
  return new Response(null, { status: 303, headers });
}
