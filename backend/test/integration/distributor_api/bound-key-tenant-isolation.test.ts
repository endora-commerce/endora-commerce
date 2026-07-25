import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { resolveTenantContext } from '../../../src/tenancy/resolve-tenant-context.js';
import { runWithTenantContext } from '../../../src/tenancy/tenant-context.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * Feature 062 / Phase 1 — Principle XI proof for the bound-key pipeline: the
 * single-org tenant context derived from a bound api key confines every
 * tenant-scoped query to the bound organization. A foreign org's row is
 * indistinguishable from not-found. (The full endpoint-level negative matrix
 * lands with the distributor surface in Phase 2 — SC-002.)
 */

const ISOLATION_ORG_B_ID = '00000000-0000-4000-8000-00000000c0b0';
const ISOLATION_CUSTOMER_B_ID = '00000000-0000-4000-8000-00000000c0b1';

describe('Bound api-key tenant isolation (062 / Principle XI)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const orgB = em.create(Organization, {
      id: ISOLATION_ORG_B_ID,
      name: 'Isolation Org B',
      taxId: 'PL0000000063',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Izolowana 2',
        city: 'Warszawa',
        postalCode: '00-063',
        country: 'PL',
      },
    });
    await em.persistAndFlush(orgB);
    const customerB = em.create(CustomerAccount, {
      id: ISOLATION_CUSTOMER_B_ID,
      organizationId: ISOLATION_ORG_B_ID,
      email: 'isolation-b@example.com',
      passwordHash: 'x',
      firstName: 'Isolation',
      lastName: 'B',
      role: 'regular_user',
      emailVerifiedAt: new Date(),
    });
    await em.persistAndFlush(customerB);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const boundKeyContext = () =>
    resolveTenantContext({
      kind: 'api_key',
      apiKeyId: '00000000-0000-4000-8000-00000000feed',
      organizationId: TEST_ORGANIZATION_ID,
      customerAccountId: TEST_CUSTOMER_ID,
    });

  it('tenant-scoped reads under a bound-key context only see the bound org', async () => {
    await runWithTenantContext(boundKeyContext(), async () => {
      const accounts = await h.em().find(CustomerAccount, {});
      expect(accounts.length).toBeGreaterThan(0);
      for (const account of accounts) {
        expect(account.organizationId).toBe(TEST_ORGANIZATION_ID);
      }
    });
  });

  it("a foreign org's row by id is indistinguishable from not-found", async () => {
    await runWithTenantContext(boundKeyContext(), async () => {
      const foreign = await h.em().findOne(CustomerAccount, { id: ISOLATION_CUSTOMER_B_ID });
      expect(foreign).toBeNull();
    });
  });

  it('the same row IS visible under system scope (control case)', async () => {
    const foreign = await h.em().findOne(CustomerAccount, { id: ISOLATION_CUSTOMER_B_ID });
    expect(foreign).not.toBeNull();
  });
});
