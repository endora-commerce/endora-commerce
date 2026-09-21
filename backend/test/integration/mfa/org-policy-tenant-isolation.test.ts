import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminRole,
  AdminUser,
  MfaOrganizationPolicy,
  OrganizationSalesRepAssignment,
} from '../../helpers/package-entities.js';
import {
  ADMIN_COOKIES,
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ORGANIZATION_ID,
} from '../../helpers/test-actors.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * D-260 track B item 2 — `POST /admin/organizations/:organizationId/mfa-policy`
 * authorises the organization id it reads out of the path.
 *
 * Host-owned under D-252: it composes a server, so it travels with the host
 * rather than into the package.
 *
 * `MfaOrganizationPolicy` is `@GlobalEntity()` and correctly so (D-259
 * category 2 — the row *is* the per-organization rule, keyed by an id it does
 * not own), which is exactly why no classification could reach this route: the
 * id arrives from the caller and selects whose 2FA enforcement is written. A
 * `sales_representative` holding `mfa:manage` — a code the operator may put on
 * any role through `PUT /admin/admin-roles/:code` — could therefore force or
 * lift TOTP for an organization it was never assigned.
 *
 * The refusal is **404 with the surface's own not-found code**, per D-260/B's
 * criterion: the organization id *addresses the resource* (path parameter, and
 * the row's own key), so FR-008's indistinguishable answer applies and the
 * model is `credit_limits/routes.ts:135-141`. It is not the `mode: 'all'` arm —
 * that arm is for a write that changes the *actor's own* authority, and this
 * one does not: it changes an organization's login policy, leaving
 * `allowedOrganizationIds` untouched. Refusing every scoped actor here would
 * remove a capability the ruling did not take away.
 *
 * Asserted through the real route with a real scoped session: the suite's own
 * EM sits in `mode: 'system'` (D-259), so only `withSystemScope` re-reads are
 * direct, and only to show what did or did not reach the table.
 */

const POLICY_URL = (orgId: string) => `/api/v1/admin/organizations/${orgId}/mfa-policy`;

describe('mfa — org policy tenant isolation [D-260]', () => {
  let h: BackendServerHandle;
  let scopedCookie = '';
  const platformAdmin = { cookies: { b2b_session: 'stub-admin-session' } };

  const policyFor = async (organizationId: string): Promise<boolean | null> =>
    withSystemScope('read the org policy row back', async () => {
      const row = await h.em().findOne(MfaOrganizationPolicy, { organizationId });
      return row ? row.enforceTotp : null;
    });

  beforeAll(async () => {
    h = await setupBackendServer();

    await withSystemScope('seed org B and an mfa:manage rep scoped to org A only', async () => {
      const em = h.em();
      await seedOtherTestOrganization(em);

      let role = await em.findOne(AdminRole, { code: 'sales_representative' });
      if (!role) {
        role = em.create(AdminRole, {
          code: 'sales_representative',
          name: 'Sales Representative',
          permissions: ['mfa:manage'],
        });
      } else if (!role.permissions.includes('mfa:manage')) {
        role.permissions = [...role.permissions, 'mfa:manage'];
      }
      await em.persistAndFlush(role);

      const rep = em.create(AdminUser, {
        email: `d260-mfa-policy-rep-${Date.now()}@i.local`,
        passwordHash: 'x'.repeat(60),
        adminRoleId: role.id,
        firstName: 'D260',
        lastName: 'MfaRep',
      });
      await em.persistAndFlush(rep);
      await em.persistAndFlush(
        em.create(OrganizationSalesRepAssignment, {
          organizationId: TEST_ORGANIZATION_ID,
          adminUserId: rep.id,
        }),
      );

      scopedCookie = `stub-d260-mfa-policy-${Date.now()}`;
      ADMIN_COOKIES[scopedCookie] = { adminUserId: rep.id };
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses a scoped admin enforcing TOTP on a foreign organization, indistinguishably from not-found', async () => {
    expect(await policyFor(OTHER_TEST_ORGANIZATION_ID)).toBeNull();

    const forced = await h.app.inject({
      method: 'POST',
      url: POLICY_URL(OTHER_TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { enforceTotp: true },
    });
    expect(forced.statusCode, forced.body).toBe(404);
    expect((forced.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    expect(await policyFor(OTHER_TEST_ORGANIZATION_ID)).toBeNull();
  });

  it('refuses a scoped admin lifting an existing foreign enforcement', async () => {
    const enforced = await h.app.inject({
      method: 'POST',
      url: POLICY_URL(OTHER_TEST_ORGANIZATION_ID),
      ...platformAdmin,
      payload: { enforceTotp: true },
    });
    expect(enforced.statusCode, enforced.body).toBe(200);
    expect(await policyFor(OTHER_TEST_ORGANIZATION_ID)).toBe(true);

    const lifted = await h.app.inject({
      method: 'POST',
      url: POLICY_URL(OTHER_TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { enforceTotp: false },
    });
    expect(lifted.statusCode, lifted.body).toBe(404);
    expect(await policyFor(OTHER_TEST_ORGANIZATION_ID)).toBe(true);
  });

  it('still lets the scoped admin manage its own organization [the narrowing is not a ban]', async () => {
    const forced = await h.app.inject({
      method: 'POST',
      url: POLICY_URL(TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { enforceTotp: true },
    });
    expect(forced.statusCode, forced.body).toBe(200);
    expect(await policyFor(TEST_ORGANIZATION_ID)).toBe(true);

    const lifted = await h.app.inject({
      method: 'POST',
      url: POLICY_URL(TEST_ORGANIZATION_ID),
      cookies: { b2b_session: scopedCookie },
      payload: { enforceTotp: false },
    });
    expect(lifted.statusCode, lifted.body).toBe(200);
    expect(await policyFor(TEST_ORGANIZATION_ID)).toBe(false);
  });

  it('lets a platform admin (mode: all) still write either organization [the widening must not be lost]', async () => {
    for (const orgId of [TEST_ORGANIZATION_ID, OTHER_TEST_ORGANIZATION_ID]) {
      const res = await h.app.inject({
        method: 'POST',
        url: POLICY_URL(orgId),
        ...platformAdmin,
        payload: { enforceTotp: true },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(await policyFor(orgId)).toBe(true);
    }
  });
});
