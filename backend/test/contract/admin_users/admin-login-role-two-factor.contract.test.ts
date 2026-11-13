import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ADMIN_SESSION_COOKIE_NAME, adminLoginResponseSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/** A strict copy: a key the sign-in reply carries that the contract does not declare fails (issue #599 §6). */
const strictLogin = deepStrict(adminLoginResponseSchema);

/**
 * Issue #349 — `AdminRole.requiresTwoFactor` changes what `POST
 * /api/v1/auth/admin/login` answers. A holder of a role that requires a second
 * factor and has none is sent to enrol (`mfaSetupRequired`), finishes setup and
 * only then gets a session; once enrolled they are challenged (`mfaRequired`).
 * With the flag off, and for an administrator of another role, the password
 * alone signs in — `mfa.admin.totp_enforced` stays off throughout, so the role
 * is the only source of the requirement here.
 *
 * Before the fix the flag was stored and edited and read by no sign-in path, so
 * the second case answered `authenticated`.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const PASSWORD = 'role-two-factor-strong-pass-1!';
const ROLE = 'role_two_factor_contract';
const HOLDER = 'role-2fa-holder@example.com';
const OTHER = 'role-2fa-other@example.com';

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

describe('admin sign-in honours the role two-factor requirement', () => {
  let h: BackendServerHandle;

  const putRole = (requiresTwoFactor: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${ROLE}`,
      cookies: STUB_ADMIN,
      payload: { code: ROLE, name: 'Role two-factor contract', permissions: ['orders:read'], requiresTwoFactor },
    });

  const login = async (email: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/login',
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    // Every branch — `authenticated`, `mfaRequired`, `mfaSetupRequired` — is the published shape.
    expect(disagreements(strictLogin, res.json())).toEqual([]);
    return {
      data: res.json().data as { status: string; setupTicket?: string; challengeId?: string },
      cookie: res.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)?.value,
    };
  };

  const createAdmin = async (email: string, adminRoleId: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: { email, password: PASSWORD, firstName: 'Role', lastName: 'Holder', adminRoleId },
    });
    expect(res.statusCode).toBe(201);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    const role = await putRole(false);
    expect(role.statusCode).toBe(200);
    await createAdmin(HOLDER, (role.json() as { data: { id: string } }).data.id);
    await createAdmin(OTHER, READ_ONLY_ROLE_ID);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('signs a holder in on the password alone while the flag is off', async () => {
    const { data, cookie } = await login(HOLDER);
    expect(data.status).toBe('authenticated');
    expect(cookie).toBeTruthy();
  });

  it('sends an unenrolled holder to enrol once the flag is on, and issues the session only after setup', async () => {
    expect((await putRole(true)).statusCode).toBe(200);

    const { data, cookie } = await login(HOLDER);
    expect(data.status).toBe('mfaSetupRequired');
    expect(cookie).toBeUndefined();

    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/begin',
      payload: { setupTicket: data.setupTicket },
    });
    expect(begin.statusCode).toBe(200);
    const { secret } = begin.json().data as { secret: string };

    const complete = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/complete',
      payload: { setupTicket: data.setupTicket, code: totpCode(secret) },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json().data.status).toBe('authenticated');
    expect(complete.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)?.value).toBeTruthy();
  });

  it('challenges the holder once enrolled', async () => {
    const { data, cookie } = await login(HOLDER);
    expect(data.status).toBe('mfaRequired');
    expect(data.challengeId).toBeTruthy();
    expect(cookie).toBeUndefined();
  });

  it('leaves an administrator of another role unaffected', async () => {
    const { data } = await login(OTHER);
    expect(data.status).toBe('authenticated');
  });
});
