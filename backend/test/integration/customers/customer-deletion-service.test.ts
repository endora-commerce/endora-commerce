import { randomUUID } from 'node:crypto';
import { Organization } from '../../helpers/package-entities.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { AdminUser } from '../../helpers/package-entities.js';
import { SessionService } from '@endora-commerce/mod-auth/backend';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { CustomerAuthorityService } from '../../../../packages/modules/customers/src/backend/services/customer-authority-service.js';
import {
  CustomerDeletionService,
  type AnonymizedHistoryDeps,
} from '../../../../packages/modules/customers/src/backend/services/customer-deletion-service.js';
import { AddressBookRetirementService } from '../../../../packages/modules/customers/src/backend/services/address-book-retirement-service.js';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { toOrganizationRecord } from '../../../../packages/modules/organizations/src/backend/services/organization-details-port.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import {
  customerAccountPortsFor,
  personalOrganizationProvisionFor,
} from '../../helpers/customer-account-ports.js';
import type {
  AddressServicePort,
  CustomerAccountLifecycleWritePort,
  PersonalOrganizationPort,
} from '@endora-commerce/contracts';
// `dist`, not `src` (feature 146): see `test/helpers/customer-account-ports.ts` —
// a source-evaluated `CustomerAccount` makes `QuoteRequestAccountPolicy`'s
// transitive parent ambiguous and the ORM refuses to initialise.
import { CustomerAccountReadService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import { CustomerAccountLifecycleWriteService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-lifecycle-ports.js';
import { twoFactorEnrolmentsFor } from '../../helpers/two-factor-enrolments.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
import { OrganizationDepletionGuard } from '../../../../packages/modules/customers/src/backend/services/organization-depletion-guard.js';
import { Address, Order } from '../../helpers/package-entities.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { AddressService } from '../../../../packages/modules/addresses/src/backend/services/address-service.js';
import {
  AddressReadService,
  createAddressServicePort,
} from '../../../../packages/modules/addresses/src/backend/services/address-ports.js';
import { AuditRedactionService } from '@endora-commerce/platform/composition';
import { AUDIT_ERASED_MARKER } from '@endora-commerce/contracts';
import { CustomerAddress } from '../../helpers/package-entities.js';

/** Step 3 (issue #844) as a no-op, for the cases about the other steps. */
const NO_HISTORY: AnonymizedHistoryDeps = {
  redaction: { redact: async () => ({ rowsInScope: 0, rowsChanged: 0, markerWritten: false }) },
  addressReads: { listIdsForOrganization: async () => [] },
  retiredAddressBook: { listIdsForAccount: async () => [] },
};

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
  let addresses: ReturnType<typeof createAddressServicePort>;
  const actor = { adminUserId: '00000000-0000-4000-8000-00000000b001', isPlatformAdmin: true };

  beforeAll(async () => {
    db = await setupTestDb();
    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  });

  let audit: AuditLogService;
  let accountWrites: CustomerAccountLifecycleWritePort;
  let organizationRoles: {
    predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') => Promise<string>;
  };
  let accounts: CustomerAccountReadService;
  let sessions: SessionService;
  /** `customer_account.anonymized.v1`, as `customer_accounts` announces it. */
  let anonymizedEvents: string[];

  /** `organizations`' port over a given service, the shape `index.ts` publishes. */
  function personalOrganizationPortOver(orgs: PersonalOrganizationService): PersonalOrganizationPort {
    return {
      ensureForCustomerAccount: async (id) =>
        toOrganizationRecord(await orgs.ensureForCustomerAccountId(id)),
      provisionPersonalOrganization: async (id) => {
        const org = await orgs.provisionPersonalOrganizationFor(id);
        return { ...toOrganizationRecord(org), administratorRoleId: await predefinedRoleIdOf(em, org.id, 'administrator') };
      },
      anonymizeIfOrphaned: async (id) => {
        const org = await orgs.anonymizeIfOrphaned(id);
        return org ? toOrganizationRecord(org) : null;
      },
      listIncompletelyScrubbed: () => orgs.listIncompletelyScrubbed(),
      hasIncompletelyScrubbed: () => orgs.hasIncompletelyScrubbed(),
    };
  }

  /**
   * The service over the real owners, with any one of the three cascade ports
   * swapped — which is how a crash between two of the sweep's writes is staged.
   */
  function buildService(overrides: {
    accountWrites?: CustomerAccountLifecycleWritePort;
    personalOrganizations?: PersonalOrganizationPort;
    addresses?: Pick<AddressServicePort, 'anonymizeForOrganization'>;
    history?: AnonymizedHistoryDeps;
  } = {}): CustomerDeletionService {
    return new CustomerDeletionService(
      accounts,
      overrides.accountWrites ?? accountWrites,
      overrides.personalOrganizations ?? personalOrganizationPortOver(personalOrgs),
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      { destroyAllForCustomer: (id: string) => sessions.destroyAllForCustomer(id) },
      // `specs/170-organization-roles/` WP-03 (T120) — the guard against deleting
      // a company Organization's last administrator.
      new OrganizationDepletionGuard({
        accounts,
        organizations: {
          findById: async (id) => {
            const org = await em.findOne(Organization, { id });
            return org ? toOrganizationRecord(org) : null;
          },
        },
        organizationRoles,
      }),
      // `specs/173-b2c-address-book-merge/` OD-7 — the scrubbed personal
      // Organization's saved addresses go with it.
      overrides.addresses ?? addresses,
      // `customers.deletion_retention_days`, at its default (issue #800).
      async () => 365,
      // Issue #844 — the subject's audit history; the cases about it pass the
      // real redaction, the rest a no-op.
      overrides.history ?? NO_HISTORY,
    );
  }

  beforeEach(async () => {
    em = await db.beginTx();
    sessions = new SessionService(() => em, redis);
    audit = new AuditLogService(() => em);
    addresses = createAddressServicePort(() => new AddressService(() => em, undefined, audit));
    personalOrgs = new PersonalOrganizationService(
      () => em,
      customerAccountPortsFor(() => em),
      audit,
    );
    organizationRoles = { predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') => predefinedRoleIdOf(em, organizationId, kind) };
    accounts = new CustomerAccountReadService(() => em, twoFactorEnrolmentsFor(() => em, 'customer'), organizationRoles);
    anonymizedEvents = [];
    accountWrites = new CustomerAccountLifecycleWriteService(
      () => em,
      audit,
      twoFactorEnrolmentsFor(() => em, 'customer'),
      personalOrganizationProvisionFor(() => em),
      undefined,
      async (event) => {
        anonymizedEvents.push(event.customerAccountId);
      },
    );
    svc = buildService();
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

  it('T-I7 — blanks and soft-deletes the scrubbed personal organization’s addresses (spec 173, OD-7)', async () => {
    const c = await makePersonalCustomer();
    const input = {
      recipientName: 'Solo Buyer',
      street: 'ul. Prywatna 7',
      city: 'Kraków',
      postalCode: '30-001',
      country: 'PL',
      phone: '+48 700 800 900',
    };
    const delivery = await addresses.createAddress(c.organizationId, { ...input, kind: 'delivery', isDefault: true });
    const billing = await addresses.createAddress(c.organizationId, { ...input, kind: 'billing' });
    // An order placed to both, whose snapshots are copies of the saved addresses.
    const snapshot = (a: typeof delivery) => ({
      recipientName: a.recipientName,
      street: a.street,
      city: a.city,
      postalCode: a.postalCode,
      country: a.country,
      phone: a.phone,
    });
    const order = em.create(Order, {
      organizationId: c.organizationId,
      placedByCustomerAccountId: c.id,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'new',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: snapshot(delivery),
      billingAddress: snapshot(billing),
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '10.00',
      taxTotal: '2.30',
      deliveryTotal: '0.00',
      total: '12.30',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    const before = { delivery: structuredClone(order.deliveryAddress), billing: structuredClone(order.billingAddress) };

    await svc.softDelete(c.id, actor);
    expect(await svc.sweep(0, new Date(Date.now() + 60_000))).toBe(1);

    em.clear();
    for (const id of [delivery.id, billing.id]) {
      const row = await em.findOneOrFail(Address, { id });
      expect(row).toMatchObject({
        recipientName: '-',
        street: '-',
        city: '-',
        postalCode: '-',
        country: 'PL',
        isDefault: false,
      });
      expect(row.phone ?? null).toBeNull();
      expect(row.deletedAt).toBeInstanceOf(Date);
      const entries = await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: id });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    }
    // The order's snapshots are copies on `orders`' own row and stay as they were.
    const reloaded = await em.findOneOrFail(Order, { id: order.id });
    expect(reloaded.deliveryAddress).toEqual(before.delivery);
    expect(reloaded.billingAddress).toEqual(before.billing);
    expect(reloaded.deliveryAddress).toMatchObject({ street: 'ul. Prywatna 7', recipientName: 'Solo Buyer' });
  });

  it('a second sweep leaves an already-scrubbed personal organization’s addresses alone', async () => {
    const c = await makePersonalCustomer();
    const created = await addresses.createAddress(c.organizationId, {
      kind: 'delivery',
      recipientName: 'Solo Buyer',
      street: 'ul. Prywatna 7',
      city: 'Kraków',
      postalCode: '30-001',
      country: 'PL',
    });
    await svc.softDelete(c.id, actor);
    await svc.sweep(0, new Date(Date.now() + 60_000));
    await svc.sweep(0, new Date(Date.now() + 120_000));
    expect(await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: created.id })).toHaveLength(1);
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
    // The role moves with the Organization: the composite foreign key refuses
    // the old one (`specs/170-organization-roles/` WP-02b).
    const companyMember = await predefinedRoleIdOf(em, company.id, 'member');
    member.organizationId = company.id;
    member.organizationRoleId = companyMember;
    // A second admin keeps the org non-orphaned and satisfies the last-admin guard.
    const other = await makeCustomer();
    other.organizationId = company.id;
    other.organizationRoleId = companyMember;
    await em.flush();

    await svc.softDelete(member.id, actor);
    await svc.sweep(0, new Date(Date.now() + 60_000));

    const reloadedCompany = await em.findOne(Organization, { id: company.id });
    expect(reloadedCompany!.deletedAt ?? null).toBeNull();
    expect(reloadedCompany!.name).toBe('ACME Sp. z o.o.');
    expect(await em.find(AuditLogEntry, { action: 'address.anonymized' })).toEqual([]);
  });

  // --- issue #800: the cascade is restartable ---------------------------------
  //
  // The account's `anonymizedAt` is the cascade's commit marker and is written
  // last: until it commits the account is still on the sweep's work list, and
  // every step before it converges, so the next tick finishes what a crash
  // left. A crash is staged by wrapping one port so its first call throws.

  const after = (ms: number) => new Date(Date.now() + ms);

  /** `fn` throws on its first call and delegates from then on. */
  function crashOnce<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    let crashed = false;
    return async (...args: A) => {
      if (!crashed) {
        crashed = true;
        throw new Error('simulated crash');
      }
      return fn(...args);
    };
  }

  /**
   * `target` with some methods replaced. A Proxy rather than a spread: the
   * port is a class instance, whose methods live on its prototype and use
   * private fields, so a spread copies none of them.
   */
  function overriding<T extends object>(target: T, replaced: Partial<T>): T {
    return new Proxy(target, {
      get(t, key) {
        if (key in replaced) return replaced[key as keyof T];
        const value: unknown = Reflect.get(t, key, t);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(t) : value;
      },
    });
  }

  async function makePersonalCustomerWithAddresses(): Promise<{ customer: CustomerAccount; addressIds: string[] }> {
    const customer = await makePersonalCustomer();
    const input = {
      recipientName: 'Solo Buyer',
      street: 'ul. Prywatna 7',
      city: 'Kraków',
      postalCode: '30-001',
      country: 'PL',
      phone: '+48 700 800 900',
    };
    const delivery = await addresses.createAddress(customer.organizationId, { ...input, kind: 'delivery', isDefault: true });
    const billing = await addresses.createAddress(customer.organizationId, { ...input, kind: 'billing' });
    return { customer, addressIds: [delivery.id, billing.id] };
  }

  async function expectFullyAnonymized(customer: CustomerAccount, addressIds: string[]): Promise<void> {
    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.anonymizedAt).toBeInstanceOf(Date);
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    expect(org.name).toBe('Deleted customer');
    expect(org.registeredAddress).toMatchObject({ street: '-', city: '-', postalCode: '-' });
    expect(org.deletedAt).toBeInstanceOf(Date);
    for (const id of addressIds) {
      const row = await em.findOneOrFail(Address, { id });
      expect(row).toMatchObject({ recipientName: '-', street: '-', city: '-', postalCode: '-' });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: id })).toHaveLength(1);
    }
    expect(
      await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id }),
    ).toHaveLength(1);
    expect(
      await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: customer.id }),
    ).toHaveLength(1);
  }

  it('I-1 — a crash at the address step is finished by the next sweep (#800)', async () => {
    const { customer, addressIds } = await makePersonalCustomerWithAddresses();
    await svc.softDelete(customer.id, actor);

    const crashing = buildService({
      addresses: { anonymizeForOrganization: crashOnce((id: string) => addresses.anonymizeForOrganization(id)) },
    });
    await expect(crashing.sweep(0, after(60_000))).rejects.toThrow();

    em.clear();
    // Still on the work list: the marker is the last write.
    expect((await em.findOneOrFail(CustomerAccount, { id: customer.id })).anonymizedAt ?? null).toBeNull();
    expect((await em.findOneOrFail(Organization, { id: customer.organizationId })).name).toBe('Deleted customer');
    for (const id of addressIds) {
      expect((await em.findOneOrFail(Address, { id })).deletedAt ?? null).toBeNull();
    }

    expect(await svc.sweep(0, after(120_000))).toBe(1);
    await expectFullyAnonymized(customer, addressIds);
  });

  it('I-2 — a crash at the organization step is finished by the next sweep', async () => {
    const { customer, addressIds } = await makePersonalCustomerWithAddresses();
    await svc.softDelete(customer.id, actor);

    const real = personalOrganizationPortOver(personalOrgs);
    const crashing = buildService({
      personalOrganizations: { ...real, anonymizeIfOrphaned: crashOnce(real.anonymizeIfOrphaned) },
    });
    await expect(crashing.sweep(0, after(60_000))).rejects.toThrow();

    expect(await svc.sweep(0, after(120_000))).toBe(1);
    await expectFullyAnonymized(customer, addressIds);
  });

  it('I-3 — a crash at the account step re-runs the cascade without a second audit row', async () => {
    const { customer, addressIds } = await makePersonalCustomerWithAddresses();
    await svc.softDelete(customer.id, actor);

    const crashing = buildService({
      accountWrites: overriding(accountWrites, {
        anonymize: crashOnce((id: string) => accountWrites.anonymize(id)),
      }),
    });
    await expect(crashing.sweep(0, after(60_000))).rejects.toThrow();

    expect(await svc.sweep(0, after(120_000))).toBe(1);
    await expectFullyAnonymized(customer, addressIds);
    expect(anonymizedEvents).toEqual([customer.id]);
  });

  it('I-4 — a personal organization an operator already soft-deleted is still scrubbed', async () => {
    const { customer, addressIds } = await makePersonalCustomerWithAddresses();
    const operatorDeletedAt = new Date('2026-01-02T03:04:05.000Z');
    // What `DELETE /api/v1/admin/organizations/:id` writes: `deletedAt` only.
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.deletedAt = operatorDeletedAt;
    await em.flush();
    await svc.softDelete(customer.id, actor);

    expect(await svc.sweep(0, after(60_000))).toBe(1);
    await expectFullyAnonymized(customer, addressIds);
    const reloaded = await em.findOneOrFail(Organization, { id: customer.organizationId });
    expect(reloaded.deletedAt!.toISOString()).toBe(operatorDeletedAt.toISOString());
  });

  it('I-5 — restore is refused once the retention window has elapsed, even before the sweep', async () => {
    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const row = await em.findOneOrFail(CustomerAccount, { id: c.id });
    row.deletedAt = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    await em.flush();

    await expect(svc.restore(c.id, actor)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED',
    });
    em.clear();
    expect((await em.findOneOrFail(CustomerAccount, { id: c.id })).deletedAt).toBeInstanceOf(Date);
    expect(await em.find(AuditLogEntry, { action: 'customer_account.restored', objectId: c.id })).toEqual([]);
  });

  it('I-6 — the organization scrub and its audit row commit together', async () => {
    const customer = await makePersonalCustomer();
    await svc.softDelete(customer.id, actor);
    const failingAudit = {
      record: async () => {
        throw new Error('audit unavailable');
      },
      recordWithin: () => {
        throw new Error('audit unavailable');
      },
    } as unknown as AuditLogService;
    const orgs = new PersonalOrganizationService(() => em, customerAccountPortsFor(() => em), failingAudit);

    await expect(orgs.anonymizeIfOrphaned(customer.id)).rejects.toThrow('audit unavailable');

    em.clear();
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    // A personal organisation is provisioned with a `-` registered address, so
    // the name and `deletedAt` are what the rolled-back scrub would have moved.
    expect(org.name).toBe('Solo Buyer');
    expect(org.deletedAt ?? null).toBeNull();
    expect(await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id })).toEqual([]);
  });

  it('I-7 — an account that keeps failing does not starve the rest of the sweep', async () => {
    const poison = await makePersonalCustomer();
    const healthy = await makePersonalCustomerWithAddresses();
    await svc.softDelete(poison.id, actor);
    await svc.softDelete(healthy.customer.id, actor);

    const failing = buildService({
      accountWrites: overriding(accountWrites, {
        anonymize: async (id: string) => {
          if (id === poison.id) throw new Error('poison');
          return accountWrites.anonymize(id);
        },
      }),
    });
    const error = await failing.sweep(0, after(60_000)).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).toContain(poison.id);
    expect(error!.message).not.toContain(healthy.customer.id);

    await expectFullyAnonymized(healthy.customer, healthy.addressIds);
    expect((await em.findOneOrFail(CustomerAccount, { id: poison.id })).anonymizedAt ?? null).toBeNull();
  });

  // --- issue #802: the scrub reaches every field that can hold the person ----
  //
  // A personal organisation has one person behind it, so its legal name, its
  // order-confirmation recipients and every custom field value are that
  // person's data (owner ruling Q1, 2026-11-06), as are the account's own
  // custom field values. The two audit rows describing the scrub keep only
  // non-personal facts about what it erased (owner ruling Q2).

  /** A personal customer whose organisation and account carry every field the scrub must reach. */
  async function makeFullyPopulatedPersonalCustomer(): Promise<CustomerAccount> {
    const customer = await makePersonalCustomer();
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.legalName = 'Solo Buyer Handel';
    org.orderConfirmationEmails = ['solo.buyer@example.test', 'solo.private@example.test'];
    org.customFieldValues = { nickname: 'Solo', loyalty_card: 'LC-777' };
    customer.customFieldValues = { birthday: '1990-01-01', shoe_size: 44 };
    await em.flush();
    return customer;
  }

  async function auditRow(action: string, objectId: string): Promise<AuditLogEntry> {
    const rows = await em.find(AuditLogEntry, { action, objectId });
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it('I-8 — the sweep clears the personal organization’s legal name, confirmation e-mails and custom fields (#802)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    await svc.softDelete(customer.id, actor);

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    expect(org.legalName ?? null).toBeNull();
    expect(org.orderConfirmationEmails).toEqual([]);
    expect(org.customFieldValues).toEqual({});
    expect(org.name).toBe('Deleted customer');
    expect(org.nameSearch).toBe('deleted customer');
  });

  it('I-9 — the sweep clears every custom field value on the anonymised account (#802, Q1)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    await svc.softDelete(customer.id, actor);

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.anonymizedAt).toBeInstanceOf(Date);
    expect(account.customFieldValues).toEqual({});
  });

  it('I-10 — organization.anonymized records non-personal facts only (#802, Q2)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    await svc.softDelete(customer.id, actor);

    await svc.sweep(0, after(60_000));

    const row = await auditRow('organization.anonymized', customer.organizationId);
    expect(row.stateBefore).toEqual({
      wasDeleted: false,
      hadLegalName: true,
      orderConfirmationEmailCount: 2,
      customFieldKeys: ['loyalty_card', 'nickname'],
      hadBlockedReason: false,
      hadRejectedReason: false,
    });
    const serialized = JSON.stringify([row.stateBefore, row.stateAfter]);
    for (const personal of ['Solo Buyer', 'solo.buyer@example.test', 'LC-777']) {
      expect(serialized).not.toContain(personal);
    }
  });

  it('I-11 — customer_account.anonymized does not store the e-mail it erased (#802, Q2)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    const email = customer.email;
    await svc.softDelete(customer.id, actor);

    await svc.sweep(0, after(60_000));

    const row = await auditRow('customer_account.anonymized', customer.id);
    const serialized = JSON.stringify([row.stateBefore, row.stateAfter]);
    expect(serialized).not.toContain(email);
    expect(serialized).not.toContain('Solo');
    expect(serialized).not.toContain('1990-01-01');
    expect(row.stateBefore).toEqual({
      anonymizedAt: null,
      customFieldKeys: ['birthday', 'shoe_size'],
      hadBlockReason: false,
    });
  });

  it('I-12 — an organization scrubbed before #802 is finished by the next run, keeping its deletedAt', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    // What the scrub wrote before this change: the name, the address and
    // `deletedAt`, with the three new fields left as they were.
    const scrubbedAt = new Date('2026-02-03T04:05:06.000Z');
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.name = 'Deleted customer';
    org.registeredAddress = { ...org.registeredAddress, street: '-', city: '-', postalCode: '-' };
    org.deletedAt = scrubbedAt;
    await em.flush();
    await svc.softDelete(customer.id, actor);

    const answered = await personalOrgs.anonymizeIfOrphaned(customer.id);
    expect(answered?.id).toBe(org.id);

    em.clear();
    const reloaded = await em.findOneOrFail(Organization, { id: org.id });
    expect(reloaded.legalName ?? null).toBeNull();
    expect(reloaded.orderConfirmationEmails).toEqual([]);
    expect(reloaded.customFieldValues).toEqual({});
    expect(reloaded.deletedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    const row = await auditRow('organization.anonymized', org.id);
    expect(row.stateBefore).toMatchObject({ wasDeleted: true, hadLegalName: true });

    // And converged: a second call writes nothing and records nothing more.
    await personalOrgs.anonymizeIfOrphaned(customer.id);
    expect(await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id })).toHaveLength(1);
    // Nor does the sweep, which now reaches the organisation as well (#923):
    // it anonymises the account and finds nothing left on the organisation.
    expect(await svc.sweep(0, after(60_000))).toBe(1);
    expect(await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id })).toHaveLength(1);
  });

  it('I-13 — the account scrub and its audit row commit together, and nothing is announced (#802)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    // Captured now: the test's one EntityManager shares its instances with the
    // service's transaction, so the rolled-back scrub is still visible on them.
    const email = customer.email;
    await svc.softDelete(customer.id, actor);
    const failingAudit = {
      record: async () => {
        throw new Error('audit unavailable');
      },
      recordWithin: () => {
        throw new Error('audit unavailable');
      },
    } as unknown as AuditLogService;
    const emitted: string[] = [];
    const writes = new CustomerAccountLifecycleWriteService(
      () => em,
      failingAudit,
      twoFactorEnrolmentsFor(() => em, 'customer'),
      personalOrganizationProvisionFor(() => em),
      undefined,
      async (event) => {
        emitted.push(event.customerAccountId);
      },
    );

    await expect(writes.anonymize(customer.id)).rejects.toThrow('audit unavailable');

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.anonymizedAt ?? null).toBeNull();
    expect(account.email).toBe(email);
    expect(account.firstName).toBe('Solo');
    expect(account.customFieldValues).toEqual({ birthday: '1990-01-01', shoe_size: 44 });
    expect(emitted).toEqual([]);
    // Still due, so the next tick retries it.
    const due = await accountWrites.listDueForAnonymization(after(60_000));
    expect(due.map((d) => d.id)).toContain(customer.id);
  });

  it('I-14 — the anonymisation event is announced after the scrub and its audit row are written (#802)', async () => {
    const customer = await makeFullyPopulatedPersonalCustomer();
    await svc.softDelete(customer.id, actor);
    const seenAtEmit: Array<{ anonymized: boolean; auditRows: number }> = [];
    const writes = new CustomerAccountLifecycleWriteService(
      () => em,
      audit,
      twoFactorEnrolmentsFor(() => em, 'customer'),
      personalOrganizationProvisionFor(() => em),
      undefined,
      async (event) => {
        // Read from the database, not from the instance the service holds.
        const [row] = await em.execute<Array<{ anonymized_at: Date | string | null }>>(
          'select anonymized_at from customer_accounts where id = ?',
          [event.customerAccountId],
        );
        seenAtEmit.push({
          anonymized: row?.anonymized_at != null,
          auditRows: await em.count(AuditLogEntry, {
            action: 'customer_account.anonymized',
            objectId: event.customerAccountId,
          }),
        });
        throw new Error('subscriber failed');
      },
    );

    // A failing subscriber is reported, but cannot undo a committed scrub.
    await expect(writes.anonymize(customer.id)).rejects.toThrow('subscriber failed');
    expect(seenAtEmit).toEqual([{ anonymized: true, auditRows: 1 }]);

    em.clear();
    expect((await em.findOneOrFail(CustomerAccount, { id: customer.id })).anonymizedAt).toBeInstanceOf(Date);
    expect(
      await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: customer.id }),
    ).toHaveLength(1);
  });

  // --- issue #843: operator-written reasons about the customer ---------------
  //
  // A block or rejection reason is free text an operator wrote about the
  // person, so the scrub erases it: `null`, which every reader already takes
  // for "no reason given". The block or rejection itself — its status, dates
  // and who applied it — stays, and the audit rows record only that a reason
  // existed, never its text.

  const ORG_BLOCK_REASON = 'Solo Buyer abused the returns policy';
  const ORG_REJECT_REASON = 'Solo Buyer sent a forged VAT certificate';
  const ACCOUNT_BLOCK_REASON = 'Solo Buyer insulted the support team';

  /** Stamps a block with a reason on the account and a block and a rejection on its organisation. */
  async function withOperatorReasons(customer: CustomerAccount): Promise<{ blockedAt: Date; rejectedAt: Date }> {
    const blockedAt = new Date('2026-03-04T05:06:07.000Z');
    const rejectedAt = new Date('2026-02-01T00:00:00.000Z');
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.status = 'blocked';
    org.blockedAt = blockedAt;
    org.blockedReason = ORG_BLOCK_REASON;
    org.rejectedAt = rejectedAt;
    org.rejectedReason = ORG_REJECT_REASON;
    customer.blockedAt = blockedAt;
    customer.blockSource = 'staff';
    customer.blockReason = ACCOUNT_BLOCK_REASON;
    await em.flush();
    return { blockedAt, rejectedAt };
  }

  function expectNoReasonText(row: AuditLogEntry): void {
    const serialized = JSON.stringify([row.stateBefore, row.stateAfter]);
    for (const reason of [ORG_BLOCK_REASON, ORG_REJECT_REASON, ACCOUNT_BLOCK_REASON]) {
      expect(serialized).not.toContain(reason);
    }
  }

  it('I-15 — the sweep erases the personal organization’s block and rejection reasons, keeping the state (#843)', async () => {
    const customer = await makePersonalCustomer();
    const { blockedAt, rejectedAt } = await withOperatorReasons(customer);
    await svc.softDelete(customer.id, actor);

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    expect(org.blockedReason ?? null).toBeNull();
    expect(org.rejectedReason ?? null).toBeNull();
    expect(org.status).toBe('blocked');
    expect(org.blockedAt!.toISOString()).toBe(blockedAt.toISOString());
    expect(org.rejectedAt!.toISOString()).toBe(rejectedAt.toISOString());
    const row = await auditRow('organization.anonymized', org.id);
    expect(row.stateBefore).toMatchObject({ hadBlockedReason: true, hadRejectedReason: true });
    expectNoReasonText(row);
  });

  it('I-16 — the sweep erases the account’s block reason, keeping the block (#843)', async () => {
    const customer = await makePersonalCustomer();
    const { blockedAt } = await withOperatorReasons(customer);
    await svc.softDelete(customer.id, actor);

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.blockReason ?? null).toBeNull();
    expect(account.blockedAt!.toISOString()).toBe(blockedAt.toISOString());
    expect(account.blockSource).toBe('staff');
    const row = await auditRow('customer_account.anonymized', customer.id);
    expect(row.stateBefore).toMatchObject({ hadBlockReason: true });
    expectNoReasonText(row);
  });

  it('I-17 — a subject scrubbed before #843 is finished by the next run with one audit row each, then left alone', async () => {
    const customer = await makePersonalCustomer();
    await withOperatorReasons(customer);
    // What the scrub wrote before this change, on both rows: everything but
    // the three reasons, which it left as they were.
    const scrubbedAt = new Date('2026-04-05T06:07:08.000Z');
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.name = 'Deleted customer';
    org.registeredAddress = { ...org.registeredAddress, street: '-', city: '-', postalCode: '-' };
    org.deletedAt = scrubbedAt;
    customer.deletedAt = scrubbedAt;
    customer.email = `deleted+${customer.id}@anonymized.invalid`;
    customer.firstName = 'Deleted customer';
    customer.lastName = 'Deleted customer';
    customer.anonymizedAt = scrubbedAt;
    await em.flush();

    // The next run reaches the subject and finishes it.
    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const reloadedOrg = await em.findOneOrFail(Organization, { id: org.id });
    expect(reloadedOrg.blockedReason ?? null).toBeNull();
    expect(reloadedOrg.rejectedReason ?? null).toBeNull();
    expect(reloadedOrg.deletedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.blockReason ?? null).toBeNull();
    expect(account.anonymizedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    const orgRow = await auditRow('organization.anonymized', org.id);
    expect(orgRow.stateBefore).toMatchObject({ wasDeleted: true, hadBlockedReason: true, hadRejectedReason: true });
    expectNoReasonText(orgRow);
    const accountRow = await auditRow('customer_account.anonymized', customer.id);
    expect(accountRow.stateBefore).toMatchObject({ anonymizedAt: scrubbedAt.toISOString(), hadBlockReason: true });
    expectNoReasonText(accountRow);
    // Finishing is not the transition: the account was announced when it was
    // first anonymised.
    expect(anonymizedEvents).toEqual([]);

    // And converged: a third run finds nothing to do and records nothing.
    expect(await svc.sweep(0, after(60_000))).toBe(0);
    expect(await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id })).toHaveLength(1);
    expect(await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: customer.id })).toHaveLength(1);
  });

  /** An account scrubbed by an earlier release: anonymised, with `residue` still on the row. */
  async function makeEarlierAnonymizedCustomer(
    deletedAt: Date,
    residue: Partial<Pick<CustomerAccount, 'blockReason' | 'customFieldValues'>>,
  ): Promise<CustomerAccount> {
    const customer = await makePersonalCustomer();
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    org.name = 'Deleted customer';
    org.registeredAddress = { ...org.registeredAddress, street: '-', city: '-', postalCode: '-' };
    org.deletedAt = deletedAt;
    customer.deletedAt = deletedAt;
    customer.email = `deleted+${customer.id}@anonymized.invalid`;
    customer.firstName = 'Deleted customer';
    customer.lastName = 'Deleted customer';
    customer.anonymizedAt = deletedAt;
    Object.assign(customer, residue);
    await em.flush();
    return customer;
  }

  it('I-17b — an account anonymised before #802, with custom field values and no block reason, is finished by the next run', async () => {
    const scrubbedAt = new Date('2026-04-05T06:07:08.000Z');
    const customer = await makeEarlierAnonymizedCustomer(scrubbedAt, {
      blockReason: null,
      customFieldValues: { birthday: '1990-01-01', shoe_size: 44 },
    });

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.customFieldValues).toEqual({});
    expect(account.anonymizedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    const row = await auditRow('customer_account.anonymized', customer.id);
    expect(row.stateBefore).toEqual({
      anonymizedAt: scrubbedAt.toISOString(),
      customFieldKeys: ['birthday', 'shoe_size'],
      hadBlockReason: false,
    });
    expect(JSON.stringify([row.stateBefore, row.stateAfter])).not.toContain('1990-01-01');
    expect(anonymizedEvents).toEqual([]);

    expect(await svc.sweep(0, after(60_000))).toBe(0);
    expect(await em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: customer.id })).toHaveLength(1);
  });

  it('I-23a — an anonymised account with residue is finished even after the retention window is raised past its deletion', async () => {
    // Deleted (and anonymised) a day ago; the operator has since raised the
    // window to a year, so the cutoff now lies long before `deletedAt`.
    const deletedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const customer = await makeEarlierAnonymizedCustomer(deletedAt, {
      blockReason: ACCOUNT_BLOCK_REASON,
      customFieldValues: { nickname: 'Solo' },
    });

    expect(await svc.sweep(365, new Date())).toBe(1);

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.blockReason ?? null).toBeNull();
    expect(account.customFieldValues).toEqual({});
    const row = await auditRow('customer_account.anonymized', customer.id);
    expect(row.stateBefore).toMatchObject({ hadBlockReason: true, customFieldKeys: ['nickname'] });
    expectNoReasonText(row);
  });

  // --- issue #923: the sweep finishes what an earlier rule left -------------
  //
  // The sweep used to pick its work by account (`anonymizedAt: null`), so a
  // personal organisation an earlier release scrubbed was never revisited when
  // the rule grew. `organizations` now lists every personal organisation that
  // carries the scrub's name but not the whole current scrub, and the sweep
  // runs each one's anonymised member through the same convergent cascade.
  // Every case drives `sweep()`, not `anonymizeIfOrphaned`.

  const ORG_LEGAL_NAME = 'Solo Buyer Handel';
  const ORG_RECIPIENT = 'solo.buyer@example.test';
  const ORG_LOYALTY_CARD = 'LC-777';

  /** The organisation-side residue an earlier rule could leave behind, every field at once. */
  const EVERY_ORG_RESIDUE: Partial<Organization> = {
    legalName: ORG_LEGAL_NAME,
    orderConfirmationEmails: [ORG_RECIPIENT],
    customFieldValues: { loyalty_card: ORG_LOYALTY_CARD },
    blockedReason: ORG_BLOCK_REASON,
    rejectedReason: ORG_REJECT_REASON,
  };

  /**
   * A subject an earlier release anonymised: the account is finished, and its
   * personal organisation got the name, the blank address and `deletedAt`, but
   * still holds `orgResidue`.
   */
  async function makeEarlierScrubbedSubject(
    scrubbedAt: Date,
    orgResidue: Partial<Organization>,
    accountResidue: Partial<Pick<CustomerAccount, 'blockReason' | 'customFieldValues'>> = {},
  ): Promise<{ customer: CustomerAccount; org: Organization }> {
    const customer = await makeEarlierAnonymizedCustomer(scrubbedAt, accountResidue);
    const org = await em.findOneOrFail(Organization, { id: customer.organizationId });
    Object.assign(org, orgResidue);
    await em.flush();
    return { customer, org };
  }

  const orgAuditRows = (id: string) => em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: id });
  const accountAuditRows = (id: string) => em.find(AuditLogEntry, { action: 'customer_account.anonymized', objectId: id });

  it('I-19 — a personal organization scrubbed under an earlier rule is finished by the next sweep, with one audit row and no announcement (#923)', async () => {
    const scrubbedAt = new Date('2026-04-05T06:07:08.000Z');
    const blockedAt = new Date('2026-03-04T05:06:07.000Z');
    const rejectedAt = new Date('2026-02-01T00:00:00.000Z');
    const { customer, org } = await makeEarlierScrubbedSubject(scrubbedAt, {
      ...EVERY_ORG_RESIDUE,
      status: 'blocked',
      blockedAt,
      rejectedAt,
    });

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const reloaded = await em.findOneOrFail(Organization, { id: org.id });
    expect(reloaded.legalName ?? null).toBeNull();
    expect(reloaded.orderConfirmationEmails).toEqual([]);
    expect(reloaded.customFieldValues).toEqual({});
    expect(reloaded.blockedReason ?? null).toBeNull();
    expect(reloaded.rejectedReason ?? null).toBeNull();
    expect(reloaded.status).toBe('blocked');
    expect(reloaded.blockedAt!.toISOString()).toBe(blockedAt.toISOString());
    expect(reloaded.rejectedAt!.toISOString()).toBe(rejectedAt.toISOString());
    expect(reloaded.deletedAt!.toISOString()).toBe(scrubbedAt.toISOString());

    const rows = await orgAuditRows(org.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateBefore).toEqual({
      wasDeleted: true,
      hadLegalName: true,
      orderConfirmationEmailCount: 1,
      customFieldKeys: ['loyalty_card'],
      hadBlockedReason: true,
      hadRejectedReason: true,
    });
    const serialized = JSON.stringify([rows[0]!.stateBefore, rows[0]!.stateAfter]);
    for (const erased of [ORG_LEGAL_NAME, ORG_RECIPIENT, ORG_LOYALTY_CARD, ORG_BLOCK_REASON, ORG_REJECT_REASON]) {
      expect(serialized).not.toContain(erased);
    }

    // The account was finished already: no row, no second announcement, and
    // its first anonymisation time stands.
    expect(await accountAuditRows(customer.id)).toEqual([]);
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.anonymizedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    expect(anonymizedEvents).toEqual([]);

    // And converged: the next tick has nothing to do.
    expect(await svc.sweep(0, after(60_000))).toBe(0);
    expect(await orgAuditRows(org.id)).toHaveLength(1);
    expect(await accountAuditRows(customer.id)).toEqual([]);
  });

  it('I-20 — a subject unfinished on both owners is processed once, with one audit row each (#923)', async () => {
    // Pre-#802 on both sides: the account kept its custom field values, the
    // organisation its legal name, recipients and custom field values. The
    // account is on both work lists — due for its own residue, and the member
    // of a listed organisation — and must run once.
    const scrubbedAt = new Date('2026-04-05T06:07:08.000Z');
    const { customer, org } = await makeEarlierScrubbedSubject(
      scrubbedAt,
      {
        legalName: ORG_LEGAL_NAME,
        orderConfirmationEmails: [ORG_RECIPIENT],
        customFieldValues: { loyalty_card: ORG_LOYALTY_CARD },
      },
      { customFieldValues: { birthday: '1990-01-01' } },
    );

    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.customFieldValues).toEqual({});
    expect(account.anonymizedAt!.toISOString()).toBe(scrubbedAt.toISOString());
    const accountRows = await accountAuditRows(customer.id);
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]!.stateBefore).toEqual({
      anonymizedAt: scrubbedAt.toISOString(),
      customFieldKeys: ['birthday'],
      hadBlockReason: false,
    });
    const reloaded = await em.findOneOrFail(Organization, { id: org.id });
    expect(reloaded.legalName ?? null).toBeNull();
    expect(reloaded.customFieldValues).toEqual({});
    expect(await orgAuditRows(org.id)).toHaveLength(1);
    expect(anonymizedEvents).toEqual([]);

    expect(await svc.sweep(0, after(60_000))).toBe(0);
  });

  /**
   * One row per field `anonymizeIfOrphaned` erases: the organisation is dirty
   * on that field alone. The selection and `isFullyScrubbed` must agree on
   * every one of them — a field added to the scrub is added to both.
   */
  const SINGLE_FIELD_RESIDUE: Array<[string, Partial<Organization> | ((org: Organization) => void)]> = [
    ['legalName', { legalName: ORG_LEGAL_NAME }],
    ['orderConfirmationEmails', { orderConfirmationEmails: [ORG_RECIPIENT] }],
    ['customFieldValues', { customFieldValues: { loyalty_card: ORG_LOYALTY_CARD } }],
    ['blockedReason', { blockedReason: ORG_BLOCK_REASON }],
    ['rejectedReason', { rejectedReason: ORG_REJECT_REASON }],
    ['registeredAddress.street', (org) => { org.registeredAddress = { ...org.registeredAddress, street: 'ul. Prywatna 7' }; }],
    ['registeredAddress.city', (org) => { org.registeredAddress = { ...org.registeredAddress, city: 'Kraków' }; }],
    ['registeredAddress.postalCode', (org) => { org.registeredAddress = { ...org.registeredAddress, postalCode: '30-001' }; }],
    ['deletedAt', { deletedAt: null }],
  ];

  it.each(SINGLE_FIELD_RESIDUE)(
    'I-21 — an organization dirty only on %s is listed and finished by the sweep; once finished it is not listed (#923)',
    async (_field, residue) => {
      const scrubbedAt = new Date('2026-04-05T06:07:08.000Z');
      const { org } = await makeEarlierScrubbedSubject(scrubbedAt, {});
      if (typeof residue === 'function') residue(org);
      else Object.assign(org, residue);
      await em.flush();

      expect(await personalOrgs.listIncompletelyScrubbed()).toContain(org.id);
      expect(await svc.sweep(0, after(60_000))).toBe(1);
      // `isFullyScrubbed` agreed the organisation was unfinished: it wrote.
      expect(await orgAuditRows(org.id)).toHaveLength(1);

      em.clear();
      expect(await personalOrgs.listIncompletelyScrubbed()).not.toContain(org.id);
      expect(await svc.sweep(0, after(60_000))).toBe(0);
    },
  );

  it('I-21 — a fully scrubbed personal organization is not listed, and the sweep leaves it alone (#923)', async () => {
    const { org } = await makeEarlierScrubbedSubject(new Date('2026-04-05T06:07:08.000Z'), {});
    expect(await personalOrgs.listIncompletelyScrubbed()).not.toContain(org.id);
    expect(await svc.sweep(0, after(60_000))).toBe(0);
    expect(await orgAuditRows(org.id)).toEqual([]);
  });

  it('I-22 — a live customer literally named “Deleted customer”, a company organization and a subject inside its window are not touched (#923)', async () => {
    // A live person whose personal organisation carries the scrub's name.
    const live = await makePersonalCustomer();
    const liveOrg = await em.findOneOrFail(Organization, { id: live.organizationId });
    liveOrg.name = 'Deleted customer';
    liveOrg.legalName = 'Deleted customer Handel';
    // A company organisation that happens to look like a scrubbed one.
    const company = em.create(Organization, {
      name: 'Deleted customer',
      legalName: 'Deleted customer Sp. z o.o.',
      taxId: `D${Date.now()}`,
      status: 'active',
      vatStatus: 'vat_payer',
      isPersonal: false,
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      deletedAt: new Date('2026-04-05T06:07:08.000Z'),
    });
    // A subject soft-deleted just now: inside the window, not anonymised,
    // whose organisation a crashed earlier tick could not have reached.
    const pending = await makePersonalCustomer();
    const pendingOrg = await em.findOneOrFail(Organization, { id: pending.organizationId });
    pendingOrg.name = 'Deleted customer';
    pendingOrg.legalName = ORG_LEGAL_NAME;
    await em.persistAndFlush(company);
    await svc.softDelete(pending.id, actor);

    expect(await personalOrgs.listIncompletelyScrubbed()).not.toContain(company.id);
    expect(await svc.sweep(365, new Date())).toBe(0);

    em.clear();
    const reloadedLive = await em.findOneOrFail(Organization, { id: liveOrg.id });
    expect(reloadedLive.legalName).toBe('Deleted customer Handel');
    expect(reloadedLive.deletedAt ?? null).toBeNull();
    const reloadedCompany = await em.findOneOrFail(Organization, { id: company.id });
    expect(reloadedCompany.legalName).toBe('Deleted customer Sp. z o.o.');
    const reloadedPending = await em.findOneOrFail(Organization, { id: pendingOrg.id });
    expect(reloadedPending.legalName).toBe(ORG_LEGAL_NAME);
    expect(reloadedPending.deletedAt ?? null).toBeNull();
    for (const id of [liveOrg.id, company.id, pendingOrg.id]) {
      expect(await orgAuditRows(id)).toEqual([]);
    }
    expect((await em.findOneOrFail(CustomerAccount, { id: pending.id })).anonymizedAt ?? null).toBeNull();
    expect(anonymizedEvents).toEqual([]);
  });

  it('I-23 — both owners’ residue is finished even after the retention window is raised past the deletion (#923)', async () => {
    // Anonymised a day ago; the operator has since raised the window to a
    // year, so the cutoff lies long before `deletedAt`.
    const deletedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { customer, org } = await makeEarlierScrubbedSubject(
      deletedAt,
      { blockedReason: ORG_BLOCK_REASON, rejectedReason: ORG_REJECT_REASON },
      { blockReason: ACCOUNT_BLOCK_REASON },
    );
    // And one whose account is finished, so only the organisation's residue
    // can bring it onto the work list.
    const orgOnly = await makeEarlierScrubbedSubject(deletedAt, { legalName: ORG_LEGAL_NAME });

    expect(await svc.sweep(365, new Date())).toBe(2);

    em.clear();
    const reloaded = await em.findOneOrFail(Organization, { id: org.id });
    expect(reloaded.blockedReason ?? null).toBeNull();
    expect(reloaded.rejectedReason ?? null).toBeNull();
    expect(reloaded.deletedAt!.toISOString()).toBe(deletedAt.toISOString());
    const account = await em.findOneOrFail(CustomerAccount, { id: customer.id });
    expect(account.blockReason ?? null).toBeNull();
    expect(await orgAuditRows(org.id)).toHaveLength(1);
    expect(await accountAuditRows(customer.id)).toHaveLength(1);
    const reloadedOrgOnly = await em.findOneOrFail(Organization, { id: orgOnly.org.id });
    expect(reloadedOrgOnly.legalName ?? null).toBeNull();
    expect(await orgAuditRows(orgOnly.org.id)).toHaveLength(1);
    expect(await accountAuditRows(orgOnly.customer.id)).toEqual([]);
    expect(anonymizedEvents).toEqual([]);
  });

  it('I-18 — a company organization keeps its reasons when a member is anonymized (#843)', async () => {
    const company = em.create(Organization, {
      name: 'Reasoned Sp. z o.o.',
      taxId: `R${Date.now()}`,
      status: 'blocked',
      vatStatus: 'vat_payer',
      isPersonal: false,
      blockedAt: new Date('2026-03-04T05:06:07.000Z'),
      blockedReason: 'Unpaid invoices',
      rejectedReason: 'Incomplete KRS extract',
      registeredAddress: { street: 'Main 2', city: 'Warsaw', postalCode: '00-002', country: 'PL' },
    });
    await em.persistAndFlush(company);
    const companyMember = await predefinedRoleIdOf(em, company.id, 'member');
    const member = await makeCustomer();
    member.organizationId = company.id;
    member.organizationRoleId = companyMember;
    member.blockedAt = new Date('2026-03-04T05:06:07.000Z');
    member.blockSource = 'org_owner';
    member.blockReason = ACCOUNT_BLOCK_REASON;
    const other = await makeCustomer();
    other.organizationId = company.id;
    other.organizationRoleId = companyMember;
    await em.flush();

    await svc.softDelete(member.id, actor);
    expect(await svc.sweep(0, after(60_000))).toBe(1);

    em.clear();
    const reloadedCompany = await em.findOneOrFail(Organization, { id: company.id });
    expect(reloadedCompany.blockedReason).toBe('Unpaid invoices');
    expect(reloadedCompany.rejectedReason).toBe('Incomplete KRS extract');
    expect(await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: company.id })).toEqual([]);
    // The member's own account is the person's, whatever organisation it stood in.
    const account = await em.findOneOrFail(CustomerAccount, { id: member.id });
    expect(account.blockReason ?? null).toBeNull();
    expect(account.blockSource).toBe('org_owner');
  });

  /**
   * Issue #857 — the sweep tick's question outside the scope. It is the work
   * list's own predicate, one statement for both, so the probe says yes exactly
   * when the list holds something: at a cutoff before an account's deletion,
   * past it, and once the account is anonymised. Other files' committed rows
   * share the table, so each cutoff is checked as an agreement between the two
   * rather than as an absolute answer.
   */
  it('I-24 — hasDueForAnonymization agrees with listDueForAnonymization (#857)', async () => {
    const agrees = async (cutoff: Date): Promise<string[]> => {
      const due = (await accountWrites.listDueForAnonymization(cutoff)).map((d) => d.id);
      expect(await accountWrites.hasDueForAnonymization(cutoff)).toBe(due.length > 0);
      return due;
    };

    // Nothing was deleted before the epoch, so the list there holds only
    // anonymised accounts an earlier scrub left residue on (#843), whatever
    // other files committed.
    for (const id of await agrees(new Date(0))) {
      expect((await em.findOneOrFail(CustomerAccount, { id })).anonymizedAt).toBeInstanceOf(Date);
    }

    const c = await makeCustomer();
    await svc.softDelete(c.id, actor);
    const deletedAt = (await em.findOneOrFail(CustomerAccount, { id: c.id })).deletedAt!;

    expect(await agrees(new Date(deletedAt.getTime() - 1))).not.toContain(c.id);
    expect(await agrees(after(60_000))).toContain(c.id);
    expect(await accountWrites.hasDueForAnonymization(after(60_000))).toBe(true);

    await accountWrites.anonymize(c.id);
    expect(await agrees(after(60_000))).not.toContain(c.id);
  });

  /**
   * Issues #843 and #857 together — the probe shares the work list's
   * predicate, residue branch included. An anonymised account with residue
   * whose deletion lies after the cutoff (the window was raised since) is on
   * the list, so the probe must say yes too, or the tick would skip the run
   * that finishes it.
   */
  it('I-24b — hasDueForAnonymization says yes for an anonymised account with residue past the cutoff (#843, #857)', async () => {
    const deletedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const customer = await makeEarlierAnonymizedCustomer(deletedAt, { blockReason: ACCOUNT_BLOCK_REASON });
    // A cutoff a year back: before the deletion, so only the residue branch
    // can put the account on the list.
    const cutoff = new Date(deletedAt.getTime() - 365 * 24 * 60 * 60 * 1000);

    expect((await accountWrites.listDueForAnonymization(cutoff)).map((d) => d.id)).toContain(customer.id);
    expect(await accountWrites.hasDueForAnonymization(cutoff)).toBe(true);

    await accountWrites.anonymize(customer.id);
    expect((await accountWrites.listDueForAnonymization(cutoff)).map((d) => d.id)).not.toContain(customer.id);
  });

  /**
   * Issues #857 and #923 together — the work list also holds the members of
   * personal organisations an earlier rule left incompletely scrubbed, so the
   * tick's question asks `organizations` too. A subject whose account is
   * finished (no account-side residue) but whose organisation is not must make
   * the question say yes, or the tick would be taken for an idle one and the
   * organisation would never be finished.
   */
  it('I-25 — hasDue says yes for organisation-side residue the account probe cannot see (#857, #923)', async () => {
    const scrubbedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const { customer, org } = await makeEarlierScrubbedSubject(scrubbedAt, { legalName: ORG_LEGAL_NAME });
    // A cutoff a year back: the account is finished and outside it, so only
    // the organisation side can put the subject on the work list.
    const cutoff = new Date(scrubbedAt.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect((await accountWrites.listDueForAnonymization(cutoff)).map((d) => d.id)).not.toContain(customer.id);

    // The organisation probe agrees with its list, and the tick's question says yes.
    expect(await personalOrgs.listIncompletelyScrubbed()).toContain(org.id);
    expect(await personalOrgs.hasIncompletelyScrubbed()).toBe(true);
    expect(await svc.hasDue(365, new Date())).toBe(true);

    // The sweep that question lets in finishes the organisation.
    await svc.sweep(365, new Date());
    em.clear();
    expect((await em.findOneOrFail(Organization, { id: org.id })).legalName ?? null).toBeNull();
    const left = await personalOrgs.listIncompletelyScrubbed();
    expect(left).not.toContain(org.id);
    expect(await personalOrgs.hasIncompletelyScrubbed()).toBe(left.length > 0);
  });

  /**
   * Issue #844 — the sweep erases the anonymised subject's audit history, in
   * place, through the platform's `auditRedactionService` (step 3, before the
   * account step). The rows are written here through the audit writer with the
   * shapes the owners' writers record; the redaction rule itself is the
   * platform's and is pinned in `test/integration/kernel/audit-redaction.test.ts`.
   */
  describe('the subject’s audit history (#844)', () => {
    const SUBJECT_IP = '203.0.113.44';
    const SUBJECT_UA = 'Mozilla/5.0 (subject’s own browser)';
    const OPERATOR_IP = '198.51.100.7';
    const OPERATOR_UA = 'Operator console';
    /** Every value seeded about the subject that must not survive the sweep. */
    const PERSONAL = {
      email: 'anna.subject844@example.test',
      firstName: 'Annabel',
      lastName: 'Subjectova',
      legalName: 'Annabel Subjectova Handel',
      recipient: 'faktury.subject844@example.test',
      customField: 'loyalty-844-ZX',
      blockReason: 'Subject844 abused the returns policy',
      street: 'ul. Tajna 844',
      deletedStreet: 'ul. Usunięta 17',
      legacyStreet: 'ul. Dawna 9',
      phone: '+48 844 844 844',
    };

    type Row = {
      id: string;
      action: string;
      object_type: string;
      object_id: string;
      acted_at: Date;
      actor_admin_user_id: string | null;
      actor_customer_account_id: string | null;
      request_id: string | null;
      state_before: unknown;
      state_after: unknown;
      ip_address: string | null;
      user_agent: string | null;
    };

    /** Every audit row about the given objects, by id, straight from the table. */
    async function rowsAbout(objectIds: readonly string[]): Promise<Row[]> {
      return em.execute<Row[]>(
        `select "id", "action", "object_type", "object_id", "acted_at", "actor_admin_user_id",
                "actor_customer_account_id", "request_id", "state_before", "state_after",
                "ip_address", "user_agent"
           from "audit_log_entries" where "object_id" in (${objectIds.map(() => '?').join(', ')})
          order by "id"`,
        [...objectIds],
      );
    }

    const columnsKept = (rows: Row[]) =>
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        objectType: r.object_type,
        objectId: r.object_id,
        actedAt: new Date(r.acted_at).toISOString(),
        actorAdminUserId: r.actor_admin_user_id,
        actorCustomerAccountId: r.actor_customer_account_id,
        requestId: r.request_id,
      }));

    const textOf = (rows: Row[]) =>
      rows.map((r) => JSON.stringify([r.state_before, r.state_after, r.ip_address, r.user_agent])).join('\n');

    function redactingService(overrides: { redaction?: AnonymizedHistoryDeps['redaction'] } = {}) {
      return buildService({
        history: {
          redaction: overrides.redaction ?? new AuditRedactionService(() => em, audit),
          addressReads: new AddressReadService(() => em),
          retiredAddressBook: new AddressBookRetirementService({
            emFactory: () => em,
            accounts: accounts,
            organizations: { findByIds: async () => [] },
            addresses,
            auditLog: audit,
          }),
        },
      });
    }

    /**
     * A personal subject with a history: its own profile edits (with its IP),
     * an operator's block and custom-field edit, its organisation's legal name
     * and recipients, a live address, an address it deleted before deletion,
     * and a row in the retired personal book.
     */
    async function subjectWithHistory() {
      const c = await makePersonalCustomer();
      const org = await em.findOneOrFail(Organization, { id: c.organizationId });
      org.legalName = PERSONAL.legalName;
      org.orderConfirmationEmails = [PERSONAL.recipient];
      const input = {
        recipientName: `${PERSONAL.firstName} ${PERSONAL.lastName}`,
        city: 'Kraków',
        postalCode: '30-844',
        country: 'PL',
        phone: PERSONAL.phone,
      };
      const live = await addresses.createAddress(c.organizationId, { ...input, street: PERSONAL.street, kind: 'delivery' });
      const gone = await addresses.createAddress(c.organizationId, { ...input, street: PERSONAL.deletedStreet, kind: 'billing' });
      await addresses.deleteAddress(c.organizationId, gone.id);
      const legacy = em.create(CustomerAddress, {
        customerAccountId: c.id,
        kind: 'delivery',
        recipientName: input.recipientName,
        street: PERSONAL.legacyStreet,
        city: 'Kraków',
        postalCode: '30-844',
        country: 'PL',
        phone: PERSONAL.phone,
        deletedAt: new Date(),
        mergeRefusal: 'COUNTRY_NOT_ALLOWED',
      });
      await em.persistAndFlush(legacy);

      const own = { actorCustomerAccountId: c.id, ipAddress: SUBJECT_IP, userAgent: SUBJECT_UA, requestId: 'req-844-own' };
      const operator = { actorAdminUserId: actor.adminUserId, ipAddress: OPERATOR_IP, userAgent: OPERATOR_UA, requestId: 'req-844-op' };
      const writes = [
        { ...own, action: 'customer_account.profile_updated', objectType: 'customer_account', objectId: c.id,
          stateBefore: { email: 'old.subject844@example.test', firstName: 'Ann' },
          stateAfter: { email: PERSONAL.email, firstName: PERSONAL.firstName, lastName: PERSONAL.lastName, updatedAt: new Date().toISOString() } },
        { ...operator, action: 'customer_account.blocked', objectType: 'customer_account', objectId: c.id,
          stateBefore: { status: 'active' },
          stateAfter: { status: 'blocked', blockSource: 'staff', blockReason: PERSONAL.blockReason, organizationId: org.id } },
        { ...operator, action: 'customer_account.custom_fields_updated', objectType: 'customer_account', objectId: c.id,
          stateBefore: { customFieldValues: { loyalty_card: null } },
          stateAfter: { customFieldValues: { loyalty_card: PERSONAL.customField, vip: true } } },
        { ...operator, action: 'organization.updated', objectType: 'organization', objectId: org.id,
          stateBefore: { legalName: null, orderConfirmationEmails: [] },
          stateAfter: { legalName: PERSONAL.legalName, orderConfirmationEmails: [PERSONAL.recipient], countryCode: 'PL' } },
        { ...own, action: 'address.updated', objectType: 'address', objectId: live.id,
          stateBefore: { street: 'ul. Stara 1', phone: null },
          stateAfter: { street: PERSONAL.street, phone: PERSONAL.phone, countryCode: 'PL', kind: 'delivery' } },
        { ...own, action: 'address.created', objectType: 'address', objectId: gone.id,
          stateAfter: { street: PERSONAL.deletedStreet, recipientName: input.recipientName } },
        { ...own, action: 'customer_address.created', objectType: 'customer_address', objectId: legacy.id,
          stateAfter: { street: PERSONAL.legacyStreet, phone: PERSONAL.phone, mergeRefusal: 'COUNTRY_NOT_ALLOWED' } },
      ];
      for (const write of writes) audit.recordWithin(em, write);
      await em.flush();
      return { c, org, objectIds: [c.id, org.id, live.id, gone.id, legacy.id], live, gone, legacy };
    }

    it('I-844-1 — no seeded value survives in the subject’s history, and every column but the values is unchanged (AC-844-1)', async () => {
      const svc = redactingService();
      const { c, objectIds } = await subjectWithHistory();
      await svc.softDelete(c.id, actor);
      const before = await rowsAbout(objectIds);
      expect(textOf(before)).toContain(PERSONAL.deletedStreet);

      expect(await svc.sweep(0, new Date(Date.now() + 60_000))).toBe(1);

      em.clear();
      const after = (await rowsAbout(objectIds)).filter((r) => r.action !== 'audit.redacted');
      const text = textOf(after);
      for (const value of [...Object.values(PERSONAL), SUBJECT_IP, SUBJECT_UA]) {
        expect(text, `'${value}' survived`).not.toContain(value);
      }
      // Who did what, and when, is kept: the rows written before the sweep
      // keep every column but their values.
      const beforeIds = new Set(before.map((r) => r.id));
      expect(columnsKept(after.filter((r) => beforeIds.has(r.id)))).toEqual(columnsKept(before));
      // The operator's IP and user agent are the operator's, not the subject's.
      const blocked = after.find((r) => r.action === 'customer_account.blocked')!;
      expect([blocked.ip_address, blocked.user_agent]).toEqual([OPERATOR_IP, OPERATOR_UA]);
      expect(blocked.state_after).toEqual({
        status: 'blocked',
        blockSource: 'staff',
        blockReason: AUDIT_ERASED_MARKER,
        organizationId: expect.any(String),
      });
      const own = after.find((r) => r.action === 'customer_account.profile_updated')!;
      expect([own.ip_address, own.user_agent]).toEqual([AUDIT_ERASED_MARKER, AUDIT_ERASED_MARKER]);
      const fields = after.find((r) => r.action === 'customer_account.custom_fields_updated')!;
      expect(fields.state_after).toEqual({ customFieldValues: { loyalty_card: AUDIT_ERASED_MARKER, vip: AUDIT_ERASED_MARKER } });
    });

    it('I-844-2 — one audit.redacted row with counts and ids only, and a second sweep changes nothing (AC-844-2)', async () => {
      const svc = redactingService();
      const { c, org, objectIds, live, gone, legacy } = await subjectWithHistory();
      await svc.softDelete(c.id, actor);
      await svc.sweep(0, new Date(Date.now() + 60_000));

      em.clear();
      const markers = await em.find(AuditLogEntry, { action: 'audit.redacted', objectId: c.id });
      expect(markers).toHaveLength(1);
      const marker = markers[0]!;
      expect(marker.objectType).toBe('customer_account');
      expect([marker.actorAdminUserId ?? null, marker.actorCustomerAccountId ?? null]).toEqual([null, null]);
      expect(Object.keys(marker.stateAfter ?? {}).sort()).toEqual(
        ['byObjectType', 'objectIds', 'reason', 'rowsChanged', 'rowsInScope'],
      );
      expect(marker.stateAfter).toMatchObject({
        reason: 'anonymization',
        objectIds: {
          customer_account: [c.id],
          organization: [org.id],
          address: expect.arrayContaining([live.id, gone.id]),
          customer_address: [legacy.id],
        },
      });
      expect(JSON.stringify(marker.stateAfter)).not.toContain(PERSONAL.email);

      const settled = textOf(await rowsAbout(objectIds));
      await svc.sweep(0, new Date(Date.now() + 120_000));
      em.clear();
      expect(textOf(await rowsAbout(objectIds))).toBe(settled);
      expect(await em.find(AuditLogEntry, { action: 'audit.redacted', objectId: c.id })).toHaveLength(1);
    });

    it('I-844-3 — rows about other objects are byte-identical, the subject’s own actions on them included (AC-844-3)', async () => {
      const svc = redactingService();
      const { c } = await subjectWithHistory();
      const other = await makePersonalCustomer();
      const elsewhere = randomUUID();
      audit.recordWithin(em, {
        actorCustomerAccountId: c.id, ipAddress: SUBJECT_IP, userAgent: SUBJECT_UA,
        action: 'order.placed', objectType: 'order', objectId: elsewhere,
        stateAfter: { deliveryAddress: { street: PERSONAL.street }, email: PERSONAL.email },
      });
      audit.recordWithin(em, {
        actorAdminUserId: actor.adminUserId, action: 'customer_account.profile_updated',
        objectType: 'customer_account', objectId: other.id, stateAfter: { email: other.email },
      });
      await em.flush();
      const untouched = await rowsAbout([elsewhere, other.id]);
      await svc.softDelete(c.id, actor);

      await svc.sweep(0, new Date(Date.now() + 60_000));

      em.clear();
      expect(await rowsAbout([elsewhere, other.id])).toEqual(untouched);
      // Scope, said once: these stores keep their own copies and are follow-ups
      // of #844, one per owner. Widening the scope is a change to this list.
      expect(['email_deliveries', 'webhook_deliveries', 'cart_audit_entries', 'return_*', 'newsletter_*', 'form_entries']).toHaveLength(6);
    });

    it('I-844-4 — the organization.anonymized and address.anonymized rows the same sweep wrote are left as their owners wrote them', async () => {
      const svc = redactingService();
      const { c, org, live } = await subjectWithHistory();
      await svc.softDelete(c.id, actor);
      await svc.sweep(0, new Date(Date.now() + 60_000));

      em.clear();
      const [orgRow] = await em.find(AuditLogEntry, { action: 'organization.anonymized', objectId: org.id });
      expect(orgRow!.stateBefore).toEqual({
        wasDeleted: false,
        hadLegalName: true,
        orderConfirmationEmailCount: 1,
        customFieldKeys: [],
        hadBlockedReason: false,
        hadRejectedReason: false,
      });
      expect(orgRow!.stateAfter).toEqual({ anonymizedAt: expect.stringMatching(/^\d{4}-/), isPersonal: true });
      const [addressRow] = await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: live.id });
      expect(addressRow!.stateBefore).toEqual({ organizationId: org.id, kind: 'delivery' });
    });

    it('I-844-5 — a company member: only its own account’s rows are erased, the company’s are untouched', async () => {
      const svc = redactingService();
      const c = await makeCustomer();
      const company = await em.findOneOrFail(Organization, { id: c.organizationId });
      expect(company.isPersonal).toBe(false);
      audit.recordWithin(em, {
        actorCustomerAccountId: c.id, ipAddress: SUBJECT_IP, action: 'customer_account.profile_updated',
        objectType: 'customer_account', objectId: c.id, stateAfter: { email: PERSONAL.email },
      });
      audit.recordWithin(em, {
        actorCustomerAccountId: c.id, ipAddress: SUBJECT_IP, action: 'organization.updated',
        objectType: 'organization', objectId: company.id, stateAfter: { legalName: 'Company 844 Sp. z o.o.' },
      });
      await em.flush();
      const companyRows = await rowsAbout([company.id]);
      await svc.softDelete(c.id, actor);

      await svc.sweep(0, new Date(Date.now() + 60_000));

      em.clear();
      expect(textOf(await rowsAbout([c.id]))).not.toContain(PERSONAL.email);
      expect(await rowsAbout([company.id])).toEqual(companyRows);
      const [marker] = await em.find(AuditLogEntry, { action: 'audit.redacted', objectId: c.id });
      expect(Object.keys((marker!.stateAfter as { objectIds: object }).objectIds)).toEqual(['customer_account']);
    });

    it('I-844-6 — a crash at the redaction step leaves the account due, and the next sweep finishes it with one marker', async () => {
      const { c, objectIds } = await subjectWithHistory();
      const crashing = redactingService({
        redaction: { redact: async () => { throw new Error('redaction crashed'); } },
      });
      await crashing.softDelete(c.id, actor);
      await expect(crashing.sweep(0, new Date(Date.now() + 60_000))).rejects.toThrow(c.id);
      em.clear();
      expect((await em.findOneOrFail(CustomerAccount, { id: c.id })).anonymizedAt ?? null).toBeNull();

      expect(await redactingService().sweep(0, new Date(Date.now() + 60_000))).toBe(1);
      em.clear();
      expect((await em.findOneOrFail(CustomerAccount, { id: c.id })).anonymizedAt).toBeInstanceOf(Date);
      expect(textOf(await rowsAbout(objectIds))).not.toContain(PERSONAL.email);
      expect(await em.find(AuditLogEntry, { action: 'audit.redacted', objectId: c.id })).toHaveLength(1);
    });
  });
});

/**
 * I-5 over the wire — the refusal is a sentence in the reader's language.
 *
 * The code is `customer_accounts`' (D-186 §1) and is raised by `customers` as
 * well since issue #800, so it has to carry a bundle sentence rather than the
 * raiser's English. Only the error envelope translates, over the bundles the
 * server reconciled at boot, so this case goes through the admin route. The
 * admin arm reads the stored preference and ignores `Accept-Language` (D-132).
 *
 * Written out rather than read from the bundle: a test that loads the file it
 * is checking asserts only that JSON parses.
 */
describe('I-5 over HTTP — CUSTOMER_RESTORE_WINDOW_ELAPSED in the admin language', () => {
  let h: BackendServerHandle;
  let previousLanguage: string | null;
  const PL_WINDOW_ELAPSED =
    'Okres, w którym można było przywrócić to konto, minął, więc nie można go już przywrócić. ' +
    'Jego dane osobowe zostały lub wkrótce zostaną trwale zanonimizowane.';
  const EN_WINDOW_ELAPSED =
    'The restore window for this account has elapsed, so it can no longer be restored. ' +
    'Its personal data has been, or will shortly be, permanently anonymized.';

  beforeAll(async () => {
    h = await setupBackendServer();
    const admin = await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    previousLanguage = admin.preferredLanguage ?? null;
  }, 120_000);

  afterAll(async () => {
    const admin = await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = previousLanguage;
    await h.em().flush();
    await teardownBackendServer(h);
  });

  /** A customer soft-deleted through the route, then moved past the 365-day window. */
  async function customerPastTheWindow(): Promise<string> {
    const em = h.em();
    const org = await seedAdHocOrganization(em, 'Window Org');
    const c = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `window-${randomUUID()}@example.test`,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Window',
      lastName: 'Elapsed',
    });
    await em.persistAndFlush(c);
    const deleted = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/customers/${c.id}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(deleted.statusCode, deleted.body).toBeLessThan(300);
    em.clear();
    const row = await em.findOneOrFail(CustomerAccount, { id: c.id });
    row.deletedAt = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
    await em.flush();
    return c.id;
  }

  async function refusalIn(language: 'pl' | 'en'): Promise<string> {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = language;
    await em.flush();
    const id = await customerPastTheWindow();
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/customers/${id}/restore`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode, res.body).toBe(409);
    const body = res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CUSTOMER_RESTORE_WINDOW_ELAPSED');
    return body.error.message;
  }

  it('answers the Polish sentence to an admin who reads Polish', async () => {
    expect(await refusalIn('pl')).toBe(PL_WINDOW_ELAPSED);
  });

  it('and the English sentence, not the raiser\'s fallback, to one who reads English', async () => {
    expect(await refusalIn('en')).toBe(EN_WINDOW_ELAPSED);
  });
});

/**
 * Issue #828 — `CUSTOMER_ALREADY_DELETED` carries a bundle sentence too.
 *
 * Raised by `customers`' `customer-deletion-service.ts` and by
 * `customer_accounts`' lifecycle port when an account is deleted twice, and by
 * `admin_users` when an operator tries to impersonate a deleted customer
 * (issue #814), so the one sentence has to read right for each of them. The
 * HTTP case here is the second delete, which is the raise site every tree has.
 * As above: the admin arm reads the stored preference, and the expected
 * sentences are written out rather than read from the bundle.
 */
describe('CUSTOMER_ALREADY_DELETED over HTTP — in the admin language', () => {
  let h: BackendServerHandle;
  let previousLanguage: string | null;
  const PL_ALREADY_DELETED =
    'To konto klienta zostało już usunięte, więc ta operacja nie jest dla niego dostępna. ' +
    'Usunięte konto można przywrócić, dopóki nie minie okres na jego przywrócenie.';
  const EN_ALREADY_DELETED =
    'This customer account has already been deleted, so this action is not available for it. ' +
    'A deleted account can be restored until its restore window elapses.';

  beforeAll(async () => {
    h = await setupBackendServer();
    const admin = await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    previousLanguage = admin.preferredLanguage ?? null;
  }, 120_000);

  afterAll(async () => {
    const admin = await h.em().findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = previousLanguage;
    await h.em().flush();
    await teardownBackendServer(h);
  });

  async function refusalIn(language: 'pl' | 'en'): Promise<string> {
    const em = h.em();
    const admin = await em.findOneOrFail(AdminUser, { id: TEST_ADMIN_ID });
    admin.preferredLanguage = language;
    await em.flush();
    const org = await seedAdHocOrganization(em, 'Already Deleted Org');
    const c = em.create(CustomerAccount, {
      organizationId: org.id,
      email: `already-deleted-${randomUUID()}@example.test`,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Already',
      lastName: 'Deleted',
    });
    await em.persistAndFlush(c);
    const del = () =>
      h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/customers/${c.id}`,
        cookies: { b2b_session: 'stub-admin-session' },
      });
    const first = await del();
    expect(first.statusCode, first.body).toBeLessThan(300);
    const second = await del();
    expect(second.statusCode, second.body).toBe(409);
    const body = second.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CUSTOMER_ALREADY_DELETED');
    return body.error.message;
  }

  it('answers the Polish sentence to an admin who reads Polish', async () => {
    expect(await refusalIn('pl')).toBe(PL_ALREADY_DELETED);
  });

  it('and the English sentence, not the raiser\'s fallback, to one who reads English', async () => {
    expect(await refusalIn('en')).toBe(EN_ALREADY_DELETED);
  });
});
