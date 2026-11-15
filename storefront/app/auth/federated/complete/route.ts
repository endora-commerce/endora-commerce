/**
 * `GET /auth/federated/complete?code=` — issue #1279.
 *
 * Where the API's OAuth callback sends the browser back, on the storefront of
 * the channel the sign-in started on (`sales_channels.storefront_url`). The
 * callback set no cookie — on split hosts it would have landed on the API's
 * host — so this redeems the single-use code server-to-server with the
 * browser's binding secret and then does on this host what the password
 * sign-in's action does: the session cookie, the basket-merge notice and the
 * drained basket's cookie, or the second step's challenge cookie.
 *
 * The binding cookie is dropped whatever happens: it is single-use like the
 * code. A refused code reads as an expired sign-in, anything else (the module
 * switched off, the backend unreachable) as a failed one; both land on the
 * sign-in page, which words the code.
 */
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { StorefrontApiError } from '../../../../lib/api/client';
import { exchangeFederatedSignIn, type FederatedSignInExchangeResult } from '../../../../lib/api/federated-sign-in';
import { SALES_CHANNEL_REQUEST_HEADER } from '../../../../lib/channel/channel-header';
import {
  clearAnonCartCookie,
  setCartMergeFlash,
  setMfaChallengeCookie,
  setSessionCookie,
} from '../../../../lib/session';
import {
  FEDERATED_BINDING_COOKIE,
  FEDERATED_BINDING_COOKIE_PATH,
  privateRedirect,
  storefrontPathOrDefault,
} from '../../../../lib/auth/federated-sign-in-routes';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<Response> {
  const jar = await cookies();
  const binding = jar.get(FEDERATED_BINDING_COOKIE)?.value;
  jar.delete({ name: FEDERATED_BINDING_COOKIE, path: FEDERATED_BINDING_COOKIE_PATH });
  const code = request.nextUrl.searchParams.get('code');
  const signInPage = (error: 'sign_in_expired' | 'sign_in_failed') =>
    privateRedirect(new URL(`/login?error=${error}`, request.url));
  if (!binding || !code) return signInPage('sign_in_expired');

  let result: FederatedSignInExchangeResult;
  try {
    result = await exchangeFederatedSignIn(
      { code, binding },
      {
        salesChannelCode: request.headers.get(SALES_CHANNEL_REQUEST_HEADER) ?? undefined,
        forwardedFor: request.headers.get('x-forwarded-for'),
        userAgent: request.headers.get('user-agent'),
      },
    );
  } catch (err) {
    return signInPage(err instanceof StorefrontApiError && err.status === 400 ? 'sign_in_expired' : 'sign_in_failed');
  }

  if (result.status === 'mfaRequired') {
    await setMfaChallengeCookie(result.challengeId);
  } else {
    if (!result.sessionCookieValue) return signInPage('sign_in_failed');
    await setSessionCookie(result.sessionCookieValue);
    // Feature 037 — as after a password sign-in: an observable merge leaves the
    // one-render notice and drops the anonymous cookie of the drained basket.
    if (result.cartMerge?.outcome === 'adopted' || result.cartMerge?.outcome === 'merged') {
      await clearAnonCartCookie();
      await setCartMergeFlash(result.cartMerge.outcome);
    }
  }
  return privateRedirect(new URL(storefrontPathOrDefault(result.redirectPath), request.url));
}
