import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/110-instance-repository/` T118c — `mfa` resolves its four identity
 * reads itself, and this file is the half of the proof that can see the wiring.
 *
 * **Two of the six retired `MfaActorBridge` members were asserted by nothing in
 * the tree**, and that is the reason this file exists rather than a reason to
 * skip it. `resolveAccountEmail` and `verifyAccountPassword` were declared
 * optional on the bridge; `backend/src/composition.ts` supplied both and
 * `backend/test/helpers/test-server.ts` supplied neither, with a comment calling
 * the omission deliberate. So under test:
 *
 *  - an authenticator entry was labelled with the account's **UUID** where a
 *    real enrolment carries its e-mail address, and the one assertion in the
 *    tree over that URI is `toContain('otpauth://totp/')`, which both spellings
 *    satisfy; and
 *  - the password branch of the 2FA-disable re-authentication **did not exist** —
 *    every `/disable` call in the tree passes a code, so nothing took it.
 *
 * A drain that dropped either member would therefore have left all 13 existing
 * `mfa` integration files green while production lost a capability. Both are
 * asserted below, over the composed harness, against the real identity ports.
 *
 * The pure half — the four resolvers as functions of their ports, including the
 * `ModuleDisabledError` none of them may absorb — is
 * `packages/modules/mfa/src/backend/services/account-identity.test.ts`, which
 * composes nothing.
 */
const CUSTOMER = { b2b_session: 'stub-customer-session' };
const CUSTOMER_EMAIL = 'stub-customer@example.com';
/** `stub-customer-session-rfq` is a `regular_user` of the same organisation. */
const REGULAR_USER = { b2b_session: 'stub-customer-session-rfq' };
const PLATFORM_ADMIN = { b2b_admin_session: 'stub-admin-session' };
const ADMIN_EMAIL = 'platform-admin@example.com';

describe('mfa resolves its own identity reads (T118c)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(
      'mfa.storefront.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
    await h.settings.adminService.setValueForAllChannels(
      'mfa.admin.totp_enabled',
      true,
      null,
      { actorAdminUserId: null },
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  describe('resolveAccountEmail — the label an authenticator app shows', () => {
    it('labels a customer enrolment with the account e-mail, not its id', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/setup',
        cookies: CUSTOMER,
      });

      expect(res.statusCode).toBe(200);
      const { otpauthUri } = res.json().data as { otpauthUri: string };
      // The assertion that discriminates: before the drain this harness
      // contributed no `resolveAccountEmail`, so the label was the subject id.
      expect(decodeURIComponent(otpauthUri)).toContain(CUSTOMER_EMAIL);
    });

    it('labels an admin enrolment from `admin_users`, not `customer_accounts`', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/account/mfa/setup',
        cookies: PLATFORM_ADMIN,
      });

      expect(res.statusCode).toBe(200);
      const { otpauthUri } = res.json().data as { otpauthUri: string };
      expect(decodeURIComponent(otpauthUri)).toContain(ADMIN_EMAIL);
      expect(decodeURIComponent(otpauthUri)).not.toContain(CUSTOMER_EMAIL);
    });
  });

  describe('verifyAccountPassword — the password branch of the disable re-auth', () => {
    async function enrol(): Promise<void> {
      const setup = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/setup',
        cookies: CUSTOMER,
      });
      const { secret } = setup.json().data as { secret: string };
      const code = new TOTP({
        issuer: 'B2B Platform',
        label: 'verify',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      }).generate();
      await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/activate',
        cookies: CUSTOMER,
        payload: { code },
      });
    }

    async function totpActive(): Promise<boolean> {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/account/mfa/status',
        cookies: CUSTOMER,
      });
      return res.json().data.totpActive as boolean;
    }

    it('refuses a wrong password with 401 INVALID_CREDENTIALS, not 400', async () => {
      await enrol();
      expect(await totpActive()).toBe(true);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/disable',
        cookies: CUSTOMER,
        payload: { password: 'not-the-password' },
      });

      // The discriminating pair: with no verifier wired, `reauthenticate` falls
      // through to 400 `MFA_REAUTH_REQUIRED` — a refusal that looks like a
      // refusal while telling the caller the wrong thing, and while leaving the
      // password route to disabling 2FA unavailable.
      expect(res.statusCode).toBe(401);
      expect((res.json() as { error: { code: string } }).error.code).toBe('INVALID_CREDENTIALS');
      expect(await totpActive()).toBe(true);
    });

    it('accepts the account password and disables the second factor', async () => {
      expect(await totpActive()).toBe(true);

      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/account/mfa/disable',
        cookies: CUSTOMER,
        payload: { password: STUB_CUSTOMER_PASSWORD },
      });

      expect(res.statusCode).toBe(200);
      expect(await totpActive()).toBe(false);
    });
  });

  describe('resolveOrgAdmin — the organisation a policy write applies to', () => {
    it('lets an organisation administrator set their own policy', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/account/organization/mfa-policy',
        cookies: CUSTOMER,
        payload: { enforceTotp: true },
      });

      expect(res.statusCode).toBe(200);
    });

    it('refuses a regular member of the same organisation with 403', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/account/organization/mfa-policy',
        cookies: REGULAR_USER,
        payload: { enforceTotp: true },
      });

      expect(res.statusCode).toBe(403);
    });

    it('refuses an anonymous caller with 401', async () => {
      const res = await h.app.inject({
        method: 'PUT',
        url: '/api/v1/account/organization/mfa-policy',
        payload: { enforceTotp: true },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('resolveOrganizationCustomerIds — who a bulk reset covers', () => {
    it('resolves the organisation members rather than an empty list', async () => {
      // Before T118c this member had a `?? (async () => [])` default one layer
      // down, so a composition that did not supply it reported a successful
      // reset of nobody. The seeded organisation has three accounts.
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/mfa/reset-bulk',
        cookies: PLATFORM_ADMIN,
        payload: { organizationId: TEST_ORGANIZATION_ID },
      });

      expect(res.statusCode).toBe(200);
      const { requested } = res.json().data as { requested: number };
      expect(requested).toBeGreaterThan(0);
    });
  });
});
