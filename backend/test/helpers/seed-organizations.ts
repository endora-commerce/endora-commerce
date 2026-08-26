import type { EntityManager } from '@mikro-orm/postgresql';
import { Organization } from './package-entities.js';
import { CustomerAccount } from './package-entities.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
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

/**
 * A throwaway company Organization, for a fixture that needs a tenant rather
 * than a particular one.
 *
 * It exists because D-178 made `customer_accounts.organization_id` `NOT NULL`:
 * a fixture that used to write an account and nothing else now has to write the
 * tenant that scopes it, and duplicating six lines of address placeholder per
 * test file is how those six lines come to disagree.
 *
 * The tax id is unique per call — the column is globally `@Unique` — and derived
 * from the clock rather than from a counter, so two files seeding inside one
 * run do not collide.
 */
export async function seedAdHocOrganization(
  em: EntityManager,
  name = 'Fixture Organization',
): Promise<Organization> {
  const org = em.create(Organization, {
    name,
    taxId: `PL${String(Math.floor(performance.now() * 1000)).slice(-8).padStart(8, '0')}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`,
    status: 'active',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Testowa 1',
      city: 'Warszawa',
      postalCode: '00-001',
      country: 'PL',
    },
  });
  await em.persistAndFlush(org);
  return org;
}
