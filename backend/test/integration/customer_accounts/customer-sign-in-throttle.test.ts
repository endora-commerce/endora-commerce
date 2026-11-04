import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_KNOWN_DEVICE_COOKIE_NAME,
  CUSTOMER_KNOWN_DEVICE_MAX_AGE_SECONDS,
  type CustomerAccountMemberWritePort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PasswordResetToken } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';

/**
 * Repeated wrong customer passwords and repeated password-reset requests are
 * throttled per account, and a device the account has signed in on keeps its
 * own budget.
 *
 * There is no address counter: the storefront signs shoppers in from its own
 * server, so every attempt arrives from one address. Every case therefore
 * sends its attempts from the same address, which is what production sees.
 * Time is moved by faking `Date` alone — the throttle keeps its own timestamps
 * — so no case sleeps.
 */

const PASSWORD = 'customer-correct-pass-123!';
const WRONG = 'customer-wrong-pass-456!';
const THROTTLED = 'CUSTOMER_AUTHENTICATION_THROTTLED';
const STOREFRONT = '10.0.0.5';
/** The customer password budget of a device the account has never been used on. */
const ACCOUNT_THRESHOLD = 50;
/** The budget of a known device. */
const DEVICE_THRESHOLD = 10;
const RESET_THRESHOLD = 5;

interface ErrorBody {
  error: { code: string; details?: { retryAfterSeconds?: number } };
}

describe('customer authentication throttle', () => {
  let h: BackendServerHandle;
  let sequence = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await teardownBackendServer(h);
  });

  function advance(seconds: number): void {
    const now = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now + seconds * 1000);
  }

  async function createBuyer(): Promise<{ id: string; email: string }> {
    sequence += 1;
    const email = `throttle-buyer-${sequence}-${process.pid}@example.test`;
    const members = (
      h.container.cradle as unknown as {
        customerAccountMemberWritePort: CustomerAccountMemberWritePort;
      }
    ).customerAccountMemberWritePort;
    const created = await members.create({
      organizationId: TEST_ORGANIZATION_ID,
      email,
      password: PASSWORD,
      firstName: 'Throttle',
      lastName: `Buyer ${sequence}`,
      organizationRoleId: await predefinedRoleIdOf(h.em(), TEST_ORGANIZATION_ID, 'member'),
    });
    await h.em().flush();
    return { id: created.id, email };
  }

  const login = (email: string, password: string, knownDevice?: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      remoteAddress: STOREFRONT,
      ...(knownDevice === undefined
        ? {}
        : { cookies: { [CUSTOMER_KNOWN_DEVICE_COOKIE_NAME]: knownDevice } }),
      payload: { email, password },
    });

  const requestReset = (email: string) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      remoteAddress: STOREFRONT,
      payload: { email },
    });

  type Reply = Awaited<ReturnType<typeof login>>;

  function knownDeviceOf(res: Reply): string | undefined {
    const cookie = res.cookies.find((c) => c.name === CUSTOMER_KNOWN_DEVICE_COOKIE_NAME);
    return cookie === undefined ? undefined : decodeURIComponent(cookie.value);
  }

  function expectThrottled(res: Reply): void {
    expect(res.statusCode, res.body).toBe(429);
    const body = res.json() as ErrorBody;
    expect(body.error.code).toBe(THROTTLED);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(body.error.details?.retryAfterSeconds).toBe(Number(res.headers['retry-after']));
  }

  async function failTimes(email: string, times: number, knownDevice?: string): Promise<void> {
    for (let i = 0; i < times; i += 1) {
      const res = await login(email, WRONG, knownDevice);
      expect(res.statusCode, `attempt ${i + 1}: ${res.body}`).toBe(401);
    }
  }

  it('leaves a signed known-device cookie on a completed sign-in', async () => {
    const buyer = await createBuyer();
    const res = await login(buyer.email, PASSWORD);
    expect(res.statusCode, res.body).toBe(200);
    const cookie = res.cookies.find((c) => c.name === CUSTOMER_KNOWN_DEVICE_COOKIE_NAME);
    expect(cookie).toMatchObject({
      httpOnly: true,
      path: '/',
      maxAge: CUSTOMER_KNOWN_DEVICE_MAX_AGE_SECONDS,
    });
    // Signed: the value carries the server's signature after the payload.
    expect(knownDeviceOf(res)!.startsWith(`v1.${buyer.id}.`)).toBe(true);
  });

  it('refuses repeated wrong passwords with 429 — and a correct one too while the delay runs', async () => {
    const buyer = await createBuyer();
    await failTimes(buyer.email, ACCOUNT_THRESHOLD);

    expectThrottled(await login(buyer.email, WRONG));
    expectThrottled(await login(buyer.email, PASSWORD));

    const audit = await h.em().find(AuditLogEntry, {
      action: 'customer_account.authentication_throttled',
      objectId: buyer.id,
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.stateAfter).toMatchObject({ factor: 'password', scope: 'account' });

    // The delay ends; the correct password is admitted and forgets the failures.
    advance(61);
    const admitted = await login(buyer.email, PASSWORD);
    expect(admitted.statusCode, admitted.body).toBe(200);
  });

  it('throttles an address that belongs to nobody exactly like a real one', async () => {
    const nobody = `nobody-${process.pid}-${Date.now()}@example.test`;
    await failTimes(nobody, ACCOUNT_THRESHOLD);
    expectThrottled(await login(nobody, WRONG));
  });

  it('keeps a known device out of the account counter a stranger filled', async () => {
    const buyer = await createBuyer();
    const knownDevice = knownDeviceOf(await login(buyer.email, PASSWORD))!;
    expect(knownDevice).toBeDefined();

    await failTimes(buyer.email, ACCOUNT_THRESHOLD);
    expectThrottled(await login(buyer.email, PASSWORD));

    const own = await login(buyer.email, PASSWORD, knownDevice);
    expect(own.statusCode, own.body).toBe(200);
  });

  it('holds a known device to its own, smaller budget', async () => {
    const buyer = await createBuyer();
    const knownDevice = knownDeviceOf(await login(buyer.email, PASSWORD))!;

    await failTimes(buyer.email, DEVICE_THRESHOLD, knownDevice);
    expectThrottled(await login(buyer.email, PASSWORD, knownDevice));
    // Nobody else was counted: a first-time device still gets in.
    expect((await login(buyer.email, PASSWORD)).statusCode).toBe(200);
  });

  it('does not honour a cookie whose signature does not verify', async () => {
    const buyer = await createBuyer();
    const knownDevice = knownDeviceOf(await login(buyer.email, PASSWORD))!;
    const altered = `${knownDevice.slice(0, knownDevice.lastIndexOf('.'))}.not-the-signature`;

    await failTimes(buyer.email, ACCOUNT_THRESHOLD);
    expectThrottled(await login(buyer.email, PASSWORD, altered));
  });

  it('limits reset requests per address, and only the newest link stays usable', async () => {
    const buyer = await createBuyer();
    for (let i = 0; i < RESET_THRESHOLD; i += 1) {
      const res = await requestReset(buyer.email.toUpperCase());
      expect(res.statusCode, `request ${i + 1}: ${res.body}`).toBe(202);
    }
    expectThrottled(await requestReset(buyer.email));

    const outstanding = await h
      .em()
      .count(PasswordResetToken, { customerAccountId: buyer.id, consumedAt: null });
    expect(outstanding).toBe(1);
    expect(
      await h.em().count(PasswordResetToken, { customerAccountId: buyer.id }),
    ).toBe(RESET_THRESHOLD);
  });

  it('limits reset requests for an address that belongs to nobody the same way', async () => {
    const nobody = `reset-nobody-${process.pid}-${Date.now()}@example.test`;
    for (let i = 0; i < RESET_THRESHOLD; i += 1) {
      expect((await requestReset(nobody)).statusCode).toBe(202);
    }
    expectThrottled(await requestReset(nobody));
  });
});
