import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME, ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';

/**
 * Issue #252 — a peer operator resets another operator's password.
 *
 * Before this surface existed the only way to reset any admin password was the
 * `admin:create` CLI upsert, which needs shell access to the deployment host —
 * so a client's own operators, on a hosted deployment, had no way back in.
 * `admin_users`' manifest promised the capability ("Every admin has a password
 * a peer admin can reset") while the strict update schema carried no `password`
 * field and the PATCH handler forwarded none.
 *
 * The acceptance is end to end: the target signs in with the new password, and
 * the session they held before the reset is gone.
 */

const ORIGINAL_PASSWORD = 'original-strong-pass-123!';
const NEW_PASSWORD = 'peer-reset-strong-pass-456!';

function adminSessionCookie(res: { cookies: unknown[] }): string {
  const cookies = res.cookies as Array<{ name: string; value: string }>;
  const cookie = cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME);
  expect(cookie).toBeDefined();
  return cookie!.value;
}

describe('Admin peer password reset', () => {
  let h: BackendServerHandle;
  let targetId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: 'locked-out-admin@example.com',
        password: ORIGINAL_PASSWORD,
        firstName: 'Locked',
        lastName: 'Out',
        adminRoleId: READ_ONLY_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    targetId = (create.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lets a peer reset the password, and the target signs in with the new one', async () => {
    const firstLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: 'locked-out-admin@example.com', password: ORIGINAL_PASSWORD },
    });
    expect(firstLogin.statusCode).toBe(200);
    const staleCookie = adminSessionCookie(firstLogin);

    // The session held before the reset is live.
    const beforeReset = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: staleCookie },
    });
    expect(beforeReset.statusCode).toBe(200);

    const auditBefore = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.change_password', objectId: targetId });

    const reset = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/admin-users/${targetId}/password`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { password: NEW_PASSWORD },
    });
    expect(reset.statusCode).toBe(200);
    // The response carries the ordinary admin-user projection — never the
    // password or its hash.
    const body = reset.json() as { data: Record<string, unknown> };
    expect(body.data['id']).toBe(targetId);
    expect(JSON.stringify(body)).not.toContain(NEW_PASSWORD);
    expect(Object.keys(body.data)).not.toContain('passwordHash');

    // The old password no longer signs in.
    const staleLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: 'locked-out-admin@example.com', password: ORIGINAL_PASSWORD },
    });
    expect(staleLogin.statusCode).toBe(401);

    // The new one does.
    const newLogin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: 'locked-out-admin@example.com', password: NEW_PASSWORD },
    });
    expect(newLogin.statusCode).toBe(200);
    expect((newLogin.json() as { data: { status: string } }).data.status).toBe('authenticated');

    // The session the target held before the reset is gone — a credential the
    // reset did not revoke would defeat the compromised-account case.
    const afterReset = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: staleCookie },
    });
    expect(afterReset.statusCode).toBe(401);

    // One audit row, attributed to the peer, carrying no secret material.
    const auditAfter = await h
      .em()
      .count(AuditLogEntry, { action: 'admin_user.change_password', objectId: targetId });
    expect(auditAfter).toBe(auditBefore + 1);

    const entry = await h.em().findOne(
      AuditLogEntry,
      { action: 'admin_user.change_password', objectId: targetId },
      { orderBy: { actedAt: 'desc' } },
    );
    expect(entry).not.toBeNull();
    expect(entry!.objectType).toBe('admin_user');
    expect(entry!.actorAdminUserId).toBe('00000000-0000-4000-8000-0000000000b1');
    expect(entry!.stateAfter).toMatchObject({ via: 'peer_reset' });
    const serialisedEntry = JSON.stringify({
      before: entry!.stateBefore,
      after: entry!.stateAfter,
    });
    expect(serialisedEntry).not.toContain(NEW_PASSWORD);
    expect(serialisedEntry).not.toContain('$argon2');
  });

  it('refuses an operator without admin_users:manage', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/admin-users/${targetId}/password`,
      cookies: { b2b_session: 'stub-restricted-admin-session' },
      payload: { password: 'another-strong-pass-789!' },
    });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FORBIDDEN);
  });

  it('404s on an unknown admin user', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users/00000000-0000-4000-8000-0000000000ff/password',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { password: 'another-strong-pass-789!' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('lets an operator holding the permission reset their own password', async () => {
    // No self-target guard, and that absence is deliberate. There is no role
    // hierarchy to rank a reset against, and `admin_users:manage` already
    // permits assigning oneself the role holding `*` — so refusing a
    // self-reset would close nothing while making the route answer a question
    // the e-mail-keyed flow, which is inherently self-targeted, has to answer
    // the other way.
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/admin-users/${TEST_ADMIN_ID}/password`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { password: 'self-service-strong-pass-321!' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a password shorter than the create surface accepts', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/admin-users/${targetId}/password`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { password: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });
});
