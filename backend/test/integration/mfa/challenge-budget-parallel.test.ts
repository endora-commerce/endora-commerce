import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';

/**
 * The second sign-in step checks no more codes per challenge than its budget of
 * five, however the requests arrive.
 *
 * The budget used to be read, the code checked, and the budget written back, so
 * thirty codes sent together were all checked against the same unspent budget.
 * Driven through the real route and the real Redis.
 */
const CUSTOMER_COOKIE = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';

function totpCode(secretBase32: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: Date.now() });
}

describe('customer second step — the attempt budget under parallel requests', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('checks at most five of thirty wrong codes sent at once, and burns the challenge', async () => {
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/setup',
      cookies: CUSTOMER_COOKIE,
    });
    const { secret } = setup.json().data as { secret: string };
    const activated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/account/mfa/activate',
      cookies: CUSTOMER_COOKIE,
      payload: { code: totpCode(secret) },
    });
    expect(activated.statusCode, activated.body).toBe(200);
    const recoveryCodes = activated.json().data.recoveryCodes as string[];

    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: CUSTOMER_EMAIL, password: STUB_CUSTOMER_PASSWORD },
    });
    expect(login.json().data.status).toBe('mfaRequired');
    const challengeId = login.json().data.challengeId as string;

    const verify = (code: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/customer/mfa/verify',
        payload: { challengeId, code },
      });
    const answers = await Promise.all(Array.from({ length: 30 }, () => verify('000000')));

    // A checked wrong code is 401 while attempts remain; the one that spends
    // the last attempt, and every one that found none left, is 429 or 400.
    const statuses = answers.map((answer) => answer.statusCode);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(4);
    expect(statuses.every((status) => [400, 401, 429].includes(status))).toBe(true);

    // The challenge is gone: a correct code no longer completes it.
    const late = await verify(recoveryCodes[0]!);
    expect(late.statusCode, late.body).toBe(400);
  });
});
