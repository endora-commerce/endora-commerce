import { requestGuestVerification } from '../../../../lib/api/returns-guest';
import { StorefrontApiError } from '../../../../lib/api/client';
import { localizePath } from '../../../../lib/i18n/locale-path';
import {
  GUEST_RESEND_AFTER_MS,
  GUEST_SESSION_MAX_AGE,
  RETURNS_GUEST_PENDING_COOKIE,
  decodeGuestPending,
  encodeGuestPending,
  forwardedForOf,
  requestCookie,
  setCookie,
} from '../../../../lib/returns/guest';
import { getServerContext } from '../../../../lib/server-context';

export const dynamic = 'force-dynamic';

/**
 * `POST /returns/guest/request` — ask for a verification link (`specs/181-guest-complaints/`
 * contract G2, FR-020, FR-021; design review S-1, S-2, F-7).
 *
 * The backend answers one way for every address — sent, throttled, honeypot, an account or
 * none, a failed send — and so does this handler: `303` to the *sent* page, the address kept
 * in an `HttpOnly` cookie scoped to the guest pages, never in the URL (issue #745). A
 * backend that cannot be reached gets the same answer: the page promises nothing it knows.
 *
 * Three answers are not uniform, and say nothing about any account: a malformed address
 * (`400`), the per-client throttle (`429`) and guest complaints switched off (`403`). Each
 * comes back to the page that posted as a fixed code.
 *
 * *Send again* without JavaScript, sooner than 60 seconds after this browser's own request,
 * sends nothing and says to wait — judged from this browser's cookie alone (design review S-2).
 */
function seeOther(location: string, cookie?: string): Response {
  return new Response(null, {
    status: 303,
    headers: { Location: location, 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) },
  });
}

export async function POST(request: Request): Promise<Response> {
  const { ctx, locale, urlState } = await getServerContext();
  const at = (path: string): string => (urlState ? localizePath(path, urlState) : path);
  const secure = new URL(request.url).protocol === 'https:';
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    form = new FormData();
  }
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  const email = field('email').trim();
  const hp = field('hp');
  const origin = field('origin');
  // Fixed codes in literal addresses (issues #790, #810): never a value read from anywhere.
  const back = (code: 'email' | 'rate_limited'): string =>
    at(
      origin === 'sent'
        ? code === 'email'
          ? '/returns/guest/sent?error=email'
          : '/returns/guest/sent?error=rate_limited'
        : code === 'email'
          ? '/returns/guest?error=email'
          : '/returns/guest?error=rate_limited',
    );
  const pendingCookie = (requestedAt: number, linkValidMinutes: number): string =>
    setCookie(RETURNS_GUEST_PENDING_COOKIE, encodeGuestPending({ email, requestedAt, linkValidMinutes }), {
      path: at('/returns/guest'),
      maxAge: GUEST_SESSION_MAX_AGE,
      secure,
    });

  const previous = decodeGuestPending(requestCookie(request, RETURNS_GUEST_PENDING_COOKIE));
  if (origin === 'sent' && previous && previous.email === email && Date.now() - previous.requestedAt < GUEST_RESEND_AFTER_MS) {
    return seeOther(at('/returns/guest/sent?wait=1'));
  }

  let linkValidMinutes = previous?.linkValidMinutes ?? 60;
  try {
    const accepted = await requestGuestVerification(
      { email, ...(hp ? { hp } : {}), language: locale },
      { ctx, forwardedFor: forwardedForOf(request) },
    );
    linkValidMinutes = accepted.linkValidMinutes;
  } catch (error) {
    if (error instanceof StorefrontApiError) {
      // The address is kept for the field, as typed, so one character is corrected (Postel).
      if (error.status === 400) return seeOther(back('email'), pendingCookie(0, linkValidMinutes));
      if (error.status === 429) return seeOther(back('rate_limited'));
      if (error.status === 403) return seeOther(at('/returns/guest?error=disabled'));
    }
    // Anything else answers as a success: FR-021's one answer.
  }
  return seeOther(at('/returns/guest/sent'), pendingCookie(Date.now(), linkValidMinutes));
}
