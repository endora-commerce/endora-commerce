import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { CustomerGroup } from '../../helpers/package-entities.js';

/**
 * Feature 040, US6 — admin assigns/clears a customer's direct customer group.
 */
describe('Admin customer-group assignment (US6)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  let groupId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const reconciler = new ManifestReconciler(h.em());
    await reconciler.apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: admin,
      payload: { scope: 'all', value: true },
    });
    const g = h.em().create(CustomerGroup, { code: `cg-${Date.now()}`, name: 'US6 Group' });
    await h.em().persistAndFlush(g);
    groupId = g.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('sets and clears a customer group', async () => {
    const email = `grp-${Date.now()}@example.test`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'Grp', lastName: 'Me', acceptedTermsVersion: 'v1' },
    });
    const id = (await h.em().findOne(CustomerAccount, { email }))!.id;

    const set = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/customers/${id}/customer-group`,
      cookies: admin,
      payload: { customerGroupId: groupId },
    });
    expect(set.statusCode).toBe(200);
    expect((set.json() as { data: { customerGroupId: string | null } }).data.customerGroupId).toBe(groupId);

    const clear = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/customers/${id}/customer-group`,
      cookies: admin,
      payload: { customerGroupId: null },
    });
    expect(clear.statusCode).toBe(200);
    expect((clear.json() as { data: { customerGroupId: string | null } }).data.customerGroupId).toBeNull();
  });
});
