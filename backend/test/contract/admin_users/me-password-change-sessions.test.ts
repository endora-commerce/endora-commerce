import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME, ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PLATFORM_ADMIN_ROLE_ID } from '../../helpers/seed-admins.js';
import { Session } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `PATCH /api/v1/admin/me` — a password change withdraws the sessions the old
 * password minted.
 *
 * An administrator changes their password because they suspect somebody else
 * knows it, or holds a session of theirs. Before this, the change replaced the
 * hash and left every session the account held answering: the browser on the
 * other machine stayed signed in. A peer reset
 * (`POST /api/v1/admin/admin-users/:id/password`) already revoked them all; the
 * self-service change now revokes all **but the one that made the request**,
 * so the administrator is not thrown out of the screen they are on.
 *
 * Every case signs in for real: which cookie still answers is the acceptance,
 * and only a real session can answer it.
 */

const EMAIL = 'self-password-sessions@example.com';
const PASSWORD_A = 'first-strong-pass-123!';
const PASSWORD_B = 'second-strong-pass-456!';

describe('PATCH /api/v1/admin/me — a password change revokes the other sessions', () => {
  let h: BackendServerHandle;
  let adminId: string;
  /** The password the account holds right now; cases rotate it. */
  let password = PASSWORD_A;

  async function login(pw: string): Promise<{ statusCode: number; cookie: string | null }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password: pw },
    });
    const cookies = res.cookies as Array<{ name: string; value: string }>;
    const cookie = cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME);
    return { statusCode: res.statusCode, cookie: cookie?.value ?? null };
  }

  async function session(): Promise<string> {
    const res = await login(password);
    expect(res.statusCode).toBe(200);
    expect(res.cookie).not.toBeNull();
    return res.cookie!;
  }

  async function meStatus(cookie: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
    });
    return res.statusCode;
  }

  async function patchMe(cookie: string, payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
      payload,
    });
  }

  function otherPassword(): string {
    return password === PASSWORD_A ? PASSWORD_B : PASSWORD_A;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: EMAIL,
        password: PASSWORD_A,
        firstName: 'Self',
        lastName: 'Sessions',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    adminId = (create.json() as { data: { id: string } }).data.id;
  });

  beforeEach(async () => {
    // Each case starts from an account holding no session at all.
    await h.em().nativeDelete(Session, {
      $or: [{ adminUserId: adminId }, { impersonatorAdminUserId: adminId }],
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('revokes every other session and keeps the one that made the change', async () => {
    const calling = await session();
    const otherBrowser = await session();
    const thirdBrowser = await session();
    expect(await meStatus(otherBrowser)).toBe(200);
    expect(await meStatus(thirdBrowser)).toBe(200);

    const next = otherPassword();
    const res = await patchMe(calling, { password: next, currentPassword: password });
    expect(res.statusCode).toBe(200);
    password = next;

    expect(await meStatus(otherBrowser)).toBe(401);
    expect(await meStatus(thirdBrowser)).toBe(401);
    // The administrator is still signed in where they made the change, and no
    // replacement cookie was needed for it.
    expect(await meStatus(calling)).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();

    const left = await h.em().find(Session, { adminUserId: adminId });
    expect(left).toHaveLength(1);
    expect(calling.startsWith(`${left[0]!.id}.`)).toBe(true);
  });

  it('lets a session opened after the change work', async () => {
    const calling = await session();
    const next = otherPassword();
    const res = await patchMe(calling, { password: next, currentPassword: password });
    expect(res.statusCode).toBe(200);
    password = next;

    const fresh = await session();
    expect(await meStatus(fresh)).toBe(200);
    expect(await meStatus(calling)).toBe(200);
  });

  it('revokes nothing when the current password is wrong', async () => {
    const calling = await session();
    const otherBrowser = await session();

    const res = await patchMe(calling, {
      password: otherPassword(),
      currentPassword: 'not-the-current-password',
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.CURRENT_PASSWORD_INVALID,
    );

    expect(await meStatus(otherBrowser)).toBe(200);
    expect(await meStatus(calling)).toBe(200);
  });

  it('revokes nothing when only the name changes', async () => {
    const calling = await session();
    const otherBrowser = await session();

    const res = await patchMe(calling, { firstName: 'Renamed' });
    expect(res.statusCode).toBe(200);

    expect(await meStatus(otherBrowser)).toBe(200);
    expect(await meStatus(calling)).toBe(200);
  });

  it('ends the impersonations the administrator started, as a peer reset does', async () => {
    const calling = await session();
    const start = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/impersonate`,
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: calling },
      payload: { customerAccountId: TEST_CUSTOMER_ID, reason: 'support' },
    });
    expect(start.statusCode).toBe(200);
    expect(await h.em().count(Session, { impersonatorAdminUserId: adminId })).toBe(1);

    const next = otherPassword();
    const res = await patchMe(calling, { password: next, currentPassword: password });
    expect(res.statusCode).toBe(200);
    password = next;

    expect(await h.em().count(Session, { impersonatorAdminUserId: adminId })).toBe(0);
    expect(await meStatus(calling)).toBe(200);
  });

  it('leaves another administrator signed in', async () => {
    const otherEmail = 'self-password-bystander@example.com';
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: otherEmail,
        password: PASSWORD_A,
        firstName: 'By',
        lastName: 'Stander',
        adminRoleId: PLATFORM_ADMIN_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    const bystanderLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: otherEmail, password: PASSWORD_A },
    });
    const bystander = (bystanderLogin.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
    )!.value;

    const calling = await session();
    const next = otherPassword();
    const res = await patchMe(calling, { password: next, currentPassword: password });
    expect(res.statusCode).toBe(200);
    password = next;

    expect(await meStatus(bystander)).toBe(200);
  });

  it('audits the change as a password change, with no secret in the entry', async () => {
    const calling = await session();
    const before = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.change_password', objectId: adminId });
    const updatesBefore = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.update', objectId: adminId });

    const current = password;
    const next = otherPassword();
    const res = await patchMe(calling, { password: next, currentPassword: current });
    expect(res.statusCode).toBe(200);
    password = next;

    const entries = await h.em().find(
      AuditLogEntry,
      { action: 'admin_user.change_password', objectId: adminId },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entries).toHaveLength(before + 1);
    const entry = entries[0]!;
    expect(entry.objectType).toBe('admin_user');
    // Self and peer are told apart the way the peer reset tells them: the
    // actor, and the route taken.
    expect(entry.actorAdminUserId).toBe(adminId);
    expect(entry.stateAfter).toMatchObject({ via: 'self_service' });

    // A password-only request is not also reported as a profile edit.
    expect(
      await h.em().count(AuditLogEntry, { action: 'admin_user.update', objectId: adminId }),
    ).toBe(updatesBefore);

    // The whole row, every column — not only the two state documents.
    const knex = h.em().getKnex();
    const row = (await knex('audit_log_entries').where({ id: entry.id }).first()) as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    const dump = JSON.stringify(row);
    expect(dump).not.toContain(current);
    expect(dump).not.toContain(next);
    expect(dump).not.toContain('$argon2');
    expect(dump.toLowerCase()).not.toContain('passwordhash');
    expect(dump.toLowerCase()).not.toContain('password_hash');
  });

  it('audits a request that changes the name and the password as both', async () => {
    const calling = await session();
    const passwordBefore = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.change_password', objectId: adminId });
    const updatesBefore = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.update', objectId: adminId });

    const next = otherPassword();
    const res = await patchMe(calling, {
      lastName: 'Both',
      password: next,
      currentPassword: password,
    });
    expect(res.statusCode).toBe(200);
    password = next;

    expect(
      await h
        .em()
        .count(AuditLogEntry, { action: 'admin_user.change_password', objectId: adminId }),
    ).toBe(passwordBefore + 1);
    expect(
      await h.em().count(AuditLogEntry, { action: 'admin_user.update', objectId: adminId }),
    ).toBe(updatesBefore + 1);
  });
});
