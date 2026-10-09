import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  ADMIN_KNOWN_DEVICE_COOKIE_NAME,
  ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS,
  ADMIN_SESSION_COOKIE_NAME,
  ERROR_CODES,
  type ModuleCliCommandContext,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { cliCommands } from '@endora-commerce/mod-admin-users';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';

/**
 * Repeated wrong passwords and wrong second-factor codes for an administrator
 * account are throttled.
 *
 * The only limit in front of `POST /api/v1/auth/admin/login` was the global
 * per-address ceiling of 1000 requests a minute, so a password could be guessed
 * a thousand times a minute from one address. The second step had a budget of
 * five codes per challenge, and a new challenge — with a new budget — cost one
 * more password request.
 *
 * Every case drives the real routes. Time is moved by faking `Date` alone: the
 * throttle keeps its own timestamps and uses Redis expiry only to collect
 * abandoned keys, so no case sleeps.
 */

const PASSWORD = 'a-correct-and-strong-pass-123!';
const WRONG_PASSWORD = 'not-the-right-password-456!';
const THROTTLED = 'ADMIN_AUTHENTICATION_THROTTLED';
const STUB_ADMIN = { b2b_admin_session: 'stub-admin-session' };
const SEEDED_ADMIN_EMAIL = 'platform-admin@example.com';
const ATTACKER = '203.0.113.10';

interface ErrorBody {
  error: { code: string; message: string; details?: { retryAfterSeconds?: number } };
}

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

describe('administrator authentication throttle', () => {
  let h: BackendServerHandle;
  let sequence = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels('mfa.admin.totp_enabled', true, null, {
      actorAdminUserId: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await teardownBackendServer(h);
  });

  /** Move the clock the throttle reads, and nothing else. */
  function advance(seconds: number): void {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now + seconds * 1000);
  }

  async function createOperator(): Promise<{ id: string; email: string }> {
    sequence += 1;
    const email = `throttle-${sequence}-${process.pid}@example.com`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email,
        password: PASSWORD,
        firstName: 'Throttle',
        lastName: `Case ${sequence}`,
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    return { id: (created.json() as { data: { id: string } }).data.id, email };
  }

  const login = (
    email: string,
    password: string,
    remoteAddress = ATTACKER,
    knownDevice?: string,
  ) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      remoteAddress,
      ...(knownDevice === undefined
        ? {}
        : { cookies: { [ADMIN_KNOWN_DEVICE_COOKIE_NAME]: knownDevice } }),
      payload: { email, password },
    });

  type Reply = Awaited<ReturnType<typeof login>>;

  /** The known-device cookie a response set, as a browser would send it back. */
  function knownDeviceOf(res: Reply): string | undefined {
    const cookie = res.cookies.find((c) => c.name === ADMIN_KNOWN_DEVICE_COOKIE_NAME);
    return cookie === undefined ? undefined : decodeURIComponent(cookie.value);
  }

  /** Sign in once, correctly, and keep the cookie that leaves on the device. */
  async function signInOnce(email: string, remoteAddress: string): Promise<string> {
    const res = await login(email, PASSWORD, remoteAddress);
    expect(res.statusCode, res.body).toBe(200);
    const knownDevice = knownDeviceOf(res);
    if (knownDevice === undefined) throw new Error('the sign-in left no known-device cookie');
    return knownDevice;
  }

  /** Wrong passwords from four addresses until every one of them is refused. */
  async function exhaustFromManyAddresses(email: string): Promise<void> {
    for (const address of ['203.0.113.21', '203.0.113.22', '203.0.113.23', '203.0.113.24']) {
      for (let i = 0; i < 6; i += 1) {
        const res = await login(email, WRONG_PASSWORD, address);
        if (res.statusCode === 429) break;
        expect(res.statusCode, res.body).toBe(401);
      }
    }
  }

  async function failLogin(email: string, times: number, remoteAddress = ATTACKER): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      const res = await login(email, WRONG_PASSWORD, remoteAddress);
      expect(res.statusCode, `wrong password ${i + 1}: ${res.body}`).toBe(401);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.UNAUTHORIZED);
    }
  }

  async function throttleRows(objectId: string): Promise<AuditLogEntry[]> {
    return h.em().find(AuditLogEntry, {
      action: 'admin_user.authentication_throttled',
      objectId,
    });
  }

  it('refuses further attempts with 429 and Retry-After after five wrong passwords', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);

    const refused = await login(operator.email, WRONG_PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
    const body = refused.json() as ErrorBody;
    expect(body.error.code).toBe(THROTTLED);
    expect(refused.headers['retry-after']).toBe('60');
    expect(body.error.details?.retryAfterSeconds).toBe(60);
    // The sentence is the module bundle's, not the developer-facing default.
    expect(body.error.message).toMatch(/too many/i);
  });

  it('admits five of a burst sent at once, however many arrive together', async () => {
    // The attempt is taken before the password is looked at. Counting failures
    // afterwards would admit the whole burst: every request reads "not
    // throttled" before any of them has failed.
    const operator = await createOperator();
    const burst = await Promise.all(
      Array.from({ length: 30 }, () => login(operator.email, WRONG_PASSWORD)),
    );

    expect(burst.filter((res) => res.statusCode === 401)).toHaveLength(5);
    expect(burst.filter((res) => res.statusCode === 429)).toHaveLength(25);
  });

  it('answers in the language the sign-in screen asked for', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);

    const refused = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      remoteAddress: ATTACKER,
      headers: { 'accept-language': 'pl' },
      payload: { email: operator.email, password: PASSWORD },
    });
    expect(refused.statusCode, refused.body).toBe(429);
    expect((refused.json() as ErrorBody).error.message).toMatch(/zbyt wiele/i);
  });

  it('answers a correct password exactly like a wrong one while throttled', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);

    const wrong = await login(operator.email, WRONG_PASSWORD);
    const right = await login(operator.email, PASSWORD);

    expect(right.statusCode, right.body).toBe(429);
    expect(right.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();
    const strip = (res: typeof wrong): unknown => {
      const parsed = res.json() as { error: Record<string, unknown> };
      const { requestId: _requestId, ...rest } = parsed.error;
      return rest;
    };
    expect(strip(right)).toEqual(strip(wrong));
    expect(right.headers['retry-after']).toBe(wrong.headers['retry-after']);
  });

  it('throttles an address that does not belong to any account in the same way', async () => {
    const unknown = `nobody-${process.pid}-${Date.now()}@example.com`;
    await failLogin(unknown, 5);

    const refused = await login(unknown, WRONG_PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
    expect((refused.json() as ErrorBody).error.code).toBe(THROTTLED);
    expect(refused.headers['retry-after']).toBe('60');
  });

  it('treats a differently cased address as the same account', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 3);
    await failLogin(operator.email.toUpperCase(), 2);

    const refused = await login(operator.email, PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
  });

  it('lets the account sign in again once the delay has passed, and doubles the next delay', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(429);

    advance(59);
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(429);

    advance(2);
    // One more wrong password is admitted — and starts a delay twice as long.
    await failLogin(operator.email, 1);
    const refused = await login(operator.email, PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
    expect(refused.headers['retry-after']).toBe('120');

    advance(121);
    const signedIn = await login(operator.email, PASSWORD);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    expect(signedIn.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('never delays longer than fifteen minutes, and forgets the attempts after thirty', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);
    // 1, 2, 4 and 8 minutes, then the ceiling.
    for (const seconds of [60, 120, 240, 480]) {
      advance(seconds + 1);
      await failLogin(operator.email, 1);
    }
    const refused = await login(operator.email, PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
    expect(refused.headers['retry-after']).toBe('900');

    // Thirty minutes after the first wrong password the count starts again.
    advance(901);
    await failLogin(operator.email, 4);
    const signedIn = await login(operator.email, PASSWORD);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
  });

  it('starts counting again after a successful sign-in', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 4);
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(200);

    await failLogin(operator.email, 4);
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(200);
  });

  it('leaves another account alone when it is tried from the same address', async () => {
    const victim = await createOperator();
    const bystander = await createOperator();
    await failLogin(victim.email, 5);
    expect((await login(victim.email, PASSWORD)).statusCode).toBe(429);

    const signedIn = await login(bystander.email, PASSWORD);
    expect(signedIn.statusCode, signedIn.body).toBe(200);
  });

  it('does not let one address keep the administrator out from another address', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 5);
    // Everything the one address can do in half an hour: the five above and
    // one more after each delay.
    for (const seconds of [60, 120, 240, 480]) {
      advance(seconds + 1);
      await failLogin(operator.email, 1);
    }
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(429);

    const elsewhere = await login(operator.email, PASSWORD, '198.51.100.7');
    expect(elsewhere.statusCode, elsewhere.body).toBe(200);
  });

  it('throttles the account for every address after twenty wrong passwords from many addresses', async () => {
    const operator = await createOperator();
    for (const address of ['203.0.113.21', '203.0.113.22', '203.0.113.23', '203.0.113.24']) {
      await failLogin(operator.email, 5, address);
    }

    const refused = await login(operator.email, PASSWORD, '198.51.100.99');
    expect(refused.statusCode, refused.body).toBe(429);
    expect((refused.json() as ErrorBody).error.code).toBe(THROTTLED);
    expect(refused.headers['retry-after']).toBe('60');

    advance(61);
    const signedIn = await login(operator.email, PASSWORD, '198.51.100.99');
    expect(signedIn.statusCode, signedIn.body).toBe(200);
  });

  it('writes one audit row when the throttle starts, and none for the attempts it refuses', async () => {
    const operator = await createOperator();
    await failLogin(operator.email, 4);
    expect(await throttleRows(operator.id)).toHaveLength(0);

    await failLogin(operator.email, 1);
    const rows = await throttleRows(operator.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.objectType).toBe('admin_user');
    expect(rows[0]!.ipAddress).toBe(ATTACKER);
    expect(rows[0]!.stateAfter).toMatchObject({
      factor: 'password',
      scope: 'address',
      retryAfterSeconds: 60,
    });
    expect(JSON.stringify(rows[0]!.stateAfter)).not.toContain(WRONG_PASSWORD);

    for (let i = 0; i < 10; i += 1) {
      expect((await login(operator.email, WRONG_PASSWORD)).statusCode).toBe(429);
    }
    expect(await throttleRows(operator.id)).toHaveLength(1);
  });

  it('writes no audit row for an address that belongs to no account', async () => {
    const before = await h.em().count(AuditLogEntry, {
      action: 'admin_user.authentication_throttled',
    });
    const unknown = `no-such-operator-${process.pid}-${Date.now()}@example.com`;
    await failLogin(unknown, 5);
    expect((await login(unknown, WRONG_PASSWORD)).statusCode).toBe(429);

    const after = await h.em().count(AuditLogEntry, {
      action: 'admin_user.authentication_throttled',
    });
    expect(after).toBe(before);
  });

  describe('a device the account has signed in on', () => {
    it('leaves a signed, httpOnly cookie after a completed sign-in, and after nothing else', async () => {
      const operator = await createOperator();

      const wrong = await login(operator.email, WRONG_PASSWORD);
      expect(wrong.statusCode).toBe(401);
      expect(knownDeviceOf(wrong)).toBeUndefined();
      const unknown = await login(`nobody-${Date.now()}@example.com`, WRONG_PASSWORD);
      expect(knownDeviceOf(unknown)).toBeUndefined();

      const signedIn = await login(operator.email, PASSWORD);
      expect(signedIn.statusCode, signedIn.body).toBe(200);
      const cookie = signedIn.cookies.find((c) => c.name === ADMIN_KNOWN_DEVICE_COOKIE_NAME);
      expect(cookie).toMatchObject({
        httpOnly: true,
        path: '/',
        sameSite: 'Lax',
        maxAge: ADMIN_KNOWN_DEVICE_MAX_AGE_SECONDS,
      });
      // v1.<account id>.<device id>.<stamp>, then the signature.
      const parts = decodeURIComponent(cookie!.value).split('.');
      expect(parts).toHaveLength(5);
      expect(parts[1]).toBe(operator.id);

      await failLogin(operator.email, 5);
      const refused = await login(operator.email, PASSWORD);
      expect(refused.statusCode).toBe(429);
      expect(knownDeviceOf(refused)).toBeUndefined();
    });

    it('cannot be kept out by wrong passwords sent from elsewhere, for two hours on end', async () => {
      const operator = await createOperator();
      const knownDevice = await signInOnce(operator.email, '198.51.100.10');

      let strangerRefused = 0;
      let knownAdmitted = 0;
      for (let minute = 0; minute < 120; minute += 1) {
        // Somebody who knows only the e-mail address keeps the account-wide
        // counter full, from four addresses.
        await exhaustFromManyAddresses(operator.email);

        // A device the account was never used from is refused, correct
        // password and all: that is the cost the throttle has.
        const stranger = await login(operator.email, PASSWORD, '198.51.100.20');
        if (stranger.statusCode === 429) strangerRefused += 1;

        // The device that has signed in before is not — from a new address
        // each time, since it is the device that is known and not where it is.
        const known = await login(operator.email, PASSWORD, `198.51.100.${30 + (minute % 50)}`, knownDevice);
        if (known.statusCode === 200) knownAdmitted += 1;

        advance(60);
      }

      expect(knownAdmitted).toBe(120);
      // The exemption is what admitted it, not a gap in the attack.
      expect(strangerRefused).toBe(120);
    }, 600_000);

    it('has a budget of its own, which does not spend the account’s', async () => {
      const operator = await createOperator();
      const knownDevice = await signInOnce(operator.email, '198.51.100.10');

      for (let i = 0; i < 5; i += 1) {
        const res = await login(operator.email, WRONG_PASSWORD, `198.51.100.${40 + i}`, knownDevice);
        expect(res.statusCode, res.body).toBe(401);
      }
      // Five wrong passwords from five addresses: only the device ties them
      // together, and the device is refused wherever it goes next.
      const refused = await login(operator.email, PASSWORD, '198.51.100.99', knownDevice);
      expect(refused.statusCode, refused.body).toBe(429);
      expect(refused.headers['retry-after']).toBe('60');

      const rows = await throttleRows(operator.id);
      expect(rows.map((row) => row.stateAfter?.['scope'])).toEqual(['device']);

      // Nobody else is affected by it.
      const elsewhere = await login(operator.email, PASSWORD, '198.51.100.50');
      expect(elsewhere.statusCode, elsewhere.body).toBe(200);
    });

    it('is not known by a cookie nobody signed, by another account’s, or after a password reset', async () => {
      const operator = await createOperator();
      const other = await createOperator();
      const knownDevice = await signInOnce(operator.email, '198.51.100.10');
      const othersDevice = await signInOnce(other.email, '198.51.100.11');
      await exhaustFromManyAddresses(operator.email);

      // The control: the genuine cookie is admitted.
      expect((await login(operator.email, PASSWORD, '198.51.100.60', knownDevice)).statusCode).toBe(200);
      await exhaustFromManyAddresses(operator.email);

      const unsigned = knownDevice.slice(0, knownDevice.lastIndexOf('.'));
      const tampered = `${unsigned}.${'A'.repeat(43)}`;
      for (const [label, value] of [
        ['the payload without a signature', unsigned],
        ['a signature that does not verify', tampered],
        ['another account’s device', othersDevice],
      ] as const) {
        const res = await login(operator.email, PASSWORD, '198.51.100.61', value);
        expect(res.statusCode, `${label}: ${res.body}`).toBe(429);
      }

      // A peer resets the password: every device known until now is forgotten.
      const reset = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/admin-users/${operator.id}/password`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { password: 'a-new-and-different-pass-789!' },
      });
      expect(reset.statusCode, reset.body).toBe(200);
      const afterReset = await login(
        operator.email,
        'a-new-and-different-pass-789!',
        '198.51.100.62',
        knownDevice,
      );
      expect(afterReset.statusCode, afterReset.body).toBe(429);
    });
  });

  it('throttles the current password an administrator gives to change their own', async () => {
    const operator = await createOperator();
    const signedIn = await login(operator.email, PASSWORD, '198.51.100.80');
    const session = signedIn.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value;
    const changePassword = (currentPassword: string) =>
      h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me',
        remoteAddress: '198.51.100.81',
        cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
        payload: { firstName: 'Renamed', password: 'a-new-and-different-pass-789!', currentPassword },
      });

    for (let i = 0; i < 5; i += 1) {
      const res = await changePassword(WRONG_PASSWORD);
      expect(res.statusCode, res.body).toBe(403);
      expect((res.json() as ErrorBody).error.code).toBe(ERROR_CODES.CURRENT_PASSWORD_INVALID);
    }

    // The correct current password now, refused without being looked at.
    const refused = await changePassword(PASSWORD);
    expect(refused.statusCode, refused.body).toBe(429);
    expect((refused.json() as ErrorBody).error.code).toBe(THROTTLED);
    expect(refused.headers['retry-after']).toBe('60');

    // Unchecked means unchanged: the old password still signs in, the new one
    // does not, and the name sent with the request was not applied.
    expect((await login(operator.email, PASSWORD, '198.51.100.82')).statusCode).toBe(200);
    expect(
      (await login(operator.email, 'a-new-and-different-pass-789!', '198.51.100.83')).statusCode,
    ).toBe(401);
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: session },
    });
    expect(
      (me.json() as { data: { adminUser: { firstName: string } } }).data.adminUser.firstName,
    ).toBe('Throttle');

    // One budget for the password wherever it is asked for: the same address
    // is refused at sign-in too.
    expect((await login(operator.email, PASSWORD, '198.51.100.81')).statusCode).toBe(429);

    advance(61);
    const changed = await changePassword(PASSWORD);
    expect(changed.statusCode, changed.body).toBe(200);
  });

  it('forgets every known device when the administrator changes their own password', async () => {
    const operator = await createOperator();
    const signedIn = await login(operator.email, PASSWORD, '198.51.100.10');
    const session = signedIn.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value;
    const knownDevice = knownDeviceOf(signedIn)!;
    await exhaustFromManyAddresses(operator.email);

    // The change itself is made from the known device, so the account-wide
    // delay does not stand in its way.
    const changed = await h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me',
      remoteAddress: '198.51.100.64',
      cookies: {
        [ADMIN_SESSION_COOKIE_NAME]: session,
        [ADMIN_KNOWN_DEVICE_COOKIE_NAME]: knownDevice,
      },
      payload: { password: 'a-new-and-different-pass-789!', currentPassword: PASSWORD },
    });
    expect(changed.statusCode, changed.body).toBe(200);

    // The cookie was minted for the old password. With the new one in place it
    // names nothing, and the device meets the account-wide delay like any other.
    const after = await login(
      operator.email,
      'a-new-and-different-pass-789!',
      '198.51.100.65',
      knownDevice,
    );
    expect(after.statusCode, after.body).toBe(429);
  });

  it('forgets every known device when `admin_users create` is run again for the account', async () => {
    const operator = await createOperator();
    const knownDevice = await signInOnce(operator.email, '198.51.100.10');
    await exhaustFromManyAddresses(operator.email);
    // The control: before the command, the device is admitted.
    expect((await login(operator.email, PASSWORD, '198.51.100.66', knownDevice)).statusCode).toBe(200);

    // What the command does to an existing account, through the service it calls.
    const cradle = h.container.cradle as unknown as {
      adminUserService: {
        restoreFromCli(
          id: string,
          input: { password: string; firstName: string; lastName: string; adminRoleId: string },
        ): Promise<unknown>;
      };
    };
    await cradle.adminUserService.restoreFromCli(operator.id, {
      password: 'set-from-the-command-line-789!',
      firstName: 'Throttle',
      lastName: 'Restored',
      adminRoleId: PLATFORM_ADMIN_ROLE_ID,
    });

    const after = await login(
      operator.email,
      'set-from-the-command-line-789!',
      '198.51.100.67',
      knownDevice,
    );
    expect(after.statusCode, after.body).toBe(429);
  });

  it('gives a deactivated account’s device no exemption', async () => {
    const operator = await createOperator();
    const knownDevice = await signInOnce(operator.email, '198.51.100.10');
    await exhaustFromManyAddresses(operator.email);

    const deactivate = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${operator.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { status: 'inactive' },
    });
    expect(deactivate.statusCode, deactivate.body).toBe(200);

    // Exempt, the device would be held to its own untouched counter and the
    // attempt admitted — and then answered 401, since the account cannot sign
    // in. Not exempt, it meets the account-wide delay like anybody else.
    const res = await login(operator.email, PASSWORD, '198.51.100.63', knownDevice);
    expect(res.statusCode, res.body).toBe(429);
  });

  describe('addresses', () => {
    it('counts every host of one IPv6 /64 as one address', async () => {
      const operator = await createOperator();
      for (let host = 1; host <= 5; host += 1) {
        await failLogin(operator.email, 1, `2001:db8:aa:bb::${host}`);
      }

      const sameNetwork = await login(operator.email, PASSWORD, '2001:db8:aa:bb:1234:5678:9abc:def0');
      expect(sameNetwork.statusCode, sameNetwork.body).toBe(429);

      const nextNetwork = await login(operator.email, PASSWORD, '2001:db8:aa:bc::1');
      expect(nextNetwork.statusCode, nextNetwork.body).toBe(200);
    });

    it('counts an IPv4-mapped IPv6 address as the IPv4 address it carries', async () => {
      const operator = await createOperator();
      await failLogin(operator.email, 5, '::ffff:203.0.113.77');

      const refused = await login(operator.email, PASSWORD, '203.0.113.77');
      expect(refused.statusCode, refused.body).toBe(429);
    });
  });

  it('does not hold simultaneous correct sign-ins against the account', async () => {
    const operator = await createOperator();
    const burst = await Promise.all(
      Array.from({ length: 12 }, () => login(operator.email, PASSWORD)),
    );

    // At most five are verified at once. The rest are told to come back in a
    // second — not in a minute, because nothing failed.
    const admitted = burst.filter((res) => res.statusCode === 200);
    const deferred = burst.filter((res) => res.statusCode === 429);
    expect(admitted.length + deferred.length).toBe(12);
    expect(admitted.length).toBeGreaterThanOrEqual(5);
    for (const res of deferred) expect(res.headers['retry-after']).toBe('1');

    // Nothing is left counted: the next attempt is admitted at once, and the
    // account still has its whole budget.
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(200);
    await failLogin(operator.email, 4);
    expect((await login(operator.email, PASSWORD)).statusCode).toBe(200);
  });

  it('is cleared for one account by `admin_users unlock`', async () => {
    const operator = await createOperator();
    await exhaustFromManyAddresses(operator.email);
    expect((await login(operator.email, PASSWORD, '198.51.100.70')).statusCode).toBe(429);

    const out: string[] = [];
    const unlock = cliCommands.find((command) => command.name === 'unlock');
    const context: ModuleCliCommandContext<ModuleContext> = {
      ctx: { cradle: () => h.container.cradle } as unknown as ModuleContext,
      // As an operator would type it.
      argv: [`--email=${operator.email.toUpperCase()}`],
      out: (line) => out.push(line),
      err: (line) => out.push(line),
    };
    expect(await unlock!.run(context)).toBe(0);
    expect(out.join('\n')).toContain('Cleared the authentication throttle');

    const signedIn = await login(operator.email, PASSWORD, '198.51.100.70');
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const cleared = await h.em().find(AuditLogEntry, {
      action: 'admin_user.authentication_throttle_cleared',
      objectId: operator.id,
    });
    expect(cleared).toHaveLength(1);
  });

  describe('second factor', () => {
    let secret: string;
    let recoveryCodes: string[];

    const SECOND_FACTOR_ADDRESS = '203.0.113.50';

    const verify = (challengeId: string, code: string) =>
      h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/admin/mfa/verify',
        remoteAddress: SECOND_FACTOR_ADDRESS,
        payload: { challengeId, code },
      });

    async function challenge(): Promise<string> {
      const res = await login(SEEDED_ADMIN_EMAIL, STUB_CUSTOMER_PASSWORD, SECOND_FACTOR_ADDRESS);
      expect(res.statusCode, res.body).toBe(200);
      const data = (res.json() as { data: { status: string; challengeId: string } }).data;
      expect(data.status).toBe('mfaRequired');
      return data.challengeId;
    }

    beforeAll(async () => {
      const setup = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/account/mfa/setup',
        cookies: STUB_ADMIN,
      });
      expect(setup.statusCode, setup.body).toBe(200);
      secret = (setup.json() as { data: { secret: string } }).data.secret;
      const activate = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/account/mfa/activate',
        cookies: STUB_ADMIN,
        payload: { code: totpCode(secret) },
      });
      expect(activate.statusCode, activate.body).toBe(200);
      recoveryCodes = (activate.json() as { data: { recoveryCodes: string[] } }).data.recoveryCodes;
    });

    it('throttles code guessing across challenges, and a correct code with it', async () => {
      // Three wrong codes on one challenge, two on the next: neither challenge
      // runs out of its own budget of five, the account does.
      const first = await challenge();
      for (let i = 0; i < 3; i += 1) {
        const res = await verify(first, '000000');
        expect(res.statusCode, res.body).toBe(401);
      }
      const second = await challenge();
      for (let i = 0; i < 2; i += 1) {
        const res = await verify(second, '000000');
        expect(res.statusCode, res.body).toBe(401);
      }

      // A recovery code works once. If the code were looked at before the
      // attempt is taken, this refused request would spend it.
      const refused = await verify(second, recoveryCodes[0]!);
      expect(refused.statusCode, refused.body).toBe(429);
      expect((refused.json() as ErrorBody).error.code).toBe(THROTTLED);
      expect(refused.headers['retry-after']).toBe('60');
      expect(refused.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();

      // A fresh challenge does not buy a fresh budget.
      const third = await challenge();
      expect((await verify(third, recoveryCodes[0]!)).statusCode).toBe(429);
      expect(knownDeviceOf(refused)).toBeUndefined();

      const rows = await throttleRows(TEST_ADMIN_ID);
      expect(rows.filter((r) => r.stateAfter?.['factor'] === 'second_factor')).toHaveLength(1);

      // A refused attempt does not spend the challenge's own budget either.
      advance(61);
      const accepted = await verify(third, recoveryCodes[0]!);
      expect(accepted.statusCode, accepted.body).toBe(200);
      expect(accepted.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)?.value).toBeTruthy();
      // The sign-in is complete only here, so only here is the device remembered.
      expect(knownDeviceOf(accepted)).toBeDefined();
    });

    it('does not remember the device after the password alone', async () => {
      const res = await login(SEEDED_ADMIN_EMAIL, STUB_CUSTOMER_PASSWORD, SECOND_FACTOR_ADDRESS);
      expect((res.json() as { data: { status: string } }).data.status).toBe('mfaRequired');
      expect(knownDeviceOf(res)).toBeUndefined();
    });

    it('never sets the known-device cookie on a response that refuses', async () => {
      const address = '203.0.113.80';
      const verifyFrom = (challengeId: string, code: string) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/auth/admin/mfa/verify',
          remoteAddress: address,
          payload: { challengeId, code },
        });
      const freshChallenge = async (): Promise<string> => {
        const res = await login(SEEDED_ADMIN_EMAIL, STUB_CUSTOMER_PASSWORD, address);
        return (res.json() as { data: { challengeId: string } }).data.challengeId;
      };
      const operator = await createOperator();
      const refusals: Array<{ path: string; status: number; res: Reply }> = [];
      const refused = (path: string, status: number, res: Reply): void => {
        refusals.push({ path, status, res });
      };

      refused('wrong password', 401, await login(operator.email, WRONG_PASSWORD, address));
      refused(
        'address of no account',
        401,
        await login(`nobody-${Date.now()}@example.com`, WRONG_PASSWORD, address),
      );
      refused('challenge that does not exist', 400, await verifyFrom('no-such-challenge', '000000'));
      refused('wrong code', 401, await verifyFrom(await freshChallenge(), '000000'));

      // The counter store fails for exactly one command: the take.
      const outage = vi.spyOn(h.redis, 'eval').mockRejectedValueOnce(new Error('READONLY'));
      const unavailable = await login(operator.email, PASSWORD, address);
      outage.mockRestore();
      expect((unavailable.json() as ErrorBody).error.code).toBe('ADMIN_AUTHENTICATION_UNAVAILABLE');
      expect(unavailable.headers['retry-after']).toBe('5');
      refused('counter store unavailable', 503, unavailable);

      await failLogin(operator.email, 4, address);
      refused('throttled password, correct', 429, await login(operator.email, PASSWORD, address));

      // One wrong code is counted above; four more exhaust the address.
      const challengeId = await freshChallenge();
      for (let i = 0; i < 4; i += 1) await verifyFrom(challengeId, '000000');
      refused('throttled code, correct', 429, await verifyFrom(await freshChallenge(), totpCode(secret)));

      for (const { path, status, res } of refusals) {
        expect(res.statusCode, `${path}: ${res.body}`).toBe(status);
        const setCookie = [res.headers['set-cookie'] ?? []].flat().join('\n');
        expect(setCookie, path).not.toContain(ADMIN_KNOWN_DEVICE_COOKIE_NAME);
      }
      expect(refusals.map((entry) => entry.status).sort()).toEqual([400, 401, 401, 401, 429, 429, 503]);
    });

    it('throttles the code that regenerates the recovery codes', async () => {
      const regenerate = (code: string) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/account/mfa/recovery-codes/regenerate',
          cookies: STUB_ADMIN,
          remoteAddress: '203.0.113.70',
          payload: { code },
        });

      for (let i = 0; i < 5; i += 1) {
        const res = await regenerate('000000');
        expect(res.statusCode, res.body).toBe(401);
      }
      const refused = await regenerate(totpCode(secret));
      expect(refused.statusCode, refused.body).toBe(429);
      expect((refused.json() as ErrorBody).error.code).toBe(THROTTLED);

      // Refused, so the codes were not replaced: a fresh set would be ten.
      const status = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/account/mfa/status',
        cookies: STUB_ADMIN,
      });
      expect(
        (status.json() as { data: { recoveryCodesRemaining: number } }).data.recoveryCodesRemaining,
      ).toBe(9);
    });

    it('throttles the step-up confirmation that switches the second factor off', async () => {
      const disable = (payload: Record<string, string>) =>
        h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/account/mfa/disable',
          cookies: STUB_ADMIN,
          remoteAddress: '203.0.113.60',
          payload,
        });

      for (let i = 0; i < 5; i += 1) {
        const res = await disable({ password: WRONG_PASSWORD });
        expect(res.statusCode, res.body).toBe(401);
      }
      const byPassword = await disable({ password: STUB_CUSTOMER_PASSWORD });
      expect(byPassword.statusCode, byPassword.body).toBe(429);
      expect((byPassword.json() as ErrorBody).error.code).toBe(THROTTLED);

      for (let i = 0; i < 5; i += 1) {
        const res = await disable({ code: '000000' });
        expect(res.statusCode, res.body).toBe(401);
      }
      const byCode = await disable({ code: totpCode(secret) });
      expect(byCode.statusCode, byCode.body).toBe(429);
      expect((byCode.json() as ErrorBody).error.code).toBe(THROTTLED);

      const status = await h.app.inject({
        method: 'GET',
        url: '/api/v1/admin/account/mfa/status',
        cookies: STUB_ADMIN,
      });
      expect((status.json() as { data: { totpActive: boolean } }).data.totpActive).toBe(true);
    });
  });
});
