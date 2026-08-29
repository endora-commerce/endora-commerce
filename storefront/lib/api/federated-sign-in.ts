import type { FederatedSignInOptionsResponse } from '@endora-commerce/contracts';
import type { FederatedProvider } from '../federated-sign-in';
import { apiGet, type RequestContext } from './client';

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
