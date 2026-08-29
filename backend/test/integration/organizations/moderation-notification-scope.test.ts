import { EmailDelivery, type EmailDeliveryRow } from '../../helpers/package-entities.js';
import { AdminRole, AdminUser, Organization } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

import { ADMIN_COOKIES } from '../../helpers/test-actors.js';



import { CustomerAccount } from '../../helpers/package-entities.js';



/**
 * Feature 075 (D-87) — the moderation notification finds its recipient under a
 * scoped moderator.
 *
 * The recipient lookup used to be raw SQL against `customer_accounts`, which
 * crossed both the module boundary and the tenant filter without telling
 * anybody. It is `customerAccountReadPort.listByOrganization` now, and
 * `CustomerAccount` is `@OrgScoped` — so the port read carries the acting
 * admin's `TenantContext`.
 *
 * That matters here and nowhere else in the approval path: an organisation
 * awaiting approval has by construction not been assigned to anybody, so a
 * sales representative moderating it has an `allowed-set` context the
 * organisation is **not** in. Read under that filter the lookup finds no
 * members, `notifyCustomer` returns early, and the approval succeeds while the
 * customer is never told — a silent no-op with a 200 in front of it.
 *
 * `withSystemScope` is what stops that, so this is the test that fails if the
 * wrapper is removed. The platform-admin case is the positive control: it has
 * `mode: 'all'`, so it would pass with or without the wrapper and proves only
 * that the fixture can produce a delivery at all.
 */
describe('organizations — the moderation notification crosses tenants (feature 075, D-87)', () => {
  let h: BackendServerHandle;
  let salesRepCookie: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();

    let role = await em.findOne(AdminRole, { code: 'sales_representative' });
    if (!role) {
      role = em.create(AdminRole, {
        code: 'sales_representative',
        name: 'Sales Representative',
        permissions: ['orders:read', 'rfqs:handle', 'customers:manage'],
      });
      await em.persistAndFlush(role);
    } else if (!role.permissions.includes('customers:manage')) {
      role.permissions = [...role.permissions, 'customers:manage'];
      await em.flush();
    }

    const rep = em.create(AdminUser, {
      email: `moderation-scope-rep-${Date.now()}@d87.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role.id,
      firstName: 'D87',
      lastName: 'Rep',
    });
    await em.persistAndFlush(rep);

    // No `OrganizationSalesRepAssignment` on purpose: this rep's allowed set is
    // empty, which is exactly the context a pending organisation is moderated
    // in — nobody is assigned to an organisation that is not approved yet.
    salesRepCookie = `stub-moderation-scope-rep-${Date.now()}`;
    ADMIN_COOKIES[salesRepCookie] = { adminUserId: rep.id };
  });

  afterAll(async () => {
    delete ADMIN_COOKIES[salesRepCookie];
    await teardownBackendServer(h);
  });

  /** A pending organisation plus the `organization_admin` who should be told. */
  const seedPendingOrg = async (
    label: string,
  ): Promise<{ organization: Organization; email: string }> => {
    const em = h.em();
    const organization = em.create(Organization, {
      name: `D87 ${label} Co`,
      taxId: `PL075D87${Date.now().toString().slice(-7)}`,
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Oczekująca 1',
        city: 'Warszawa',
        postalCode: '00-087',
        country: 'PL',
      },
    });
    await em.persistAndFlush(organization);
    const email = `d87-${label}-${Date.now()}@example.test`;
    await em.persistAndFlush(
      em.create(CustomerAccount, {
        organizationId: organization.id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Org',
        lastName: 'Admin',
        role: 'organization_admin',
        emailVerifiedAt: new Date(),
      }),
    );
    return { organization, email };
  };

  const deliveriesTo = async (email: string): Promise<EmailDeliveryRow[]> => {
    const em = h.em();
    em.clear();
    return em.find(EmailDelivery, { recipient: email });
  };

  const approveAs = (cookie: string, organization: Organization) =>
    h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${organization.id}/approve`,
      cookies: { b2b_session: cookie },
      payload: { expectedVersion: organization.version },
    });

  it('tells the organization admin even when the moderator is scoped to no organizations', async () => {
    const { organization, email } = await seedPendingOrg('scoped');

    const res = await approveAs(salesRepCookie, organization);
    expect(res.statusCode).toBe(200);

    const deliveries = await deliveriesTo(email);
    expect(
      deliveries.length,
      'the approval mail was not addressed to the organization admin — the ' +
        'recipient lookup ran under the moderator’s tenant filter',
    ).toBeGreaterThan(0);
  });

  it('positive control — the platform admin path still tells them', async () => {
    const { organization, email } = await seedPendingOrg('unscoped');

    const res = await approveAs('stub-admin-session', organization);
    expect(res.statusCode).toBe(200);

    expect((await deliveriesTo(email)).length).toBeGreaterThan(0);
  });
});
