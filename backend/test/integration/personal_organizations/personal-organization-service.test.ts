import { randomUUID } from 'node:crypto';
import { Organization } from '../../helpers/package-entities.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';

/**
 * Feature 051 (T005) — PersonalOrganizationService: idempotent provisioning,
 * individual defaults, and the single-member guard.
 *
 * **The fixtures changed shape with D-178** and the change is that ruling in
 * miniature. Every case here used to create a `CustomerAccount` with
 * `organizationId: null` and then ask the service to fill it in — which is
 * exactly the two-unit-of-work order that left durable tenant-less rows behind
 * whenever the second half failed. The column is `NOT NULL` now, so an account
 * cannot be written before its organisation exists, and the fixtures provision
 * first.
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
    svc = new PersonalOrganizationService(
      () => em,
      customerAccountPortsFor(() => em),
    );
  });
  afterEach(async () => db.rollbackTx());
  afterAll(async () => db.close());

  /**
   * An account already standing in its own personal organisation — the shape
   * `createStandalone` writes, in one transaction, since D-178.
   */
  const makePersonalAccount = async (
    over: { email?: string; firstName?: string; lastName?: string } = {},
  ): Promise<CustomerAccount> => {
    const id = randomUUID();
    const email = over.email ?? `p-${Math.random().toString(36).slice(2)}@ex.test`;
    const firstName = over.firstName ?? 'Jan';
    const lastName = over.lastName ?? 'Kowalski';
    const org = await svc.provisionFor(em, {
      customerAccountId: id,
      email,
      firstName,
      lastName,
    });
    const account = em.create(CustomerAccount, {
      id,
      organizationId: org.id,
      email,
      passwordHash: 'x'.repeat(60),
      firstName,
      lastName,
    });
    await em.persistAndFlush(account);
    return account;
  };

  it('provisions a personal org with individual defaults', async () => {
    const account = await makePersonalAccount();
    const org = await em.findOneOrFail(Organization, { id: account.organizationId });

    expect(org.isPersonal).toBe(true);
    expect(org.status).toBe('active');
    expect(org.name).toBe('Jan Kowalski');
    expect(org.vatStatus).toBe('vat_exempt');
    expect(org.taxId).toHaveLength(32);
  });

  it('provisionFor is idempotent by account id — never a second org', async () => {
    const id = randomUUID();
    const input = { customerAccountId: id, email: 'twice@ex.test', firstName: 'A', lastName: 'B' };
    const first = await svc.provisionFor(em, input);
    const second = await svc.provisionFor(em, input);

    expect(second.id).toBe(first.id);
    expect(await em.count(Organization, { taxId: id.replace(/-/g, '') })).toBe(1);
  });

  it('ensureForCustomerAccountId returns the org the account already stands in', async () => {
    const account = await makePersonalAccount();
    const first = await svc.ensureForCustomerAccountId(account.id);
    const second = await svc.ensureForCustomerAccountId(account.id);

    expect(first.id).toBe(account.organizationId);
    expect(second.id).toBe(first.id);
  });

  it('names the org from the email local-part when no first/last name', async () => {
    const account = await makePersonalAccount({
      firstName: '',
      lastName: '',
      email: 'solo@ex.test',
    });
    const org = await em.findOneOrFail(Organization, { id: account.organizationId });
    expect(org.name).toBe('solo');
  });

  it('provisionPersonalOrganizationFor answers the account own org, not its company (D-178)', async () => {
    const company = await seedAdHocOrganization(em, 'ACME');
    const account = em.create(CustomerAccount, {
      organizationId: company.id,
      email: `member-${Date.now()}@ex.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Anna',
      lastName: 'Nowak',
    });
    await em.persistAndFlush(account);

    const personal = await svc.provisionPersonalOrganizationFor(account.id);

    expect(personal.id).not.toBe(company.id);
    expect(personal.isPersonal).toBe(true);
    expect(personal.name).toBe('Anna Nowak');
    // It writes no membership: binding the account is the caller's write.
    await em.refresh(account);
    expect(account.organizationId).toBe(company.id);
  });

  it('rejects attaching a second member to a personal org (single-member invariant)', async () => {
    const a1 = await makePersonalAccount();
    await expect(svc.assertMembershipAllowed(a1.organizationId, em)).rejects.toThrow(
      /single-member/,
    );
  });

  it('allows membership on a company org', async () => {
    const company = em.create(Organization, {
      name: 'ACME',
      taxId: `C${Date.now()}`,
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: false,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(company);
    await expect(svc.assertMembershipAllowed(company.id, em)).resolves.toBeUndefined();
  });
});
