import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * Feature 056 (T032) — admin toggles the customer-side roll-up capability.
 * PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/rollup.
 */

describe('admin set member roll-up capability (T032)', () => {
  let h: BackendServerHandle;
  let orgId: string;
  let memberId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Rollup Toggle Co',
      taxId: `PL056MRU${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    org.path = `/${org.id}/`;
    await em.flush();
    orgId = org.id;
    const member = em.create(CustomerAccount, {
      organizationId: orgId,
      email: `mru-${Date.now()}@example.com`,
      passwordHash: 'x',
      firstName: 'Mem',
      lastName: 'Ber',
      role: 'organization_admin',
    });
    await em.persistAndFlush(member);
    memberId = member.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('enables then disables the flag and persists it', async () => {
    const on = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/members/${memberId}/rollup`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { subtreeRollupEnabled: true },
    });
    expect(on.statusCode).toBe(200);
    expect((on.json() as { data: { subtreeRollupEnabled: boolean } }).data.subtreeRollupEnabled).toBe(true);

    const em = h.em();
    em.clear();
    expect((await em.findOneOrFail(CustomerAccount, { id: memberId })).subtreeRollupEnabled).toBe(true);

    const off = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/members/${memberId}/rollup`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { subtreeRollupEnabled: false },
    });
    expect(off.statusCode).toBe(200);
    em.clear();
    expect((await em.findOneOrFail(CustomerAccount, { id: memberId })).subtreeRollupEnabled).toBe(false);
  });

  it('returns 404 for an unknown member', async () => {
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/members/00000000-0000-4000-8000-0000000fffff/rollup`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: { subtreeRollupEnabled: true },
    });
    expect(res.statusCode).toBe(404);
  });
});
