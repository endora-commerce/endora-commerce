import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID, READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * Issue #349, E-349-1 (owner ruling 2026-11-08) — switching
 * `mfa.admin.totp_enforced` on ends the sessions of every administrator who
 * has no enrolled second factor, as ticking a role's box does for its holders
 * (`admin_users/role-two-factor-sessions.test.ts`). An administrator session
 * lasts thirty days, so "at the next sign-in" could otherwise mean a month.
 *
 * Enrolled administrators keep theirs. The acting administrator keeps the
 * session the change was made from, and loses their others. The write is
 * `settings`'; `mfa` hears of it through `settings.value_changed`, after the
 * commit, so the sign-out is awaited here rather than read off the response.
 * Before the save, the Settings read says how many will be signed out.
 *
 * The keyless counterpart — nothing is enforced, so nobody is signed out — is
 * in `keyless-admin-enforcement.test.ts`.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const ENFORCED = 'mfa.admin.totp_enforced';
const PASSWORD = 'setting-sessions-strong-pass-1!';

function totpCode(secret: string): string {
  return new TOTP({
    issuer: 'B2B Platform',
    label: 'verify',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

describe('mfa.admin.totp_enforced switched on — existing sessions', () => {
  let h: BackendServerHandle;

  const createAdmin = async (email: string, adminRoleId: string): Promise<void> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: { email, password: PASSWORD, firstName: 'Set', lastName: 'Ting', adminRoleId },
    });
    expect(res.statusCode).toBe(201);
  };

  const signIn = async (email: string): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password: PASSWORD },
    });
    expect(res.json().data.status).toBe('authenticated');
    return res.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value;
  };

  const cookieOf = (value: string) => ({ [ADMIN_SESSION_COOKIE_NAME]: value });

  const meStatus = async (cookie: string): Promise<number> =>
    (await h.app.inject({ method: 'GET', url: '/api/v1/admin/me', cookies: cookieOf(cookie) }))
      .statusCode;

  const enrol = async (cookie: string): Promise<void> => {
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/setup',
      cookies: cookieOf(cookie),
    });
    expect(setup.statusCode).toBe(200);
    const { secret } = setup.json().data as { secret: string };
    const activate = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/account/mfa/activate',
      cookies: cookieOf(cookie),
      payload: { code: totpCode(secret) },
    });
    expect(activate.statusCode).toBe(200);
  };

  const putEnforced = (value: boolean, cookies: Record<string, string>) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/settings/${ENFORCED}/value`,
      cookies,
      payload: { scope: 'all', value },
    });

  beforeAll(async () => {
    h = await setupBackendServer();
    // Lets an administrator enrol voluntarily before any requirement exists.
    await h.settings.adminService.setValueForAllChannels('mfa.admin.totp_enabled', true, null, {
      actorAdminUserId: null,
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('previews, then signs out exactly the unenrolled, sparing the acting session', async () => {
    await createAdmin('setting-actor@example.com', PLATFORM_ADMIN_ROLE_ID);
    await createAdmin('setting-unenrolled@example.com', READ_ONLY_ROLE_ID);
    await createAdmin('setting-enrolled@example.com', READ_ONLY_ROLE_ID);
    const current = await signIn('setting-actor@example.com');
    const elsewhere = await signIn('setting-actor@example.com');
    const unenrolled = await signIn('setting-unenrolled@example.com');
    const enrolled = await signIn('setting-enrolled@example.com');
    await enrol(enrolled);

    // The read the Settings screen asks before it saves. Every live
    // administrator without a factor counts, the test harness's own included,
    // so the number is read rather than assumed — and it is not zero.
    const detail = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/settings/${ENFORCED}`,
      cookies: cookieOf(current),
    });
    expect(detail.statusCode).toBe(200);
    const confirmation = (
      detail.json() as {
        confirmation?: { whenValue: unknown; code: string; params?: { count?: number } };
      }
    ).confirmation;
    expect(confirmation).toMatchObject({ whenValue: true, code: 'signs_out_unprotected' });
    expect(confirmation?.params?.count).toBeGreaterThanOrEqual(2);

    const res = await putEnforced(true, cookieOf(current));
    expect(res.statusCode).toBe(200);

    await vi.waitFor(async () => expect(await meStatus(unenrolled)).toBe(401), { timeout: 5000 });
    await vi.waitFor(async () => expect(await meStatus(elsewhere)).toBe(401), { timeout: 5000 });
    expect(await meStatus(current)).toBe(200);
    expect(await meStatus(enrolled)).toBe(200);

    // Already on: the read asks nothing more.
    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/settings/${ENFORCED}`,
      cookies: cookieOf(current),
    });
    expect(after.json()).not.toHaveProperty('confirmation');

    // The sign-out is audited by `mfa`, against the setting.
    const auditRows = async () =>
      (await h
        .em()
        .getConnection()
        .execute(
          `select "object_type", "object_id", "state_after" from "audit_log_entries"
            where "action" = 'mfa.admin_sessions_ended_for_requirement' and "object_id" = ?`,
          [ENFORCED],
        )) as Array<{ object_type: string; state_after: Record<string, unknown> }>;
    await vi.waitFor(async () => expect(await auditRows()).toHaveLength(1), { timeout: 5000 });
    expect((await auditRows())[0]).toMatchObject({
      object_type: 'setting',
      state_after: { trigger: 'setting_enabled', settingCode: ENFORCED },
    });

    expect((await putEnforced(false, cookieOf(current))).statusCode).toBe(200);
  });

  it('keeps the acting session id out of the setting write\'s audit rows', async () => {
    await createAdmin('setting-audited@example.com', PLATFORM_ADMIN_ROLE_ID);
    const cookie = await signIn('setting-audited@example.com');
    const sessionId = cookie.slice(0, cookie.indexOf('.'));
    expect((await putEnforced(false, cookieOf(cookie))).statusCode).toBe(200);
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select "state_before", "state_after" from "audit_log_entries"
          where "action" like 'setting.%'`,
      )) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const audited = JSON.stringify(rows);
    expect(audited).not.toContain('actorSessionId');
    expect(audited).not.toContain(sessionId);
  });

  it('spares nobody when the write has no session behind it, as a seed has none', async () => {
    await createAdmin('setting-seeded@example.com', READ_ONLY_ROLE_ID);
    const cookie = await signIn('setting-seeded@example.com');
    // What a boot reconciler or a seed does: the service, with no actor at all.
    await h.settings.adminService.setValueForAllChannels(ENFORCED, true, null, {
      actorAdminUserId: null,
    });
    await vi.waitFor(async () => expect(await meStatus(cookie)).toBe(401), { timeout: 5000 });
    await h.settings.adminService.setValueForAllChannels(ENFORCED, false, null, {
      actorAdminUserId: null,
    });
  });

  it('signs out nobody when the setting is switched off', async () => {
    await createAdmin('setting-off@example.com', READ_ONLY_ROLE_ID);
    const cookie = await signIn('setting-off@example.com');
    expect((await putEnforced(false, STUB_ADMIN)).statusCode).toBe(200);
    // Give a stray subscriber the time it would take.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await meStatus(cookie)).toBe(200);
  });
});
