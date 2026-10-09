import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';
import { Session } from '../../helpers/package-entities.js';

/**
 * Deactivating or deleting an administrator signs them out.
 *
 * Both writes used to leave the account's sessions in place. A permission
 * check refuses an inactive account, but a route gated on the session alone —
 * `GET` and `PATCH /api/v1/admin/me` among them — kept answering a deactivated
 * administrator until the session expired thirty days later, and reactivating
 * the account brought every old session back to life.
 */

const PASSWORD = 'withdrawn-strong-pass-123!';

describe('Admin users — withdrawing an account revokes its sessions', () => {
  let h: BackendServerHandle;

  async function createAndSignIn(email: string): Promise<{ id: string; cookie: string }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email,
        password: PASSWORD,
        firstName: 'With',
        lastName: 'Drawn',
        adminRoleId: READ_ONLY_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    const cookie = (login.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
    )!.value;
    return { id, cookie };
  }

  async function meStatus(cookie: string): Promise<number> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
    });
    return res.statusCode;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('revokes the sessions of an administrator who is deactivated', async () => {
    const { id, cookie } = await createAndSignIn('deactivated-admin@example.com');
    expect(await meStatus(cookie)).toBe(200);

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { status: 'inactive' },
    });
    expect(res.statusCode).toBe(200);

    expect(await meStatus(cookie)).toBe(401);
    expect(await h.em().count(Session, { adminUserId: id })).toBe(0);

    // Reactivating does not bring the old session back.
    const reactivate = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { status: 'active' },
    });
    expect(reactivate.statusCode).toBe(200);
    expect(await meStatus(cookie)).toBe(401);
  });

  it('leaves the sessions alone on an edit that does not deactivate', async () => {
    const { id, cookie } = await createAndSignIn('renamed-admin@example.com');

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/admin-users/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { firstName: 'Renamed', status: 'active' },
    });
    expect(res.statusCode).toBe(200);

    expect(await meStatus(cookie)).toBe(200);
  });

  it('revokes the sessions of an administrator who is deleted', async () => {
    const { id, cookie } = await createAndSignIn('deleted-admin@example.com');
    expect(await meStatus(cookie)).toBe(200);

    const res = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/admin-users/${id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(204);

    expect(await meStatus(cookie)).toBe(401);
    expect(await h.em().count(Session, { adminUserId: id })).toBe(0);
  });
});

/**
 * The second line of defence: a session whose account is no longer active is
 * refused where the admin guard accepts a request, whether or not anything
 * revoked it. Revocation is a step each write has to remember; this is the
 * check that holds when one forgets — the bootstrap CLI, a direct database
 * edit, a future write nobody thought about.
 *
 * So these cases change the account **behind the service's back**, leaving the
 * session row where it was.
 */
describe('Admin guard — a session of an account that is not active is refused', () => {
  let h: BackendServerHandle;

  async function signedIn(email: string): Promise<{ id: string; cookie: string }> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email,
        password: PASSWORD,
        firstName: 'Sur',
        lastName: 'Viving',
        adminRoleId: READ_ONLY_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    const id = (create.json() as { data: { id: string } }).data.id;
    const login = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password: PASSWORD },
    });
    const cookie = (login.cookies as Array<{ name: string; value: string }>).find(
      (c) => c.name === ADMIN_SESSION_COOKIE_NAME,
    )!.value;
    return { id, cookie };
  }

  async function call(
    method: 'GET' | 'PATCH',
    url: string,
    cookie: string,
    payload?: Record<string, unknown>,
  ) {
    return h.app.inject({
      method,
      url,
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
      ...(payload !== undefined ? { payload } : {}),
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it.each([
    ['deactivated', { status: 'inactive' }],
    ['deleted', { deleted_at: new Date() }],
  ])('refuses the surviving session of a %s account with 401', async (label, change) => {
    const { id, cookie } = await signedIn(`surviving-${label}@example.com`);
    expect((await call('GET', '/api/v1/admin/me', cookie)).statusCode).toBe(200);

    await h.em().getKnex()('admin_users').where({ id }).update(change);
    // The session row is still there: nothing revoked it.
    expect(await h.em().count(Session, { adminUserId: id })).toBe(1);

    // A route gated on the session alone…
    expect((await call('GET', '/api/v1/admin/me', cookie)).statusCode).toBe(401);
    // …the write the gap was found through, password change included…
    const patch = await call('PATCH', '/api/v1/admin/me', cookie, {
      firstName: 'Still',
      password: 'a-replacement-strong-pass-1!',
      currentPassword: PASSWORD,
    });
    expect(patch.statusCode).toBe(401);
    // …and a route gated on a permission, which used to answer 403: the
    // account is not short of a permission, it is not signed in.
    expect((await call('GET', '/api/v1/admin/permissions', cookie)).statusCode).toBe(401);

    const row = (await h.em().getKnex()('admin_users').where({ id }).first()) as {
      first_name: string;
    };
    expect(row.first_name).toBe('Sur');
  });

  it('still answers 403, not 401, for an active account missing the permission', async () => {
    const { cookie } = await signedIn('surviving-active@example.com');
    expect((await call('GET', '/api/v1/admin/permissions', cookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/v1/admin/me', cookie)).statusCode).toBe(200);
  });
});
