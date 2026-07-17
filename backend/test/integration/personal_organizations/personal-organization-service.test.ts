import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PersonalOrganizationService } from '../../../src/modules/organizations/services/personal-organization-service.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';

/**
 * Feature 051 (T005) — PersonalOrganizationService: idempotent provisioning,
 * individual defaults, and the single-member guard.
 */
describe('PersonalOrganizationService', () => {
  let db: TestDb;
  let em: EntityManager;
  let svc: PersonalOrganizationService;

  beforeAll(async () => {
    db = await setupTestDb();
  });
  beforeEach(async () => {
    em = await db.beginTx();
    svc = new PersonalOrganizationService(() => em);
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  const makeAccount = (over: Partial<CustomerAccount> = {}): CustomerAccount => {
    const a = em.create(CustomerAccount, {
      email: `p-${Math.random().toString(36).slice(2)}@ex.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Jan',
      lastName: 'Kowalski',
      organizationId: null,
      ...over,
    });
    return a;
  };

  it('provisions a personal org with individual defaults and links the account', async () => {
    const account = makeAccount();
    await em.persistAndFlush(account);

    const org = await svc.ensureFor(account, em);

    expect(org.isPersonal).toBe(true);
    expect(org.status).toBe('active');
    expect(org.name).toBe('Jan Kowalski');
    expect(org.vatStatus).toBe('vat_exempt');
    expect(org.taxId).toHaveLength(32);
    expect(account.organizationId).toBe(org.id);
  });

  it('is idempotent by customer — returns the existing org, never a second one', async () => {
    const account = makeAccount();
    await em.persistAndFlush(account);

    const first = await svc.ensureFor(account, em);
    const second = await svc.ensureFor(account, em);

    expect(second.id).toBe(first.id);
    const count = await em.count(Organization, { isPersonal: true });
    expect(count).toBe(1);
  });

  it('names the org from the email local-part when no first/last name', async () => {
    const account = makeAccount({ firstName: '', lastName: '', email: 'solo@ex.test' });
    await em.persistAndFlush(account);
    const org = await svc.ensureFor(account, em);
    expect(org.name).toBe('solo');
  });

  it('rejects attaching a second member to a personal org (single-member invariant)', async () => {
    const a1 = makeAccount();
    await em.persistAndFlush(a1);
    const org = await svc.ensureFor(a1, em);

    await expect(svc.assertMembershipAllowed(org.id, em)).rejects.toThrow(/single-member/);
  });

  it('allows membership on a company org', async () => {
    const company = em.create(Organization, {
      name: 'ACME', taxId: `C${Date.now()}`, status: 'active', vatStatus: 'vat_payer',
      isPersonal: false, registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(company);
    await expect(svc.assertMembershipAllowed(company.id, em)).resolves.toBeUndefined();
  });
});
