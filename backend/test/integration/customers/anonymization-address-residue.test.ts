import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AddressServicePort,
  CustomerAccountLifecycleWritePort,
  PersonalOrganizationPort,
} from '@endora-commerce/contracts';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry, hashPassword } from '@endora-commerce/platform/kernel';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Address, CustomerAccount, CustomerAddress, Organization } from '../../helpers/package-entities.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import {
  customerAccountPortsFor,
  personalOrganizationProvisionFor,
} from '../../helpers/customer-account-ports.js';
import { twoFactorEnrolmentsFor } from '../../helpers/two-factor-enrolments.js';
import { predefinedRoleIdOf } from '../../helpers/seed-organization-roles.js';
// `dist`, not `src` (feature 146): see `test/helpers/customer-account-ports.ts`.
import { CustomerAccountReadService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-ports.js';
import { CustomerAccountLifecycleWriteService } from '../../../../packages/modules/customer_accounts/dist/backend/services/customer-account-lifecycle-ports.js';
import { AddressService } from '../../../../packages/modules/addresses/src/backend/services/address-service.js';
import {
  AddressReadService,
  createAddressServicePort,
} from '../../../../packages/modules/addresses/src/backend/services/address-ports.js';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { toOrganizationRecord } from '../../../../packages/modules/organizations/src/backend/services/organization-details-port.js';
import { AddressBookRetirementService } from '../../../../packages/modules/customers/src/backend/services/address-book-retirement-service.js';
import { CustomerAuthorityService } from '../../../../packages/modules/customers/src/backend/services/customer-authority-service.js';
import { CustomerDeletionService } from '../../../../packages/modules/customers/src/backend/services/customer-deletion-service.js';
import type { OrganizationDepletionGuard } from '../../../../packages/modules/customers/src/backend/services/organization-depletion-guard.js';

/**
 * Issue #927 — the retention sweep blanks **every** address row of the
 * subject, not only the live ones.
 *
 * An address the customer deleted before the account was anonymised is a
 * soft-deleted row that still holds the street, the phone and the recipient's
 * name, and so is every row of the retired personal book (`customer_addresses`)
 * — the rows the retirement job moved, the ones the customer deleted, and a
 * refused one. Each owner scrubs its own table: `addresses` the Organization
 * book, through `anonymizeForOrganization`; `customers` its retired book. The
 * same fields get the same values as the live-row scrub (`'-'`, no phone, not
 * default, country kept); a row already soft-deleted keeps its `deletedAt`.
 *
 * Both are driven through `sweep()`, and a second run changes nothing: no row,
 * no audit entry, no event.
 */
describe('Anonymization sweep — address rows the customer deleted, and the retired book (issue #927)', () => {
  let db: TestDb;
  let em: EntityManager;
  let audit: AuditLogService;
  let personalOrgs: PersonalOrganizationService;
  let addresses: AddressServicePort;
  let accountWrites: CustomerAccountLifecycleWritePort;
  let svc: CustomerDeletionService;
  /** `customer_account.anonymized.v1`, as `customer_accounts` announces it. */
  let anonymizedEvents: string[];

  const PERSONAL = {
    recipientName: 'Ewa Prywatna',
    street: 'ul. Ukryta 13',
    city: 'Gdańsk',
    postalCode: '80-001',
    country: 'PL',
    phone: '+48 600 700 800',
  };
  /** Every seeded personal value: none may survive in a row or an audit entry. */
  const SEEDED = [PERSONAL.recipientName, PERSONAL.street, PERSONAL.city, PERSONAL.postalCode, PERSONAL.phone];

  /** The operator who soft-deleted the subject; the scrub itself has no actor. */
  const DELETED_BY = { actorAdminUserId: '00000000-0000-4000-8000-00000000b927' };
  const after = (ms: number) => new Date(Date.now() + ms);
  const unique = (): string => `${Date.now()}-${Math.floor(performance.now() * 1000)}-${Math.random()}`;

  /**
   * Issue #960 — runs a sweep and answers which of `subjects` it anonymised,
   * in order. The work list is the whole database's, so a soft-deleted account
   * another file committed is swept here too; asserting the run's total would
   * make that account this file's failure.
   */
  async function sweepFor(subjects: readonly string[], now: Date): Promise<string[]> {
    const from = anonymizedEvents.length;
    await svc.sweep(0, now);
    return anonymizedEvents.slice(from).filter((id) => subjects.includes(id));
  }
  /** `anonymizedEvents`, narrowed to `subjects` (issue #960). */
  const announcedFor = (...subjects: string[]): string[] => anonymizedEvents.filter((id) => subjects.includes(id));

  function personalOrganizationPortOver(orgs: PersonalOrganizationService): PersonalOrganizationPort {
    return {
      ensureForCustomerAccount: async (id) => toOrganizationRecord(await orgs.ensureForCustomerAccountId(id)),
      provisionPersonalOrganization: async (id) => {
        const org = await orgs.provisionPersonalOrganizationFor(id);
        return { ...toOrganizationRecord(org), administratorRoleId: await predefinedRoleIdOf(em, org.id, 'administrator') };
      },
      anonymizeIfOrphaned: async (id) => {
        const org = await orgs.anonymizeIfOrphaned(id);
        return org ? toOrganizationRecord(org) : null;
      },
      // Issue #923 — the sweep's second work-list source.
      listIncompletelyScrubbed: () => orgs.listIncompletelyScrubbed(),
      hasIncompletelyScrubbed: () => orgs.hasIncompletelyScrubbed(),
    };
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    audit = new AuditLogService(() => em);
    addresses = createAddressServicePort(() => new AddressService(() => em, undefined, audit));
    personalOrgs = new PersonalOrganizationService(() => em, customerAccountPortsFor(() => em), audit);
    const organizationRoles = {
      predefinedRoleId: (organizationId: string, kind: 'administrator' | 'member') =>
        predefinedRoleIdOf(em, organizationId, kind),
    };
    const accounts = new CustomerAccountReadService(() => em, twoFactorEnrolmentsFor(() => em, 'customer'), organizationRoles);
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
    const retiredBook = new AddressBookRetirementService({
      emFactory: () => em,
      accounts: customerAccountPortsFor(() => em).read,
      organizations: {
        findByIds: async (ids) =>
          (await em.find(Organization, { id: { $in: [...ids] } })).map(toOrganizationRecord),
      },
      addresses,
      auditLog: audit,
    });
    svc = new CustomerDeletionService(
      accounts,
      accountWrites,
      personalOrganizationPortOver(personalOrgs),
      new CustomerAuthorityService({ canSeeOrganization: async () => true }),
      { destroyAllForCustomer: async () => undefined },
      // The sweep never asks the last-administrator question.
      {} as OrganizationDepletionGuard,
      addresses,
      async () => 365,
      retiredBook,
      // Issue #920 — `carts`' step; this file seeds no cart.
      { anonymizeForCustomerAccount: async () => 0 },
      // Issue #928 — `email`'s step; this file seeds no delivery record.
      { anonymizeForRecipient: async () => 0 },
      // Issue #844 — the subject's audit history; not what this file is about.
      {
        redaction: { redact: async () => ({ rowsInScope: 0, rowsChanged: 0, markerWritten: false }) },
        addressReads: { listIdsForOrganization: async () => [] },
        retiredAddressBook: { listIdsForAccount: async () => [] },
      },
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  /** The B2C shape: an account in its own single-member personal Organization. */
  async function personalCustomer(): Promise<CustomerAccount> {
    const id = randomUUID();
    const email = `residue-b2c-${unique()}@example.test`;
    const org = await personalOrgs.provisionFor(em, { customerAccountId: id, email, firstName: 'Ewa', lastName: 'Prywatna' });
    const account = em.create(CustomerAccount, {
      id,
      organizationId: org.id,
      email,
      passwordHash: await hashPassword('a-very-strong-pass'),
      firstName: 'Ewa',
      lastName: 'Prywatna',
    });
    await em.persistAndFlush(account);
    return account;
  }

  /** A member of a company Organization another member keeps alive. */
  async function companyMember(): Promise<{ account: CustomerAccount; organization: Organization }> {
    const organization = await seedAdHocOrganization(em, 'Residue Company');
    const make = async () => {
      const account = em.create(CustomerAccount, {
        organizationId: organization.id,
        organizationRoleId: await predefinedRoleIdOf(em, organization.id, 'member'),
        email: `residue-company-${unique()}@example.test`,
        passwordHash: 'x'.repeat(32),
        firstName: 'Piotr',
        lastName: 'Firmowy',
      });
      await em.persistAndFlush(account);
      return account;
    };
    const account = await make();
    await make();
    return { account, organization };
  }

  /** One row of the retired personal book, written the way release 1 left it. */
  async function retiredRow(
    customerAccountId: string,
    over: Partial<{
      kind: 'delivery' | 'billing';
      isDefault: boolean;
      deletedAt: Date | null;
      mergedIntoAddressId: string | null;
      mergedAt: Date | null;
      mergeRefusal: string | null;
    }> = {},
  ): Promise<string> {
    const row = em.create(CustomerAddress, {
      customerAccountId,
      kind: 'delivery',
      ...PERSONAL,
      isDefault: false,
      deletedAt: null,
      ...over,
    });
    await em.persistAndFlush(row);
    return row.id;
  }

  async function auditRowsFor(objectIds: readonly string[]): Promise<AuditLogEntry[]> {
    return em.find(AuditLogEntry, { objectId: { $in: [...objectIds] } }, { orderBy: { id: 'asc' } });
  }

  function expectBlanked(row: {
    recipientName: string;
    street: string;
    city: string;
    postalCode: string;
    country: string;
    phone?: string | null;
    isDefault: boolean;
    deletedAt?: Date | null;
  }): void {
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
  }

  it('I-927-1 — blanks a personal Organization address the customer deleted before anonymisation, keeping its deletedAt', async () => {
    const c = await personalCustomer();
    const live = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'delivery', isDefault: true });
    const removed = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'billing', isDefault: true });
    await addresses.deleteAddress(c.organizationId, removed.id);
    em.clear();
    const removedAt = (await em.findOneOrFail(Address, { id: removed.id })).deletedAt!;
    expect(removedAt).toBeInstanceOf(Date);

    await accountWrites.softDelete(c.id, DELETED_BY);
    expect(await sweepFor([c.id], after(60_000))).toEqual([c.id]);

    em.clear();
    const liveRow = await em.findOneOrFail(Address, { id: live.id });
    const removedRow = await em.findOneOrFail(Address, { id: removed.id });
    expectBlanked(liveRow);
    expectBlanked(removedRow);
    // When the customer deleted it stays the fact the row records.
    expect(removedRow.deletedAt!.toISOString()).toBe(removedAt.toISOString());

    const entries = await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: { $in: [live.id, removed.id] } });
    expect(entries).toHaveLength(2);
    const byId = new Map(entries.map((e) => [e.objectId, e]));
    expect(byId.get(live.id)!.stateBefore).toMatchObject({ organizationId: c.organizationId, kind: 'delivery', wasDeleted: false });
    expect(byId.get(removed.id)!.stateBefore).toMatchObject({ organizationId: c.organizationId, kind: 'billing', wasDeleted: true });
    for (const entry of entries) expect(entry.actorAdminUserId ?? null).toBeNull();
    const serialised = JSON.stringify(entries.map((e) => [e.stateBefore, e.stateAfter]));
    for (const value of SEEDED) expect(serialised).not.toContain(value);
  });

  it('I-927-2 — blanks every row of the retired personal book: moved, deleted by the customer, refused', async () => {
    const c = await personalCustomer();
    const moved = await retiredRow(c.id, {
      kind: 'delivery',
      deletedAt: new Date('2026-11-05T10:00:00.000Z'),
      mergedIntoAddressId: randomUUID(),
      mergedAt: new Date('2026-11-05T10:00:00.000Z'),
    });
    const deletedEarlier = await retiredRow(c.id, { kind: 'billing', deletedAt: new Date('2025-01-02T03:04:05.000Z') });
    const refused = await retiredRow(c.id, { kind: 'delivery', isDefault: true, mergeRefusal: 'DICTIONARY_ENTRY_INACTIVE' });
    const ids = [moved, deletedEarlier, refused];

    await accountWrites.softDelete(c.id, DELETED_BY);
    expect(await sweepFor([c.id], after(60_000))).toEqual([c.id]);

    em.clear();
    for (const id of ids) expectBlanked(await em.findOneOrFail(CustomerAddress, { id }));
    expect((await em.findOneOrFail(CustomerAddress, { id: deletedEarlier })).deletedAt!.toISOString()).toBe(
      '2025-01-02T03:04:05.000Z',
    );
    // Provenance and the refusal code are not personal data and stay.
    expect((await em.findOneOrFail(CustomerAddress, { id: moved })).mergedIntoAddressId).not.toBeNull();
    expect((await em.findOneOrFail(CustomerAddress, { id: refused })).mergeRefusal).toBe('DICTIONARY_ENTRY_INACTIVE');

    const entries = await em.find(AuditLogEntry, { action: 'customer_address.anonymized', objectId: { $in: ids } });
    expect(entries.map((e) => e.objectId).sort()).toEqual([...ids].sort());
    const byId = new Map(entries.map((e) => [e.objectId, e]));
    expect(byId.get(moved)!.stateBefore).toMatchObject({ customerAccountId: c.id, kind: 'delivery', wasDeleted: true });
    expect(byId.get(deletedEarlier)!.stateBefore).toMatchObject({ customerAccountId: c.id, kind: 'billing', wasDeleted: true });
    expect(byId.get(refused)!.stateBefore).toMatchObject({ customerAccountId: c.id, kind: 'delivery', wasDeleted: false });
    for (const entry of entries) expect(entry.actorAdminUserId ?? null).toBeNull();
    const serialised = JSON.stringify(entries.map((e) => [e.stateBefore, e.stateAfter]));
    for (const value of SEEDED) expect(serialised).not.toContain(value);

    expect(announcedFor(c.id)).toEqual([c.id]);
  });

  it('I-927-3 — a second sweep changes no row, writes no audit entry and announces nothing', async () => {
    const c = await personalCustomer();
    const live = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'delivery' });
    const removed = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'billing' });
    await addresses.deleteAddress(c.organizationId, removed.id);
    const retired = [
      await retiredRow(c.id, { deletedAt: new Date('2025-01-02T03:04:05.000Z') }),
      await retiredRow(c.id, { kind: 'billing' }),
    ];
    const objectIds = [c.id, c.organizationId, live.id, removed.id, ...retired];

    await accountWrites.softDelete(c.id, DELETED_BY);
    expect(await sweepFor([c.id], after(60_000))).toEqual([c.id]);
    em.clear();
    const snapshot = async () => ({
      addresses: (await em.find(Address, { id: { $in: [live.id, removed.id] } }, { orderBy: { id: 'asc' } })).map((a) => ({
        ...a,
      })),
      retired: (await em.find(CustomerAddress, { id: { $in: retired } }, { orderBy: { id: 'asc' } })).map((a) => ({ ...a })),
    });
    const first = await snapshot();
    // The first run did the whole scrub, so the second has nothing to do.
    for (const row of [...first.addresses, ...first.retired]) expectBlanked(row);
    const firstAudit = (await auditRowsFor(objectIds)).map((e) => e.id);
    // One entry for each of the account, the organisation and the four address rows.
    expect(
      (await auditRowsFor(objectIds)).filter((e) => e.action.endsWith('.anonymized')).map((e) => e.objectId).sort(),
    ).toEqual([...objectIds].sort());
    expect(announcedFor(c.id)).toEqual([c.id]);

    expect(await sweepFor([c.id], after(120_000))).toEqual([]);
    em.clear();
    expect(await snapshot()).toEqual(first);
    expect((await auditRowsFor(objectIds)).map((e) => e.id)).toEqual(firstAudit);
    expect(announcedFor(c.id)).toEqual([c.id]);
  });

  it("I-927-4 — a company member's retired rows are blanked; the company's own addresses are not touched", async () => {
    const { account, organization } = await companyMember();
    const companyLive = await addresses.createAddress(organization.id, { ...PERSONAL, kind: 'delivery' });
    const companyRemoved = await addresses.createAddress(organization.id, { ...PERSONAL, kind: 'billing' });
    await addresses.deleteAddress(organization.id, companyRemoved.id);
    const retired = await retiredRow(account.id, { deletedAt: new Date('2025-01-02T03:04:05.000Z') });

    await accountWrites.softDelete(account.id, DELETED_BY);
    expect(await sweepFor([account.id], after(60_000))).toEqual([account.id]);

    em.clear();
    expectBlanked(await em.findOneOrFail(CustomerAddress, { id: retired }));
    for (const id of [companyLive.id, companyRemoved.id]) {
      expect(await em.findOneOrFail(Address, { id })).toMatchObject({ street: PERSONAL.street, recipientName: PERSONAL.recipientName });
    }
    expect(await em.find(AuditLogEntry, { action: 'address.anonymized', objectId: { $in: [companyLive.id, companyRemoved.id] } })).toEqual([]);
  });

  it("I-927-5 — addressReadPort.listIdsForOrganization lists deleted rows on request, and never another organisation's", async () => {
    const c = await personalCustomer();
    const other = await personalCustomer();
    const live = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'delivery' });
    const removed = await addresses.createAddress(c.organizationId, { ...PERSONAL, kind: 'billing' });
    await addresses.deleteAddress(c.organizationId, removed.id);
    await addresses.createAddress(other.organizationId, { ...PERSONAL, kind: 'delivery' });

    const read = new AddressReadService(() => em);
    expect(await read.listIdsForOrganization(c.organizationId)).toEqual([live.id]);
    expect((await read.listIdsForOrganization(c.organizationId, { includeDeleted: true })).sort()).toEqual(
      [live.id, removed.id].sort(),
    );
  });
});
