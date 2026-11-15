import { NextResponse } from 'next/server';

/**
 * Issue #1279 — the two storefront route handlers that start and finish a
 * federated (Google / Microsoft) customer sign-in on the storefront's own host:
 * `app/auth/federated/start/route.ts` and `app/auth/federated/complete/route.ts`.
 *
 * They sit outside `/api` on purpose — they are browser navigations, not a
 * backend proxy — and outside the language prefix: `isDocumentPath` names them
 * as non-documents, so the middleware neither prefixes, gates nor redirects
 * them (a closed store must still let a buyer finish signing in).
 */

export { FEDERATED_SIGN_IN_START_PATH } from './federated-sign-in-start-path';

/**
 * The browser binding: a secret only this browser holds, whose SHA-256 the
 * backend keeps with the OAuth transaction. The hand-off the callback leaves is
 * redeemed only with the secret, so a code cannot be redeemed by another
 * browser (login CSRF) or from the history after the fact.
 */
export const FEDERATED_BINDING_COOKIE = 'b2b_federated_binding';
/** Scoped to the two routes, so no other request ever carries it. */
export const FEDERATED_BINDING_COOKIE_PATH = '/auth/federated';
/** Seconds; the backend's OAuth transaction lives as long. */
export const FEDERATED_BINDING_MAX_AGE_SECONDS = 600;

/** Where a sign-in goes when the path it was given is not one of this shop's. */
const DEFAULT_PATH = '/account';

/**
 * A root-relative path on this shop, or `/account`. Anything that could leave
 * it — an absolute URL, `//host`, `/\host`, a control character — falls back.
 */
export function storefrontPathOrDefault(path: string | null | undefined): string {
  if (!path || path.length > 2048 || !path.startsWith('/') || path.startsWith('//')) return DEFAULT_PATH;
  for (let index = 0; index < path.length; index += 1) {
    const code = path.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f || path[index] === '\\') return DEFAULT_PATH;
  }
  return path;
}

/**
 * A `303` that no cache keeps, that sends no `Referer` (the landing URL carries
 * the hand-off code) and that no crawler indexes.
 */
export function privateRedirect(location: string | URL): NextResponse {
  const response = NextResponse.redirect(location, 303);
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}
