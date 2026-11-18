import { RETURNS_GUEST_SESSION_COOKIE } from '@endora-commerce/contracts';
import { offPlatformBodyOf } from './returnForm';

/**
 * The storefront's guest complaint flow (`specs/181-guest-complaints/` research R-13; design
 * review S-1 – S-8): the pure pieces the pages and the route handlers share — where a
 * signed-out visitor goes, the three cookies the flow keeps, and the guest body of 180's
 * no-order form. React-free and request-free, so the node-only tests assert them directly.
 */

/** The guest session (research R-4): `HttpOnly; SameSite=Lax; Path=/`. */
export { RETURNS_GUEST_SESSION_COOKIE };
/**
 * The address this browser asked a link for (design review F-7): shown on the *sent* page,
 * reused by *Send again*, and prefilling a new link's field (owner ruling O-3). Never in a
 * URL (issue #745).
 */
export const RETURNS_GUEST_PENDING_COOKIE = 'b2b_returns_guest_pending';
/** The filed case's tracking link, for the success page only (design review F-8). */
export const RETURNS_GUEST_FILED_COOKIE = 'b2b_returns_guest_filed';
/** The guest session's lifetime, and the pending cookie's (FR-023). */
export const GUEST_SESSION_MAX_AGE = 24 * 60 * 60;
/** How long the success page can be reloaded with the link on it (design review F-8). */
export const GUEST_FILED_MAX_AGE = 30 * 60;
/** How soon *Send again* is offered (design review S-2). */
export const GUEST_RESEND_AFTER_MS = 60_000;

/** Where the guest flow starts, and the form it leads to. */
export const GUEST_ENTRY_PATH = '/returns/guest';
export const GUEST_FORM_PATH = '/returns/guest/new';
/** Where a signed-in customer files the same complaint. */
export const CUSTOMER_ELSEWHERE_PATH = '/returns/new?origin=elsewhere';

/**
 * Where a signed-out visit to the returns area goes (FR-010): the guest entry while guest
 * complaints are in effect, sign-in otherwise. Both keep the page asked for, path and query
 * (180 D-14). Shared by the two account entry pages and the `(account)` layout, so whichever
 * answers first answers the same (design review F-1).
 */
export function signedOutReturnsTarget(pathAndQuery: string, guestEnabled: boolean): string {
  const target = encodeURIComponent(pathAndQuery);
  return guestEnabled ? `${GUEST_ENTRY_PATH}?from=${target}` : `/login?next=${target}`;
}

/** The two account pages whose signed-out visitor is offered the guest path. */
export function isReturnsEntryPath(pathname: string | null | undefined): boolean {
  return pathname === '/returns' || pathname === '/returns/new';
}

// ---------------------------------------------------------------------------
// Cookies. Written as `Set-Cookie` strings by the route handlers — the 180 pattern —
// and read through `next/headers` by the pages, or from the request by the handlers.
// ---------------------------------------------------------------------------

export interface GuestPending {
  readonly email: string;
  /** When the link was asked for, ms since the epoch; `0` for an address that was refused. */
  readonly requestedAt: number;
  readonly linkValidMinutes: number;
}

export interface GuestFiled {
  readonly ref: string;
  readonly trackingToken: string;
  readonly email: string;
}

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function decode(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function encodeGuestPending(value: GuestPending): string {
  return encode(value);
}

export function decodeGuestPending(raw: string | null | undefined): GuestPending | null {
  const v = decode(raw);
  if (!v || typeof v['email'] !== 'string' || v['email'].length > 254) return null;
  const requestedAt = typeof v['requestedAt'] === 'number' ? v['requestedAt'] : 0;
  const linkValidMinutes = typeof v['linkValidMinutes'] === 'number' ? v['linkValidMinutes'] : 60;
  return { email: v['email'], requestedAt, linkValidMinutes };
}

export function encodeGuestFiled(value: GuestFiled): string {
  return encode(value);
}

export function decodeGuestFiled(raw: string | null | undefined): GuestFiled | null {
  const v = decode(raw);
  if (!v || typeof v['ref'] !== 'string' || typeof v['trackingToken'] !== 'string' || typeof v['email'] !== 'string') return null;
  return { ref: v['ref'], trackingToken: v['trackingToken'], email: v['email'] };
}

/** One `Set-Cookie` value: always `HttpOnly; SameSite=Lax`, `Secure` over HTTPS. */
export function setCookie(name: string, value: string, opts: { path: string; maxAge: number; secure: boolean }): string {
  return `${name}=${value}; Path=${opts.path}; Max-Age=${Math.max(0, Math.floor(opts.maxAge))}; HttpOnly; SameSite=Lax${opts.secure ? '; Secure' : ''}`;
}

/** A `Set-Cookie` value deleting a cookie set with the same path. */
export function clearCookie(name: string, path: string, secure: boolean): string {
  return setCookie(name, '', { path, maxAge: 0, secure });
}

/** A cookie of the request a route handler answers (route handlers read the request, not the jar). */
export function requestCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      const value = rest.join('=');
      try {
        return decodeURIComponent(value) || null;
      } catch {
        return value || null;
      }
    }
  }
  return null;
}

/** The client address the backend's per-address limits key on (research R-8), as `forms` forwards it. */
export function forwardedForOf(request: Request): string | null {
  return request.headers.get('x-forwarded-for');
}

// ---------------------------------------------------------------------------
// The guest body (contract G7, design review F-4).
// ---------------------------------------------------------------------------

/**
 * 180's no-order post as the strict G7 body: no `orderId`, and a contact of name and phone
 * only — the e-mail is the session's verified address, never the form's (FR-031). A posted
 * `contact.email` is dropped, so the API never refuses the whole complaint for it. The
 * honeypot is passed on when filled (research R-8).
 */
export function guestBodyOf(form: FormData): { body: Record<string, unknown>; errors: string[]; slots: number[] } {
  const { body, errors, slots } = offPlatformBodyOf(form);
  const { orderId: _orderId, contact, ...rest } = body as { orderId?: unknown; contact: { name: string; email?: string; phone?: string } };
  const guestContact = { name: contact.name, ...(contact.phone ? { phone: contact.phone } : {}) };
  // 180 refuses `contact` for a missing name or e-mail; a guest types the name only.
  const guestErrors = errors.filter((e) => e !== 'contact');
  if (!guestContact.name) guestErrors.push('contact');
  const hp = form.get('hp');
  return {
    body: { ...rest, contact: guestContact, ...(typeof hp === 'string' && hp !== '' ? { hp } : {}) },
    errors: guestErrors,
    slots,
  };
}
