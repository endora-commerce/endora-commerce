import { cookies } from 'next/headers';

/**
 * Storefront session helpers (T150–T155).
 *
 * The storefront stores the `b2b_session` cookie issued by the backend
 * verbatim — it's an opaque session id, scoped to the storefront origin.
 * Server actions call `setSessionCookie` after a successful login and
 * `clearSessionCookie` after logout; pages call `getSessionCookie` to
 * check whether the caller is authenticated.
 */

const SESSION_COOKIE = 'b2b_session';
const ANON_CART_COOKIE = 'b2b_cart_anon';

/** Read the storefront `b2b_session` cookie, or null if anonymous. */
export async function getSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** Persist the session cookie issued by the backend. */
export async function setSessionCookie(value: string, expiresAt?: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    ...(expiresAt ? { expires: expiresAt } : {}),
  });
}

/** Clear the session cookie after logout / session loss. */
export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Read the anonymous cart cookie minted by `POST /cart/items` for guests. */
export async function getAnonCartCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(ANON_CART_COOKIE)?.value ?? null;
}

/** Persist the anon cart cookie returned by the backend on first add. */
export async function setAnonCartCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set(ANON_CART_COOKIE, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
  });
}
