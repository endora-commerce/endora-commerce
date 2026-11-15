import type {
  CartMergeOutcomePublic,
  FederatedSignInExchangeRequest,
  FederatedSignInExchangeResponse,
  FederatedSignInOptionsResponse,
} from '@endora-commerce/contracts';
import type { FederatedProvider } from '../federated-sign-in';
import { rememberKnownDevice, signInCookieHeader } from '../session';
import { apiGet, type RequestContext } from './client';
import { apiMutate, extractSessionCookieValue } from './mutations';

/**
 * Which federated providers this storefront can complete a sign-in with —
 * issue #193.
 *
 * Sales-channel scoped: `mfa.storefront.{google,microsoft}_enabled` are
 * per-channel settings, and `apiGet` already stamps `X-Sales-Channel`, so the
 * answer is the one the OAuth `start` endpoint would apply to the same request.
 *
 * **Fails closed.** Every error — the module gated off with 503, an endpoint a
 * deployment has not rolled out yet, a network blip — answers "no providers".
 * That is the opposite of `getModulePresence`'s degrade-open, and deliberately
 * so: an unresolved catalogue means an empty shop, but an unresolved sign-in
 * provider means a button whose click lands the buyer back here with an error.
 * The password form is untouched either way, so the closed answer costs the
 * buyer nothing they cannot already do.
 */
export const FEDERATED_SIGN_IN_TAG = 'auth:federated-providers';

export async function getFederatedSignInProviders(
  ctx: RequestContext = {},
): Promise<readonly FederatedProvider[]> {
  try {
    const res = await apiGet<FederatedSignInOptionsResponse>(
      '/api/v1/auth/customer/oauth/providers',
      ctx,
      { revalidate: 300, tags: [FEDERATED_SIGN_IN_TAG] },
    );
    return res.providers;
  } catch {
    return [];
  }
}

/**
 * Issue #1279 — redeem the hand-off code the backend's OAuth callback sent the
 * browser here with (`POST /api/v1/auth/customer/oauth/exchange`).
 *
 * Server-to-server, so the browser's own storefront cookies travel only as this
 * call forwards them: the allow-list every customer sign-in forwards
 * (`signInCookieHeader` — the known-device cookie, the signed-out basket and
 * comparison), so the backend carries the basket over exactly as after a
 * password sign-in. The buyer's address and browser travel as
 * `x-forwarded-for` and `user-agent`, as the form handlers forward them, so the
 * session is recorded against the buyer rather than this server.
 *
 * Throws `StorefrontApiError` for any refusal (`400
 * MFA_FEDERATED_HANDOFF_INVALID`, `503 MODULE_DISABLED`) and whatever `fetch`
 * throws on a network failure; the caller decides what each means.
 */
export type FederatedSignInExchangeResult =
  | {
      status: 'authenticated';
      redirectPath: string;
      sessionCookieValue: string | null;
      cartMerge: CartMergeOutcomePublic | null;
    }
  | { status: 'mfaRequired'; redirectPath: string; challengeId: string };

export async function exchangeFederatedSignIn(
  input: FederatedSignInExchangeRequest,
  forwarded: { salesChannelCode?: string | undefined; forwardedFor?: string | null; userAgent?: string | null },
): Promise<FederatedSignInExchangeResult> {
  const headers: Record<string, string> = {};
  if (forwarded.forwardedFor) headers['x-forwarded-for'] = forwarded.forwardedFor;
  if (forwarded.userAgent) headers['user-agent'] = forwarded.userAgent;
  const result = await apiMutate<FederatedSignInExchangeResponse['data']>({
    method: 'POST',
    path: '/api/v1/auth/customer/oauth/exchange',
    body: input,
    rawCookieHeader: await signInCookieHeader(),
    headers,
    ...(forwarded.salesChannelCode ? { ctx: { salesChannelCode: forwarded.salesChannelCode } } : {}),
  });
  await rememberKnownDevice(result.setCookie);
  const data = result.data!;
  if (data.status === 'mfaRequired') {
    return { status: 'mfaRequired', redirectPath: data.redirectPath, challengeId: data.challengeId };
  }
  return {
    status: 'authenticated',
    redirectPath: data.redirectPath,
    sessionCookieValue: extractSessionCookieValue(result.setCookie),
    cartMerge: data.cartMerge ?? null,
  };
}
