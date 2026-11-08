import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { ADMIN_SESSION_COOKIE_NAME } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { oauthBinding } from '../../helpers/oauth-binding.js';

/**
 * Issue #349 — the role two-factor requirement is read where every other admin
 * second-factor decision is read, `MfaPolicyResolver`, so it reaches the paths
 * the password sign-in contract test does not: federated sign-in and the
 * self-service status. And because `mfa` off means no second factor at all
 * (D-96), the requirement and the module's off state are kept apart on the
 * operator axis — neither can be reached from the other — while the
 * deployment axis degrades to password-only as it always has.
 */
const STUB_ADMIN = { b2b_session: 'stub-admin-session' };
const PASSWORD = 'role-two-factor-int-pass-1!';
const ROLE = 'role_two_factor_int';
const HOLDER = 'role-2fa-int-holder@example.com';

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

describe('role two-factor requirement beyond the password sign-in', () => {
  let h: BackendServerHandle;

  const putRole = (requiresTwoFactor: boolean) =>
    h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/admin-roles/${ROLE}`,
      cookies: STUB_ADMIN,
      payload: { code: ROLE, name: 'Role two-factor', permissions: ['orders:read'], requiresTwoFactor },
    });

  const flipMfa = (active: boolean) =>
    h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/modules/mfa/activation',
      cookies: STUB_ADMIN,
      payload: { active },
    });

  const passwordLogin = async () =>
    (
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/auth/admin/login',
        payload: { email: HOLDER, password: PASSWORD },
      })
    ).json().data as { status: string };

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels('mfa.admin.microsoft_enabled', true, null, {
      actorAdminUserId: null,
    });
    const role = await putRole(false);
    expect(role.statusCode).toBe(200);
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/admin-users',
      cookies: STUB_ADMIN,
      payload: {
        email: HOLDER,
        password: PASSWORD,
        firstName: 'Role',
        lastName: 'Holder',
        adminRoleId: (role.json() as { data: { id: string } }).data.id,
      },
    });
    expect(created.statusCode).toBe(201);
    expect((await putRole(true)).statusCode).toBe(200);
  });

  afterAll(async () => {
    await flipMfa(true);
    await teardownBackendServer(h);
  });

  it('sends a federated sign-in of an unenrolled holder to setup instead of issuing a session', async () => {
    const start = await h.app.inject({ method: 'GET', url: '/api/v1/auth/admin/oauth/microsoft/start' });
    expect(start.statusCode).toBe(302);
    const state = new URL(start.headers['location'] as string).searchParams.get('state')!;
    const callback = await h.app.inject({
      method: 'GET',
      url: `/api/v1/auth/admin/oauth/microsoft/callback?code=${encodeURIComponent(HOLDER)}&state=${encodeURIComponent(state)}`,
      cookies: oauthBinding(start),
    });
    expect(callback.statusCode).toBe(302);
    expect(callback.headers['location']).toContain('mfa_setup_required');
    expect(callback.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("reports the requirement on an enrolled holder's own status, so the screen does not offer it as optional", async () => {
    const roleRow = (await putRole(true)).json() as { data: { id: string } };
    const email = 'role-2fa-int-status@example.com';
    expect(
      (
        await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/admin-users',
          cookies: STUB_ADMIN,
          payload: { email, password: PASSWORD, firstName: 'St', lastName: 'Atus', adminRoleId: roleRow.data.id },
        })
      ).statusCode,
    ).toBe(201);
    const login = (
      await h.app.inject({ method: 'POST', url: '/api/v1/auth/admin/login', payload: { email, password: PASSWORD } })
    ).json().data as { status: string; setupTicket: string };
    expect(login.status).toBe('mfaSetupRequired');
    const begin = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/begin',
      payload: { setupTicket: login.setupTicket },
    });
    const { secret } = begin.json().data as { secret: string };
    const complete = await h.app.inject({
      method: 'POST',
      url: '/api/v1/auth/admin/mfa/setup-ticket/complete',
      payload: { setupTicket: login.setupTicket, code: totpCode(secret) },
    });
    const cookie = complete.cookies.find((c) => c.name === ADMIN_SESSION_COOKIE_NAME)!.value;

    const status = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/account/mfa/status',
      cookies: { [ADMIN_SESSION_COOKIE_NAME]: cookie },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().data).toMatchObject({ totpActive: true, totpEnforcedForScope: true });
  });

  it('refuses switching mfa off while the role requires a second factor, naming the role', async () => {
    const res = await flipMfa(false);
    expect(res.statusCode).toBe(409);
    const error = res.json().error as { code: string; message: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_DEACTIVATION_BLOCKED');
    expect(error.details['roleCodes']).toEqual([ROLE]);
    expect(error.message).toContain(ROLE);
  });

  it('refuses turning the flag on while mfa is off, and always allows turning it off', async () => {
    expect((await putRole(false)).statusCode).toBe(200);
    expect((await flipMfa(false)).statusCode).toBe(200);

    const on = await putRole(true);
    expect(on.statusCode).toBe(409);
    const error = on.json().error as { code: string; message: string; details: Record<string, unknown> };
    expect(error.code).toBe('MFA_REQUIRED_FOR_ROLE_TWO_FACTOR');
    expect(error.details['reason']).toBe('mfa_off');
    expect(error.message).not.toBe('');

    expect((await putRole(false)).statusCode).toBe(200);

    // Nothing to preview while the module is off: no session can be ended.
    const preview = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/admin-roles/${ROLE}/two-factor-impact`,
      cookies: STUB_ADMIN,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().data).toEqual({ unprotectedAdministrators: null });

    expect((await flipMfa(true)).statusCode).toBe(200);
  });

  it('degrades to password-only when the deployment withdraws mfa with the flag already on (D-96)', async () => {
    expect((await putRole(true)).statusCode).toBe(200);
    expect((await passwordLogin()).status).toBe('mfaSetupRequired');

    await withModuleOff('mfa', 'platform-unavailable', async () => {
      expect((await passwordLogin()).status).toBe('authenticated');
    });

    expect((await passwordLogin()).status).toBe('mfaSetupRequired');
    expect((await putRole(false)).statusCode).toBe(200);
  });
});
