import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  SESSION_COOKIE_NAME,
  type CustomerAccountMemberWritePort,
  type CustomerPasswordResetPort,
} from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PasswordResetToken, Session } from '../../helpers/package-entities.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * A customer's password change withdraws what the old password had been
 * exchanged for.
 *
 * Blocking and deleting a customer already ended their sessions; changing the
 * password and redeeming a reset token ended none, so a session somebody else
 * held kept answering after the holder changed the password to be rid of it.
 * A change keeps the session it was made from and ends the others; a reset has
 * no session of its own and ends them all. Both also retire the reset tokens
 * still outstanding for the account and the logins it had begun.
 */

const EMAIL = 'pw-change-sessions@example.test';
const PASSWORDS = [
  'customer-first-pass-123!',
  'customer-second-pass-456!',
  'customer-third-pass-789!',
  'customer-fourth-pass-012!',
  'customer-fifth-pass-345!',
  'customer-sixth-pass-678!',
];

function totpCode(secretBase32: string, offsetMs = 0): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secretBase32),
  }).generate({ timestamp: Date.now() + offsetMs });
}

describe('customer password change and reset — sessions, reset tokens, pending logins', () => {
  let h: BackendServerHandle;
  let customerId: string;
  /** Index of the password the account holds right now; cases rotate it. */
  let current = 0;

  const passwordReset = (): CustomerPasswordResetPort =>
    (h.container.cradle as unknown as { passwordResetService: CustomerPasswordResetPort })
      .passwordResetService;

  async function login() {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/customer/login',
      payload: { email: EMAIL, password: PASSWORDS[current] },
    });
    expect(res.statusCode).toBe(200);
    const cookie = (res.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === SESSION_COOKIE_NAME,
    );
    return { data: (res.json() as { data: Record<string, string> }).data, cookie: cookie?.value };
  }

  async function post(url: string, payload: Record<string, unknown>, cookie?: string) {
    return h.app.inject({
      method: 'POST',
      url,
      payload,
      ...(cookie ? { cookies: { [SESSION_COOKIE_NAME]: cookie } } : {}),
    });
  }

  async function meStatus(cookie: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/me/customer',
      cookies: { [SESSION_COOKIE_NAME]: cookie },
    });
    return res.statusCode;
  }

  async function resetToken(): Promise<string> {
    const { rawToken } = await passwordReset().requestReset(EMAIL);
    expect(rawToken).toBeTruthy();
    return rawToken!;
  }

  async function changeThrough(url: string, cookie: string) {
    const res = await post(
      url,
      { currentPassword: PASSWORDS[current], newPassword: PASSWORDS[current + 1] },
      cookie,
    );
    if (res.statusCode < 300) current += 1;
    return res;
  }

  async function confirmReset(token: string) {
    const res = await post('/api/v1/auth/password-reset/confirm', {
      token,
      newPassword: PASSWORDS[current + 1],
    });
    if (res.statusCode < 300) current += 1;
    return res;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const members = (
      h.container.cradle as unknown as {
        customerAccountMemberWritePort: CustomerAccountMemberWritePort;
      }
    ).customerAccountMemberWritePort;
    const created = await members.create({
      organizationId: TEST_ORGANIZATION_ID,
      email: EMAIL,
      password: PASSWORDS[0]!,
      firstName: 'Change',
      lastName: 'Sessions',
      role: 'regular_user',
    });
    await h.em().flush();
    customerId = created.id;
  });

  afterAll(async () => {
    await h.settings.adminService.setValueForAllChannels('mfa.storefront.totp_enabled', false, null, {
      actorAdminUserId: null,
    });
    await teardownBackendServer(h);
  });

  for (const url of ['/api/v1/me/customer/change-password', '/api/v1/me/password']) {
    it(`${url} ends the other sessions, keeps the calling one, retires reset tokens`, async () => {
      const calling = (await login()).cookie!;
      const other = (await login()).cookie!;
      const outstanding = await resetToken();
      expect(await meStatus(other)).toBe(200);

      const changed = await changeThrough(url, calling);
      expect(changed.statusCode).toBe(204);

      expect(await meStatus(calling)).toBe(200);
      expect(await meStatus(other)).toBe(401);
      expect(await h.em().count(Session, { customerAccountId: customerId })).toBe(1);
      // A token requested before the change no longer sets a password.
      const stale = await confirmReset(outstanding);
      expect(stale.statusCode).toBe(400);

      // A wrong current password withdraws nothing.
      const second = (await login()).cookie!;
      const refused = await post(
        url,
        { currentPassword: 'not-the-current-password', newPassword: PASSWORDS[5] },
        calling,
      );
      expect(refused.statusCode).toBe(401);
      expect(await meStatus(second)).toBe(200);
      await h.em().nativeDelete(Session, { customerAccountId: customerId });
    });
  }

  it('a redeemed reset token ends every session and retires the other tokens', async () => {
    const first = (await login()).cookie!;
    const second = (await login()).cookie!;
    const redeemed = await resetToken();
    const outstanding = await resetToken();

    const confirmed = await confirmReset(redeemed);
    expect(confirmed.statusCode).toBe(200);

    expect(await meStatus(first)).toBe(401);
    expect(await meStatus(second)).toBe(401);
    expect(await h.em().count(Session, { customerAccountId: customerId })).toBe(0);
    expect((await confirmReset(outstanding)).statusCode).toBe(400);
    expect(
      await h.em().count(PasswordResetToken, { customerAccountId: customerId, consumedAt: null }),
    ).toBe(0);
    // The new password signs in.
    expect((await login()).cookie).toBeTruthy();
  });

  it('a login begun before the change or the reset cannot be completed after it', async () => {
    await h.settings.adminService.setValueForAllChannels('mfa.storefront.totp_enabled', true, null, {
      actorAdminUserId: null,
    });
    const calling = (await login()).cookie!;
    const setup = await post('/api/v1/account/mfa/setup', {}, calling);
    expect(setup.statusCode).toBe(200);
    const { secret } = (setup.json() as { data: { secret: string } }).data;
    const activate = await post('/api/v1/account/mfa/activate', { code: totpCode(secret) }, calling);
    expect(activate.statusCode).toBe(200);

    const beforeChange = await login();
    expect(beforeChange.data['status']).toBe('mfaRequired');
    expect((await changeThrough('/api/v1/me/customer/change-password', calling)).statusCode).toBe(204);
    // The second factor is right; the challenge is what is gone.
    const afterChange = await post('/api/v1/auth/customer/mfa/verify', {
      challengeId: beforeChange.data['challengeId'],
      code: totpCode(secret, 30_000),
    });
    expect(afterChange.statusCode).toBe(400);
    expect((afterChange.json() as { error: { code: string } }).error.code).toBe(
      'MFA_INVALID_CHALLENGE',
    );

    const beforeReset = await login();
    expect(beforeReset.data['status']).toBe('mfaRequired');
    expect((await confirmReset(await resetToken())).statusCode).toBe(200);
    const afterReset = await post('/api/v1/auth/customer/mfa/verify', {
      challengeId: beforeReset.data['challengeId'],
      code: totpCode(secret, 60_000),
    });
    expect(afterReset.statusCode).toBe(400);
    expect((afterReset.json() as { error: { code: string } }).error.code).toBe(
      'MFA_INVALID_CHALLENGE',
    );
  });

  it('the audit rows carry neither password nor hash', async () => {
    const rows = await h.em().find(AuditLogEntry, {
      objectId: customerId,
      action: { $in: ['customer_account.change_password', 'customer_account.password_reset'] },
    });
    expect(rows.map((row) => row.action).sort()).toEqual([
      'customer_account.change_password',
      'customer_account.change_password',
      'customer_account.change_password',
      'customer_account.password_reset',
      'customer_account.password_reset',
    ]);
    const dump = JSON.stringify(rows);
    for (const password of PASSWORDS) expect(dump).not.toContain(password);
    expect(dump).not.toContain('argon2');
  });
});
