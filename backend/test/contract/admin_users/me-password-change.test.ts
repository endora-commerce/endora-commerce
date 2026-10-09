import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_SESSION_COOKIE_NAME, ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * `PATCH /api/v1/admin/me` — changing your own password requires the current
 * one.
 *
 * The route used to hash and store whatever `password` it was sent. A session
 * was the only proof asked for, so anybody holding one — an unattended
 * browser, a stolen cookie — could replace the password and keep the account.
 *
 * Every case signs in for real rather than through a stub session: the
 * acceptance is which password signs in afterwards, and only the login route
 * answers that.
 */

const EMAIL = 'self-password-change@example.com';
const ORIGINAL_PASSWORD = 'original-strong-pass-123!';
const NEW_PASSWORD = 'rotated-strong-pass-456!';

describe('PATCH /api/v1/admin/me — password change', () => {
  let h: BackendServerHandle;
  let sessionCookie: string;

  async function login(password: string): Promise<{ statusCode: number; cookie: string | null }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email: EMAIL, password },
    });
    const cookies = res.cookies as Array<{ name: string; value: string }>;
    const cookie = cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME);
    return { statusCode: res.statusCode, cookie: cookie?.value ?? null };
  }

  async function patchMe(payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: sessionCookie },
      payload,
    });
  }

  async function readMe(): Promise<{ firstName: string; lastName: string }> {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { adminUser: { firstName: string; lastName: string } } }).data
      .adminUser;
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        email: EMAIL,
        password: ORIGINAL_PASSWORD,
        firstName: 'Self',
        lastName: 'Service',
        adminRoleId: READ_ONLY_ROLE_ID,
      },
    });
    expect(create.statusCode).toBe(201);
    const first = await login(ORIGINAL_PASSWORD);
    expect(first.statusCode).toBe(200);
    expect(first.cookie).not.toBeNull();
    sessionCookie = first.cookie!;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('updates the profile without asking for the current password', async () => {
    const res = await patchMe({ firstName: 'Renamed' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { firstName: string } }).data.firstName).toBe('Renamed');
    expect((await readMe()).firstName).toBe('Renamed');
  });

  it('refuses a new password sent without the current one, and changes nothing', async () => {
    const before = await readMe();
    const res = await patchMe({ lastName: 'Partial', password: NEW_PASSWORD });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; details?: unknown } };
    expect(body.error.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    expect(JSON.stringify(body.error.details)).toContain('currentPassword');

    // Nothing else in the refused request took effect.
    expect(await readMe()).toMatchObject({ lastName: before.lastName });
    expect((await login(NEW_PASSWORD)).statusCode).toBe(401);
    expect((await login(ORIGINAL_PASSWORD)).statusCode).toBe(200);
  });

  it('refuses a wrong current password, and changes nothing', async () => {
    const before = await readMe();
    const res = await patchMe({
      firstName: 'Partial',
      lastName: 'Partial',
      password: NEW_PASSWORD,
      currentPassword: 'not-the-current-password',
    });
    // Not 401: the session is valid, and the Admin UI signs an administrator
    // out on any 401 — a typo in this field must not do that.
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.CURRENT_PASSWORD_INVALID);
    expect(body.error.message).toBe('The current password is incorrect.');
    expect(JSON.stringify(body)).not.toContain(NEW_PASSWORD);

    expect(await readMe()).toMatchObject({
      firstName: before.firstName,
      lastName: before.lastName,
    });
    expect((await login(NEW_PASSWORD)).statusCode).toBe(401);
    expect((await login(ORIGINAL_PASSWORD)).statusCode).toBe(200);
  });

  it('answers the refusal in the language the administrator chose', async () => {
    // The English sentence above is also what the service throws, so it proves
    // no translation. The Polish one can only come from the bundle.
    async function setPreferredLanguage(preferredLanguage: 'pl' | null): Promise<void> {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: { [ADMIN_SESSION_COOKIE_NAME]: sessionCookie },
        payload: { preferredLanguage },
      });
      expect(res.statusCode).toBe(200);
    }
    await setPreferredLanguage('pl');
    try {
      const res = await patchMe({
        password: NEW_PASSWORD,
        currentPassword: 'not-the-current-password',
      });
      expect(res.statusCode).toBe(403);
      expect((res.json() as { error: { message: string } }).error.message).toBe(
        'Obecne hasło jest nieprawidłowe.',
      );
    } finally {
      await setPreferredLanguage(null);
    }
  });

  it('refuses a new password equal to the current one, and changes nothing', async () => {
    const before = await readMe();
    const res = await patchMe({
      lastName: 'Partial',
      password: ORIGINAL_PASSWORD,
      currentPassword: ORIGINAL_PASSWORD,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe(ERROR_CODES.NEW_PASSWORD_UNCHANGED);
    expect(body.error.message).toBe(
      'The new password is the same as the current one. Choose a different password.',
    );
    expect(JSON.stringify(body)).not.toContain(ORIGINAL_PASSWORD);
    expect(await readMe()).toMatchObject({ lastName: before.lastName });
    // Not a sign-out either: the session that asked is still the caller's.
    expect((await login(ORIGINAL_PASSWORD)).statusCode).toBe(200);
  });

  it('answers that refusal in the language the administrator chose', async () => {
    const setLanguage = async (preferredLanguage: 'pl' | null): Promise<void> => {
      const res = await h.app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/me/preferred-language',
        cookies: { [ADMIN_SESSION_COOKIE_NAME]: sessionCookie },
        payload: { preferredLanguage },
      });
      expect(res.statusCode).toBe(200);
    };
    await setLanguage('pl');
    try {
      const res = await patchMe({
        password: ORIGINAL_PASSWORD,
        currentPassword: ORIGINAL_PASSWORD,
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { message: string } }).error.message).toBe(
        'Nowe hasło jest takie samo jak obecne. Wybierz inne hasło.',
      );
    } finally {
      await setLanguage(null);
    }
  });

  it('cannot set a password through the generic admin-user edit', async () => {
    // `PATCH /admin/admin-users/:id` is for name, role and status. A password
    // accepted there would be a password write with no current password, no
    // session revocation and no password audit entry.
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/me',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: sessionCookie },
    });
    const id = (me.json() as { data: { adminUser: { id: string } } }).data.adminUser.id;
    for (const field of ['password', 'currentPassword', 'newPassword']) {
      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/admin-users/${id}`,
        cookies: { b2b_session: 'stub-admin-session' },
        payload: { firstName: 'Generic', [field]: NEW_PASSWORD },
      });
      expect(res.statusCode).toBe(400);
      expect((res.json() as { error: { code: string } }).error.code).toBe(
        ERROR_CODES.VALIDATION_FAILED,
      );
    }
    expect((await readMe()).firstName).not.toBe('Generic');
    expect((await login(NEW_PASSWORD)).statusCode).toBe(401);
    expect((await login(ORIGINAL_PASSWORD)).statusCode).toBe(200);
  });

  it('changes the password when the current one is correct', async () => {
    const res = await patchMe({
      lastName: 'Rotated',
      password: NEW_PASSWORD,
      currentPassword: ORIGINAL_PASSWORD,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown> };
    expect(body.data['lastName']).toBe('Rotated');
    expect(JSON.stringify(body)).not.toContain(NEW_PASSWORD);
    expect(Object.keys(body.data)).not.toContain('passwordHash');

    expect((await login(ORIGINAL_PASSWORD)).statusCode).toBe(401);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
    // The session that made the change is still the caller's own.
    expect((await readMe()).lastName).toBe('Rotated');
  });

  it('refuses the previous password as the current one after the change', async () => {
    const res = await patchMe({
      password: 'third-strong-pass-789!',
      currentPassword: ORIGINAL_PASSWORD,
    });
    expect(res.statusCode).toBe(403);
    expect((await login(NEW_PASSWORD)).statusCode).toBe(200);
  });
});
