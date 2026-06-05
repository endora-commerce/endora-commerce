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
const CART_MERGE_FLASH_COOKIE = 'b2b_cart_merge_flash';

/**
 * Feature 037-cart-merge-on-login — buyer-facing outcomes that warrant a
 * post-login confirmation toast. The internal `noop_*` variants and the
 * line-count diagnostics never travel through this cookie; only the
 * observable outcome does.
 */
export type CartMergeFlashOutcome = 'adopted' | 'merged';

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

/**
 * Delete the anon cart cookie. Called after a successful login-time cart merge:
 * the anonymous cart has been drained into the customer cart and marked
 * `completed` backend-side, so the cookie now points at an empty cart. Leaving
 * it set makes the storefront read that drained cart whenever the session is
 * not the active cart actor (e.g. after the session expires), which surfaces as
 * a cart that "disappeared". The backend already sends a clear-cookie header on
 * merge, but a Next.js server action must mirror it into the browser jar.
 */
export async function clearAnonCartCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(ANON_CART_COOKIE);
}

/**
 * Flash-cookie writer used by the login server action after a successful
 * cart-merge. The next authenticated page render reads-and-clears the
 * cookie via `readAndClearCartMergeFlash` and shows a confirmation
 * toast. Lifetime is 30 seconds — long enough to survive the redirect,
 * short enough that a dropped render does not leave the toast latent for
 * tomorrow's session.
 */
export async function setCartMergeFlash(outcome: CartMergeFlashOutcome): Promise<void> {
  const jar = await cookies();
  jar.set(CART_MERGE_FLASH_COOKIE, outcome, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: 30,
  });
}

/**
 * Read-and-clear the cart-merge flash cookie. Returns the outcome on the
 * single render that follows the login, then deletes the cookie so the
 * toast never appears twice.
 */
export async function readAndClearCartMergeFlash(): Promise<CartMergeFlashOutcome | null> {
  const jar = await cookies();
  const value = jar.get(CART_MERGE_FLASH_COOKIE)?.value ?? null;
  if (value === 'adopted' || value === 'merged') {
    jar.delete(CART_MERGE_FLASH_COOKIE);
    return value;
  }
  return null;
}
