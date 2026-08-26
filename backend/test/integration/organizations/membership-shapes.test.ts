import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';

/**
 * Feature 026 US2 — Customer↔Organization membership shapes.
 *
 * Covers:
 *  1. Multiple Customer accounts can be attached to the same Organization
 *     (the multi-decision-maker binding the spec promises). Both members
 *     resolve to the same commercial party (same `organizationId` lookup).
 *  2. A Customer account can exist with no Organization (nullable column
 *     introduced by migration 049). The OrganizationContextService
 *     gracefully handles the missing organization in `loadEffectiveOrganization`.
 *
 * What this test does NOT cover (deferred to a future slice):
 *  - The full no-org checkout path (Order.organizationId stays NOT NULL).
 *  - The cart-level fall-back to platform defaults for a no-org Customer
 *    (the cart-actor resolver already supports it; storefront UX-level
 *    tests live in a Playwright slice we have not staffed yet).
 */
describe('Customer↔Organization membership shapes (feature 026 US2)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('allows multiple Customer accounts attached to the same Organization', async () => {
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Multi-Decision-Maker Co',
      taxId: `PL026MDM${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Decyzyjna 1',
        city: 'Warszawa',
        postalCode: '00-010',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);

    const password = await hashPassword('TestPassword12345');
    const memberA = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `anna+${Date.now()}@us2-test.local`,
      passwordHash: password,
      firstName: 'Anna',
      lastName: 'Decydent',
      role: 'organization_admin',
    });
    const memberB = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `bartek+${Date.now()}@us2-test.local`,
      passwordHash: password,
      firstName: 'Bartek',
      lastName: 'Aprobant',
      role: 'regular_user',
    });
    await em.persistAndFlush([memberA, memberB]);

    em.clear();

    // Both members should resolve to the same Organization id.
    const reloadedA = await em.findOneOrFail(CustomerAccount, { id: memberA.id });
    const reloadedB = await em.findOneOrFail(CustomerAccount, { id: memberB.id });
    expect(reloadedA.organizationId).toBe(org.id);
    expect(reloadedB.organizationId).toBe(org.id);

    // The shared commercial party (resolved via OrganizationContextService)
    // is identical for both — same instance after a fresh load.
    const orgForA = await h.organizations.organizationContextService.loadEffectiveOrganization(
      reloadedA.organizationId!,
    );
    const orgForB = await h.organizations.organizationContextService.loadEffectiveOrganization(
      reloadedB.organizationId!,
    );
    expect(orgForA?.id).toBe(org.id);
    expect(orgForB?.id).toBe(org.id);
    expect(orgForA?.status).toBe('active');
    expect(orgForA?.id).toBe(orgForB?.id);
  });

  it('refuses a Customer account with no Organization (D-178 — the column is NOT NULL)', async () => {
    const em = h.em();
    const password = await hashPassword('TestPassword12345');
    // Feature 026 US2 relaxed this column and this case asserted the relaxation.
    // D-178 reversed it: an individual is backed by a personal organisation, so
    // there is no account without a tenant and the column is what refuses one.
    // The refusal has to be measured at the database, because MikroORM applies
    // its tenant filter to SELECT / UPDATE / DELETE and not to INSERT — nothing
    // in the guard can see this statement.
    await expect(
      em.execute(
        'insert into customer_accounts (id, organization_id, email, password_hash, first_name, last_name, role) ' +
          'values (gen_random_uuid(), null, ?, ?, ?, ?, ?)',
        [`solo+${Date.now()}@us2-test.local`, password, 'Solo', 'Buyer', 'regular_user'],
      ),
    ).rejects.toThrow(/not-null|not null/i);
  });
});
