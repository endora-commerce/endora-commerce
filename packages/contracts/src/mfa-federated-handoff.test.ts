import { describe, expect, it } from 'vitest';
import {
  FEDERATED_SIGN_IN_COMPLETE_PATH,
  FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS,
  customerFederatedSignInStartQuerySchema,
  federatedSignInExchangeRequestSchema,
  federatedSignInExchangeResponseSchema,
} from './mfa.js';
import { ERROR_CODES } from './errors.js';

/**
 * Issue #1279 — the federated sign-in hand-off: the callback on the API host
 * leaves a single-use code, and the storefront redeems it server-to-server.
 */
const CODE = 'A'.repeat(43);
const SECRET = 'b-'.repeat(21) + 'c';
const DIGEST = 'ab'.repeat(32);
const CART_ID = '4f0c8e8a-5b8e-4d4a-9a39-2f8d9d6f7a10';

describe('federated sign-in hand-off contracts (#1279)', () => {
  it('names the storefront landing route and a short lifetime', () => {
    expect(FEDERATED_SIGN_IN_COMPLETE_PATH).toBe('/auth/federated/complete');
    expect(FEDERATED_SIGN_IN_HANDOFF_TTL_SECONDS).toBe(60);
  });

  it('the customer start query requires the binding digest', () => {
    expect(customerFederatedSignInStartQuerySchema.safeParse({ binding: DIGEST }).success).toBe(true);
    expect(
      customerFederatedSignInStartQuerySchema.safeParse({ binding: DIGEST, next: '/account', salesChannel: 'trade' })
        .success,
    ).toBe(true);
    expect(customerFederatedSignInStartQuerySchema.safeParse({ next: '/account' }).success).toBe(false);
    expect(customerFederatedSignInStartQuerySchema.safeParse({ binding: DIGEST.toUpperCase() }).success).toBe(false);
    expect(customerFederatedSignInStartQuerySchema.safeParse({ binding: DIGEST.slice(1) }).success).toBe(false);
    expect(
      customerFederatedSignInStartQuerySchema.safeParse({ binding: DIGEST, next: `/${'a'.repeat(2048)}` }).success,
    ).toBe(false);
  });

  it('the exchange request takes exactly the code and the raw binding secret', () => {
    expect(federatedSignInExchangeRequestSchema.safeParse({ code: CODE, binding: SECRET }).success).toBe(true);
    expect(federatedSignInExchangeRequestSchema.safeParse({ code: CODE }).success).toBe(false);
    expect(federatedSignInExchangeRequestSchema.safeParse({ code: `${CODE}A`, binding: SECRET }).success).toBe(false);
    expect(federatedSignInExchangeRequestSchema.safeParse({ code: CODE, binding: 'x+y/'.repeat(11) }).success).toBe(
      false,
    );
    expect(
      federatedSignInExchangeRequestSchema.safeParse({ code: CODE, binding: SECRET, salesChannelId: 'x' }).success,
    ).toBe(false);
  });

  it('the exchange answers an authenticated sign-in or a pending second step', () => {
    expect(
      federatedSignInExchangeResponseSchema.safeParse({
        data: { status: 'authenticated', redirectPath: '/pl/account', cartMerge: null },
      }).success,
    ).toBe(true);
    expect(
      federatedSignInExchangeResponseSchema.safeParse({
        data: {
          status: 'authenticated',
          redirectPath: '/account',
          cartMerge: { outcome: 'merged', destinationCartId: CART_ID },
        },
      }).success,
    ).toBe(true);
    expect(
      federatedSignInExchangeResponseSchema.safeParse({
        data: { status: 'mfaRequired', challengeId: 'challenge-1', redirectPath: '/login/mfa?next=%2Faccount' },
      }).success,
    ).toBe(true);
    // `mfaSetupRequired` never reaches the exchange.
    expect(
      federatedSignInExchangeResponseSchema.safeParse({
        data: { status: 'mfaSetupRequired', setupTicket: 't', redirectPath: '/account' },
      }).success,
    ).toBe(false);
  });

  it.each(['https://evil.test/account', '//evil.test/account', 'account', ''])(
    'refuses a redirect path that is not root-relative (%s)',
    (redirectPath) => {
      expect(
        federatedSignInExchangeResponseSchema.safeParse({
          data: { status: 'authenticated', redirectPath, cartMerge: null },
        }).success,
      ).toBe(false);
    },
  );

  it('mints the one failure code of the exchange', () => {
    expect(ERROR_CODES.MFA_FEDERATED_HANDOFF_INVALID).toBe('MFA_FEDERATED_HANDOFF_INVALID');
  });
});
