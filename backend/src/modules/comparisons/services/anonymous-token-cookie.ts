import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Cookie helpers for the comparisons module's anonymous owner identity
 * (research.md R-2). The cookie holds a 22-char base64url token that
 * doubles as the row's `comparisons.anonymous_token` column. It is *not*
 * the share token — leaking the cookie should not leak shareable URLs.
 *
 * Flags:
 *   - `HttpOnly`           → JavaScript on the storefront cannot read the
 *                            token, mitigating XSS exfiltration.
 *   - `SameSite=Lax`       → cookie is sent on top-level navigation but
 *                            not on cross-site POSTs, mitigating CSRF.
 *   - `Path=/`             → applies platform-wide so server-rendered
 *                            pages and the API see the same cookie.
 *   - `Max-Age = 1 year`   → long-lived; spec FR-005 ties anonymous
 *                            ownership to "their browser session" but in
 *                            practice the cookie is what carries that
 *                            identity across visits.
 */
export const COMPARE_TOKEN_COOKIE = 'compare_token';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readAnonymousToken(request: FastifyRequest): string | null {
  const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
  return cookies?.[COMPARE_TOKEN_COOKIE] ?? null;
}

export function writeAnonymousToken(reply: FastifyReply, token: string): void {
  reply.setCookie(COMPARE_TOKEN_COOKIE, token, {
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    maxAge: ONE_YEAR_SECONDS,
  });
}
