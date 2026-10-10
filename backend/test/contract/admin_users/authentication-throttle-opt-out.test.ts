import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * `ADMIN_AUTH_ACCOUNT_WIDE_LIMIT=off` — an instance that publishes an
 * administrator's credentials on purpose (a public demo) can switch the
 * account-wide counter off, because with a published address anybody can keep
 * every first-time device out of that account.
 *
 * It switches off that one counter and nothing else. What the instance does
 * without the variable is `authentication-throttle.test.ts`, beside this file,
 * unchanged.
 */
const PASSWORD = 'a-correct-and-strong-pass-123!';
const WRONG_PASSWORD = 'not-the-right-password-456!';
const VARIABLE = 'ADMIN_AUTH_ACCOUNT_WIDE_LIMIT';

describe('administrator authentication throttle — account-wide limit switched off', () => {
  let h: BackendServerHandle;
  let before: string | undefined;

  beforeAll(async () => {
    before = process.env[VARIABLE];
    // Read once, when the module is composed.
    process.env[VARIABLE] = 'off';
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (before === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = before;
    await teardownBackendServer(h);
  });

  const login = (email: string, password: string, remoteAddress: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      remoteAddress,
      payload: { email, password },
    });

  it('does not refuse a first-time address after 100 wrong passwords from 20 others, and still stops each of those', async () => {
    const email = `opt-out-${process.pid}@example.com`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email,
        password: PASSWORD,
        firstName: 'Opt',
        lastName: 'Out',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(created.statusCode, created.body).toBe(201);

    const addresses = Array.from({ length: 20 }, (_, index) => `203.0.113.${index + 100}`);
    for (const address of addresses) {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const wrong = await login(email, WRONG_PASSWORD, address);
        expect(wrong.statusCode, wrong.body).toBe(401);
      }
    }

    // One address is still stopped after its own five, correct password or not.
    const sameAddress = await login(email, PASSWORD, addresses[0]!);
    expect(sameAddress.statusCode, sameAddress.body).toBe(429);
    // Its one-minute delay started with its fifth wrong password, some seconds ago.
    const retryAfter = Number(sameAddress.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    const firstTime = await login(email, PASSWORD, '198.51.100.99');
    expect(firstTime.statusCode, firstTime.body).toBe(200);
  });
});
