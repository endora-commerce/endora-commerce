import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  OTHER_TEST_ORGANIZATION_ID,
  TEST_ADMIN_ID,
  TEST_CUSTOMER_ID,
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
 * Issue #983 — both organization 2FA-policy writes run through
 * `CommandBus.run` (Constitution XIII). The observable consequence is the audit
 * trail: exactly **one** `mfa.org_enforced` entry per write, on the
 * `organization`, carrying the actor the bus derived from the request's tenant
 * context and the value it replaced — where the routes used to record that
 * entry by hand, after the commit, beside a second `mfa.set_org_enforcement`
 * entry the service recorded for the same write.
 */
describe('mfa — organization policy writes go through the Command Bus (#983)', () => {
  let h: BackendServerHandle;

  const entriesFor = async (organizationId: string, after: Set<string>) =>
    withSystemScope('read the audit trail of one organization', async () => {
      const rows = await h.em().find(AuditLogEntry, { objectId: organizationId }, { orderBy: { actedAt: 'asc' } });
      return rows.filter((row) => !after.has(row.id));
    });

  const idsFor = async (organizationId: string): Promise<Set<string>> =>
    new Set((await entriesFor(organizationId, new Set())).map((row) => row.id));

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('seed org B', async () => {
      await seedOtherTestOrganization(h.em());
    });
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('storefront PUT records one entry, attributed to the acting customer', async () => {
    const seen = await idsFor(TEST_ORGANIZATION_ID);
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/account/organization/mfa-policy',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { enforceTotp: true },
    });
    expect(res.statusCode, res.body).toBe(200);

    const rows = await entriesFor(TEST_ORGANIZATION_ID, seen);
    expect(rows.map((row) => row.action)).toEqual(['mfa.org_enforced']);
    expect(rows[0]).toMatchObject({
      objectType: 'organization',
      actorCustomerAccountId: TEST_CUSTOMER_ID,
      stateAfter: { enforceTotp: true },
    });
  });

  it('admin POST records one entry, attributed to the acting admin, with the replaced value', async () => {
    const enforce = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${OTHER_TEST_ORGANIZATION_ID}/mfa-policy`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { enforceTotp: true },
    });
    expect(enforce.statusCode, enforce.body).toBe(200);

    const seen = await idsFor(OTHER_TEST_ORGANIZATION_ID);
    const lift = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${OTHER_TEST_ORGANIZATION_ID}/mfa-policy`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { enforceTotp: false },
    });
    expect(lift.statusCode, lift.body).toBe(200);

    const rows = await entriesFor(OTHER_TEST_ORGANIZATION_ID, seen);
    expect(rows.map((row) => row.action)).toEqual(['mfa.org_enforced']);
    expect(rows[0]).toMatchObject({
      objectType: 'organization',
      actorAdminUserId: TEST_ADMIN_ID,
      stateBefore: { enforceTotp: true },
      stateAfter: { enforceTotp: false },
    });
  });
});
