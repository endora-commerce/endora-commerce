import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from '../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import {
  TEST_CUSTOMER_EMPTY_ID,
  TEST_CUSTOMER_ID,
  TEST_CUSTOMER_RFQ_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';

/**
 * Seeds the Organization + CustomerAccount rows that back the stub-session
 * cookies. Every test that uses `requireCustomer` or `resolveCustomerContext`
 * now hits a real DB row — keeps the stub flow compatible with the production
 * auth contract.
 *
 * The test password `stub-password-change-me-1234` is argon2-hashed only once
 * per test run (vitest singleFork) so this is cheap.
 */

export const STUB_CUSTOMER_PASSWORD = 'stub-password-change-me-1234';

/**
 * The seeded organization's tax id. Exported because the VAT fake has to agree
 * with it: this row is seeded `vatStatus: 'vat_payer'`, so a validator that
 * answers `failed` for it contradicts the fixture it is validating.
 */
export const TEST_ORGANIZATION_TAX_ID = 'PL0000000099';

export async function seedTestOrganizations(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);

  const org = em.create(Organization, {
    id: TEST_ORGANIZATION_ID,
    name: 'Test Organization',
    taxId: TEST_ORGANIZATION_TAX_ID,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Testowa 99',
      city: 'Warszawa',
      postalCode: '00-900',
      country: 'PL',
    },
  });
  await em.persistAndFlush(org);

  const admin = em.create(CustomerAccount, {
    id: TEST_CUSTOMER_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'stub-customer@example.com',
    passwordHash,
    firstName: 'Stub',
    lastName: 'Customer',
    role: 'organization_admin',
    emailVerifiedAt: new Date(),
  });
  const rfq = em.create(CustomerAccount, {
    id: TEST_CUSTOMER_RFQ_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'stub-customer-rfq@example.com',
    passwordHash,
    firstName: 'Stub',
    lastName: 'RFQ',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  const empty = em.create(CustomerAccount, {
    id: TEST_CUSTOMER_EMPTY_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'stub-customer-empty@example.com',
    passwordHash,
    firstName: 'Stub',
    lastName: 'Empty',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush([admin, rfq, empty]);
}
