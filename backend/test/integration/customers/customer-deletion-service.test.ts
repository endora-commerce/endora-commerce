import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { SessionService } from '../../../src/modules/auth/services/session-service.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { CustomerAccount } from '../../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { CustomerAuthorityService } from '../../../src/modules/customers/services/customer-authority-service.js';
import { CustomerDeletionService } from '../../../src/modules/customers/services/customer-deletion-service.js';
import { PersonalOrganizationService } from '../../../src/modules/organizations/services/personal-organization-service.js';
import { toOrganizationRecord } from '../../../src/modules/organizations/services/organization-details-port.js';
import { hashPassword } from '../../../src/modules/auth/services/password-hasher.js';
import {
  customerAccountLifecycleWriteFor,
  customerAccountPortsFor,
} from '../../helpers/customer-account-ports.js';
import { CustomerAccountReadService } from '../../../src/modules/customer_accounts/services/customer-account-ports.js';

/**
 * Feature 040, US7 — soft-delete, restore within window, and the permanent
 * anonymization sweep.
 */
describe('CustomerDeletionService', () => {
  let db: TestDb;
  let em: EntityManager;
  let redis: Redis;
  let svc: CustomerDeletionService;
  let personalOrgs: PersonalOrganizationService;
  const actor = { adminUserId: '00000000-0000-4000-8000-00000000b001', isPlatformAdmin: true };

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  beforeEach(async () => {
    em = await db.beginTx();
    const sessions = new SessionService(() => em, redis);
    const audit = new AuditLogService(() => em);
    personalOrgs = new PersonalOrganizationService(
      () => em,
      customerAccountPortsFor(() => em),
      audit,
    );
    svc = new CustomerDeletionService(
      new CustomerAccountReadService(() => em),
      customerAccountLifecycleWriteFor(() => em, audit),
      {
        ensureForCustomerAccount: async (id) =>
          toOrganizationRecord(await personalOrgs.ensureForCustomerAccountId(id)),
        provisionPersonalOrganization: async (id) =>
          toOrganizationRecord(await personalOrgs.provisionPersonalOrganizationFor(id)),
        anonymizeIfOrphaned: async (id) => {
          const org = await personalOrgs.anonymizeIfOrphaned(id);
          return org ? toOrganizationRecord(org) : null;
        },
      },
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      { destroyAllForCustomer: (id: string) => sessions.destroyAllForCustomer(id) },
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await redis.quit();
    await db.close();
  });

  async function makeCustomer(): Promise<CustomerAccount> {
    // D-178 — `customer_accounts.organization_id` is NOT NULL.
    const org = await seedAdHocOrganization(em, 'Deletion Org');
    const c = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `del-${Date.now()}-${Math.floor(performance.now())}@example.test`,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Del',
      lastName: 'Target',
    });
    await em.persistAndFlush(c);
    return c;
  }

  /**
   * The B2C shape: an account standing in its own single-member personal
   * organisation, written the way `createStandalone` writes it since D-178 —
   * organisation first, account second, one transaction.
   */
  async function makePersonalCustomer(): Promise<CustomerAccount> {
    const id = randomUUID();
    const email = `personal-${Date.now()}-${Math.floor(performance.now())}@example.test`;
    const org = await personalOrgs.provisionFor(em, {
      customerAccountId: id,
      email,
      firstName: 'Solo',
      lastName: 'Buyer',
    });
    const c = em.create(CustomerAccount, {
      id,
      organizationId: org.id,
      email,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Solo',
      lastName: 'Buyer',
    });
    await em.persistAndFlush(c);
    return c;
  }

  it('soft-deletes (sets deletedAt + audit) and refuses a second delete', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.deletedAt).not.toBeNull();
    expect(reloaded!.deletionRequestedByAdminUserId).toBe(actor.adminUserId);
    expect(await em.find(AuditLogEntry, { action: 'customer_account.deleted', objectId: c.id })).toHaveLength(1);

    await expect(svc.softDelete(c.id, actor)).rejects.toMatchObject({ code: 'CUSTOMER_ALREADY_DELETED' });
  });

  it('restores within the window and audits', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    await svc.restore(c.id, actor);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.deletedAt).toBeNull();
    expect(await em.find(AuditLogEntry, { action: 'customer_account.restored', objectId: c.id })).toHaveLength(1);
  });

  it('sweep does not anonymize within the retention window', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const count = await svc.sweep(365, new Date());
    expect(count).toBe(0);
    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.anonymizedAt ?? null).toBeNull();
  });

  it('sweep anonymizes after the window; restore then fails', async () => {
    const c = await makeCustomer();
    const originalEmail = c.email;
    await svc.softDelete(c.id, actor);

    // retentionDays 0 with a future "now" puts the cutoff after deletedAt.
    const count = await svc.sweep(0, new Date(Date.now() + 60_000));
    expect(count).toBe(1);

    const reloaded = await em.findOne(CustomerAccount, { id: c.id });
    expect(reloaded!.anonymizedAt).not.toBeNull();
    expect(reloaded!.email).not.toBe(originalEmail);
    expect(reloaded!.email).toContain('anonymized.invalid');
    expect(reloaded!.firstName).toBe('Deleted customer');
    expect(await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: c.id })).toHaveLength(1);

    await expect(svc.restore(c.id, actor)).rejects.toMatchObject({
      code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED',
    });
  });

  it('cascades anonymization to the customer’s orphaned personal org (feature 051 T025)', async () => {
    // D-178 — the account is created *inside* its personal organisation, the
    // shape `createStandalone` writes, rather than created org-less and linked
    // afterwards. `makeCustomer` stands its account in a company organisation,
    // which is the wrong fixture for a cascade that only fires on a personal
    // one, so this case builds the personal pair explicitly.
    const c = await makePersonalCustomer();
    const org = await em.findOneOrFail(Organization, { id: c.organizationId });
    expect(org.isPersonal).toBe(true);

    await svc.softDelete(c.id, actor);
    const count = await svc.sweep(0, new Date(Date.now() + 60_000));
    expect(count).toBe(1);

    const reloadedOrg = await em.findOne(Organization, { id: org.id });
    expect(reloadedOrg!.deletedAt).not.toBeNull();
    expect(reloadedOrg!.name).toBe('Deleted customer');
    expect(reloadedOrg!.registeredAddress.street).toBe('-');
    expect(
      await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id }),
    ).toHaveLength(1);
  });

  it('does NOT cascade to a company org when a member is anonymized', async () => {
    const company = em.create(Organization, {
      name: 'ACME Sp. z o.o.',
      taxId: `C${Date.now()}`,
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: false,
      registeredAddress: { street: 'Main 1', city: 'Warsaw', postalCode: '00-001', country: 'PL' },
    });
    await em.persistAndFlush(company);
    const member = await makeCustomer();
    member.organizationId = company.id;
    // A second admin keeps the org non-orphaned and satisfies the last-admin guard.
    const other = await makeCustomer();
    other.organizationId = company.id;
    await em.flush();

    await svc.softDelete(member.id, actor);
    await svc.sweep(0, new Date(Date.now() + 60_000));

    const reloadedCompany = await em.findOne(Organization, { id: company.id });
    expect(reloadedCompany!.deletedAt ?? null).toBeNull();
    expect(reloadedCompany!.name).toBe('ACME Sp. z o.o.');
  });
});
