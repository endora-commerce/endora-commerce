import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

/**
 * The browser-binding cookie a federated sign-in's `start` set, as the cookie
 * jar the matching `callback` has to present. The callback refuses a request
 * without it, exactly as a browser that did not start the transaction is
 * refused.
 */
export function oauthBinding(start: LightMyRequestResponse): Record<string, string> {
  const cookie = start.cookies.find((c) => c.name === 'b2b_oauth_binding');
  if (!cookie) throw new Error(`start set no binding cookie (status ${start.statusCode})`);
  return { b2b_oauth_binding: cookie.value };
}

/**
 * Issue #1279 — the storefront's half of the browser binding: the secret its
 * `/auth/federated/start` keeps in the `b2b_federated_binding` cookie, and the
 * digest it hands the API's customer `start` as `?binding=`.
 */
export interface StorefrontBinding {
  readonly secret: string;
  readonly digest: string;
}

export function storefrontBinding(): StorefrontBinding {
  const secret = randomBytes(32).toString('base64url');
  return { secret, digest: createHash('sha256').update(secret).digest('hex') };
}

/**
 * The customer `start` URL as the storefront's start route builds it: the
 * provider, `next`, the sales channel when there is one, and the binding digest.
 */
export function customerOAuthStartUrl(
  binding: StorefrontBinding,
  options: { provider?: 'google' | 'microsoft'; next?: string; salesChannel?: string } = {},
): string {
  const query = new URLSearchParams();
  if (options.next) query.set('next', options.next);
  if (options.salesChannel) query.set('salesChannel', options.salesChannel);
  query.set('binding', binding.digest);
  return `/api/v1/auth/customer/oauth/${options.provider ?? 'google'}/start?${query.toString()}`;
}

/**
 * The hand-off code a successful customer callback sent the browser to the
 * storefront's `/auth/federated/complete` with. Throws for any other answer, so
 * a refusal reads as one.
 */
export function handoffCodeOf(callback: LightMyRequestResponse): string {
  const location = String(callback.headers['location'] ?? '');
  const url = location ? new URL(location) : null;
  const code = url?.pathname === '/auth/federated/complete' ? url.searchParams.get('code') : null;
  if (callback.statusCode !== 302 || !code) {
    throw new Error(`callback handed nothing off (status ${callback.statusCode}, location ${location || 'none'})`);
  }
  return code;
}

/**
 * The storefront's server-to-server redemption of the hand-off
 * (`POST /api/v1/auth/customer/oauth/exchange`), with the storefront host's
 * cookies and headers it forwards.
 */
export function exchangeHandoff(
  app: FastifyInstance,
  callback: LightMyRequestResponse,
  binding: StorefrontBinding,
  options: { headers?: Record<string, string>; cookies?: Record<string, string> } = {},
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/customer/oauth/exchange',
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    payload: { code: handoffCodeOf(callback), binding: binding.secret },
    ...(options.cookies ? { cookies: options.cookies } : {}),
  });
}

/** The `b2b_session` value an exchange set, or `undefined`. */
export function sessionOf(res: LightMyRequestResponse): string | undefined {
  return res.cookies.find((c) => c.name === 'b2b_session' && c.value !== '')?.value;
}
