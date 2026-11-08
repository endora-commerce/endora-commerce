import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * Issue #349, M4 — an administrator session lasts thirty days, so a role
 * requirement applied only "at the next sign-in" could stay unenforced for a
 * month. When a role starts requiring a second factor, and when an
 * administrator is given such a role, the sessions of the affected
 * administrators who have **no** enrolled factor end, after the write commits.
 *
 * Enrolled holders keep theirs (they proved a factor to get it). The acting
 * administrator keeps the session the change was made from. The role write
 * answers how many were signed out, and a preview read gives the same number
 * before the save. A refused write signs out nobody.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const PASSWORD = 'role-sessions-strong-pass-1!';

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

describe('role two-factor requirement — existing sessions', () => {
  let h: BackendServerHandle;

  const putRole = (
    code: string,
    requiresTwoFactor: boolean,
    cookies: Record<string, string> = STUB_ADMIN,
    permissions: string[] = ['orders:read'],
  ) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${code}`,
      cookies,
      payload: { code, name: code, permissions, requiresTwoFactor },
    });

  const roleId = async (code: string, permissions?: string[]): Promise<string> => {
    const res = await putRole(code, false, STUB_ADMIN, permissions);
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { id: string } }).data.id;
  };

  const createAdmin = async (email: string, adminRoleId: string): Promise<string> => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: { email, password: PASSWORD, firstName: 'Ses', lastName: 'Sion', adminRoleId },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
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

  it('signs out exactly the unenrolled holders when the flag turns on, after a preview of the same count', async () => {
    const id = await roleId('sessions_flip');
    await createAdmin('flip-unenrolled@example.com', id);
    await createAdmin('flip-enrolled@example.com', id);
    await createAdmin('flip-outsider@example.com', READ_ONLY_ROLE_ID);
    const outsider = await signIn('flip-outsider@example.com');
    const unenrolled = await signIn('flip-unenrolled@example.com');
    const enrolled = await signIn('flip-enrolled@example.com');
    await enrol(enrolled);

    const preview = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/admin-roles/sessions_flip/two-factor-impact',
      cookies: STUB_ADMIN,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toEqual({ unprotectedAdministrators: 1 });

    const res = await putRole('sessions_flip', true);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ requiresTwoFactor: true, signedOutAdministrators: 1 });

    expect(await meStatus(unenrolled)).toBe(401);
    expect(await meStatus(enrolled)).toBe(200);
    expect(await meStatus(outsider)).toBe(200);

    // Saving again with the flag already on signs out nobody further.
    const again = await putRole('sessions_flip', true);
    expect(again.json().data).toMatchObject({ signedOutAdministrators: 0 });
  });

  it("spares the acting administrator's own session and ends their others", async () => {
    // A role that may edit roles, so its holder can flip its own flag.
    const id = await roleId('sessions_self', ['admin_users:manage']);
    await createAdmin('self-actor@example.com', id);
    const current = await signIn('self-actor@example.com');
    const elsewhere = await signIn('self-actor@example.com');

    const res = await putRole('sessions_self', true, cookieOf(current), ['admin_users:manage']);
    expect(res.statusCode).toBe(200);

    expect(await meStatus(current)).toBe(200);
    expect(await meStatus(elsewhere)).toBe(401);
  });

  it('signs out an unenrolled administrator who is given a role that requires a second factor', async () => {
    const required = await roleId('sessions_assign');
    expect((await putRole('sessions_assign', true)).statusCode).toBe(200);
    const adminId = await createAdmin('assign-unenrolled@example.com', READ_ONLY_ROLE_ID);
    const cookie = await signIn('assign-unenrolled@example.com');

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${adminId}`,
      cookies: STUB_ADMIN,
      payload: { adminRoleId: required },
    });
    expect(res.statusCode).toBe(200);
    expect(await meStatus(cookie)).toBe(401);
  });

  it('signs out nobody when the role write is refused', async () => {
    const id = await roleId('sessions_refused');
    await createAdmin('refused-unenrolled@example.com', id);
    const cookie = await signIn('refused-unenrolled@example.com');

    const res = await putRole('sessions_refused', true, STUB_ADMIN, ['no_such:permission']);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await meStatus(cookie)).toBe(200);
  });
});
