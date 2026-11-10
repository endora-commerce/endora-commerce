import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { manifest as customersManifest } from '../../../../packages/modules/customers/src/manifest.js';
import { CustomerAccount } from '../../helpers/package-entities.js';

/**
 * `specs/177-tax-id-scope/` T057 (FR-036) — after a conversion the account link
 * is gone, so detaching the member provisions a **new** personal organization
 * for them, and the converted company keeps its id. Detaching its last
 * Administrator is refused (`ORG_OWNER_DEPLETION`, feature 170), so the
 * company gets a second one first.
 */
describe('unassign after a personal → company conversion', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([customersManifest.settings!]);
    await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/settings/customers.allow_registration_without_organization/value',
      cookies: admin,
      payload: { scope: 'all', value: true },
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('gives the member a new personal organization; the company stays', async () => {
    const email = `conv-unassign-${Date.now()}@example.test`;
    const registered = await h.app.inject({
      method: 'POST',
      url: '/api/v1/customers/register',
      payload: { email, password: 'a-very-strong-pass', firstName: 'Conv', lastName: 'Unassign', acceptedTermsVersion: 'v1' },
    });
    expect(registered.statusCode, registered.body).toBeLessThan(300);
    const account = (await h.em().findOne(CustomerAccount, { email }))!;
    const personalId = account.organizationId;

    const converted = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${personalId}/convert-to-company`,
      cookies: admin,
      payload: {
        name: 'Conv Unassign Co',
        taxId: `CU${Date.now().toString().slice(-10)}`,
        registeredAddress: { street: 'ul. Nowa 9', city: 'Łódź', postalCode: '90-001', country: 'PL' },
      },
    });
    expect(converted.statusCode, converted.body).toBe(200);

    // The member is the company's only Administrator now, and the depletion
    // guard (feature 170) keeps a company from losing its last one; a second
    // Administrator joins first, as an operator would arrange.
    const colleague = (await h.em().execute(
      `insert into "customer_accounts"
         ("id","organization_id","email","password_hash","first_name","last_name","organization_role_id","created_at","updated_at")
       values (gen_random_uuid(), ?, ?, 'x', 'Second', 'Admin',
               (select "id" from "organization_roles" where "organization_id" = ? and "kind" = 'administrator'), now(), now())
       returning "id"`,
      [personalId, `conv-unassign-admin-${Date.now()}@example.test`, personalId],
    )) as Array<{ id: string }>;
    expect(colleague).toHaveLength(1);

    const detach = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${account.id}/organization`,
      cookies: admin,
    });
    expect(detach.statusCode, detach.body).toBe(200);
    const newOrganizationId = (detach.json() as { data: { organizationId: string } }).data.organizationId;
    expect(newOrganizationId).not.toBe(personalId);

    const rows = (await h.em().execute(
      'select "id", "is_personal", "personal_account_id" from "organizations" where "id" in (?, ?)',
      [personalId, newOrganizationId],
    )) as Array<{ id: string; is_personal: boolean; personal_account_id: string | null }>;
    expect(rows.find((row) => row.id === personalId)).toMatchObject({ is_personal: false, personal_account_id: null });
    expect(rows.find((row) => row.id === newOrganizationId)).toMatchObject({ is_personal: true, personal_account_id: account.id });
  });
});
