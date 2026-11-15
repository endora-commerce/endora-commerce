/**
 * `GET /auth/federated/start?provider=&next=` — issue #1279.
 *
 * The federated sign-in buttons link here, on the storefront's own host, rather
 * than to the API's OAuth `start`, which may be on another host. This binds the
 * attempt to the browser — a fresh 32-byte secret in the `b2b_federated_binding`
 * cookie, scoped to `/auth/federated` — and sends the browser on to the API's
 * `start` with the SHA-256 of that secret and the resolved sales channel. The
 * API's callback comes back to `/auth/federated/complete`, which can redeem the
 * sign-in only with the same secret.
 *
 * The sales channel is the one the middleware stamped on this request (or a
 * proxy did): a browser navigation to the API carries no `X-Sales-Channel`, so
 * it rides as `?salesChannel=`, which the API resolves the channel from.
 */
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { mfaSocialProviderSchema } from '@endora-commerce/contracts';
import { SALES_CHANNEL_REQUEST_HEADER } from '../../../../lib/channel/channel-header';
import { publicApiBaseUrl } from '../../../../lib/env.mjs';
import {
  FEDERATED_BINDING_COOKIE,
  FEDERATED_BINDING_COOKIE_PATH,
  FEDERATED_BINDING_MAX_AGE_SECONDS,
  privateRedirect,
  storefrontPathOrDefault,
} from '../../../../lib/auth/federated-sign-in-routes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const provider = mfaSocialProviderSchema.safeParse(request.nextUrl.searchParams.get('provider'));
  if (!provider.success) {
    return privateRedirect(new URL('/login?error=unknown_provider', request.url));
  }

  const secret = randomBytes(32).toString('base64url');
  const jar = await cookies();
  jar.set(FEDERATED_BINDING_COOKIE, secret, {
    path: FEDERATED_BINDING_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    maxAge: FEDERATED_BINDING_MAX_AGE_SECONDS,
  });

  const query = new URLSearchParams({ next: storefrontPathOrDefault(request.nextUrl.searchParams.get('next')) });
  const salesChannel = request.headers.get(SALES_CHANNEL_REQUEST_HEADER);
  if (salesChannel) query.set('salesChannel', salesChannel);
  query.set('binding', createHash('sha256').update(secret).digest('hex'));
  return privateRedirect(
    `${publicApiBaseUrl()}/api/v1/auth/customer/oauth/${provider.data}/start?${query.toString()}`,
  );
}
