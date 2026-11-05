import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  type AddressServicePort,
  type DictionaryValidator,
} from '@endora-commerce/contracts';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Address, CustomerAccount, CustomerAddress, Organization } from '../../helpers/package-entities.js';
// The row types, read from the entity sources the way `helpers/package-entities.ts` does: the
// helper's `CustomerAddress` and `Address` are values only.
import type { CustomerAddress as CustomerAddressRow } from '../../../../packages/modules/customers/src/backend/entities/customer-address.entity.js';
import type { Address as AddressRow } from '../../../../packages/modules/addresses/src/backend/entities/address.entity.js';
import { seedAdHocOrganization } from '../../helpers/seed-organizations.js';
import { customerAccountPortsFor } from '../../helpers/customer-account-ports.js';
import { AddressService } from '../../../../packages/modules/addresses/src/backend/services/address-service.js';
import {
  AddressReadService,
  createAddressServicePort,
} from '../../../../packages/modules/addresses/src/backend/services/address-ports.js';
import { PersonalOrganizationService } from '../../../../packages/modules/organizations/src/backend/services/personal-organization-service.js';
import { toOrganizationRecord } from '../../../../packages/modules/organizations/src/backend/services/organization-details-port.js';
import { AddressBookRetirementService } from '../../../../packages/modules/customers/src/backend/services/address-book-retirement-service.js';

/**
 * `specs/173-b2c-address-book-merge/` T-I1 – T-I6 — the release-1 job that
 * retires the personal address book (FR-006 – FR-009, OD-2, OD-9).
 *
 * A B2C account's live personal-book rows are **moved** into its personal
 * Organization's book through `addresses`' own write port — de-duplicated by
 * `addressFingerprint`, keeping an Organization default, each source row
 * soft-deleted with a link to the row it became and audited. Every other live
 * row is **erased**: blanked, soft-deleted and audited, copied nowhere. A row
 * the Organization book's owner refuses stays live, marked with the reason.
 *
 * Every port is real except the Organization read, which is `organizations`'
 * own record mapping over the same table — and, for the org-less case, a read
 * that answers "no such Organization", the one way an account can stand outside
 * every Organization under a `NOT NULL` foreign key.
 */
describe('AddressBookRetirementService', () => {
  let db: TestDb;
  let em: EntityManager;
  let audit: AuditLogService;
  let personalOrgs: PersonalOrganizationService;
  let addresses: AddressServicePort;
  /** Organizations the Organization read pretends not to find (the org-less case). */
  let missingOrganizations: Set<string>;

  /** A country `dictionaries` no longer offers for new entries. */
  const RETIRED_COUNTRY = 'YU';
  const validator: DictionaryValidator = {
    validateCountryCode: async (code) => {
      if (code.toUpperCase() === RETIRED_COUNTRY) {
        throw new DictionaryReferenceError({
          code: 'DICTIONARY_ENTRY_INACTIVE',
          entryType: 'country',
          entryCode: code,
        });
      }
    },
    validateCurrencyCode: async () => undefined,
    validateLanguageCode: async () => undefined,
    invalidate: () => undefined,
  };

  function service(): AddressBookRetirementService {
    return new AddressBookRetirementService({
      emFactory: () => em,
      accounts: customerAccountPortsFor(() => em).read,
      organizations: {
        findByIds: async (ids) => {
          const rows = await em.find(Organization, { id: { $in: [...ids] } });
          return rows.filter((o) => !missingOrganizations.has(o.id)).map(toOrganizationRecord);
        },
      },
      addresses,
      auditLog: audit,
    });
  }

  beforeAll(async () => {
    db = await setupTestDb();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    audit = new AuditLogService(() => em);
    personalOrgs = new PersonalOrganizationService(() => em, customerAccountPortsFor(() => em), audit);
    addresses = createAddressServicePort(() => new AddressService(() => em, validator, audit));
    missingOrganizations = new Set();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  const unique = (): string => `${Date.now()}-${Math.floor(performance.now() * 1000)}-${Math.random()}`;

  /** The B2C shape: an account in its own single-member personal Organization. */
  async function personalCustomer(): Promise<CustomerAccount> {
    const id = randomUUID();
    const email = `retire-b2c-${unique()}@example.test`;
    const org = await personalOrgs.provisionFor(em, { customerAccountId: id, email, firstName: 'Anna', lastName: 'Nowak' });
    const account = em.create(CustomerAccount, {
      id,
      organizationId: org.id,
      email,
      passwordHash: 'x'.repeat(32),
      firstName: 'Anna',
      lastName: 'Nowak',
    });
    await em.persistAndFlush(account);
    return account;
  }

  async function companyMember(org?: Organization): Promise<CustomerAccount> {
    const organization = org ?? (await seedAdHocOrganization(em, 'Retirement Company'));
    const account = em.create(CustomerAccount, {
      organizationId: organization.id,
      email: `retire-company-${unique()}@example.test`,
      passwordHash: 'x'.repeat(32),
      firstName: 'Piotr',
      lastName: 'Firma',
    });
    await em.persistAndFlush(account);
    return account;
  }

  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  async function personalRow(
    account: CustomerAccount,
    over: Partial<CustomerAddressRow> = {},
  ): Promise<CustomerAddressRow> {
    clock += 60_000;
    const row = em.create(CustomerAddress, {
      customerAccountId: account.id,
      kind: 'delivery',
      recipientName: 'Anna Nowak',
      street: 'ul. Długa 5',
      city: 'Gdańsk',
      postalCode: '80-001',
      country: 'PL',
      phone: '+48 500 600 700',
      isDefault: false,
      createdAt: new Date(clock),
      ...over,
    });
    await em.persistAndFlush(row);
    return row;
  }

  async function reload(row: CustomerAddressRow): Promise<CustomerAddressRow> {
    em.clear();
    const fresh = await em.findOne(CustomerAddress, { id: row.id });
    if (!fresh) throw new Error(`row ${row.id} vanished`);
    return fresh;
  }

  async function book(organizationId: string): Promise<AddressRow[]> {
    em.clear();
    return em.find(Address, { organizationId, deletedAt: null }, { orderBy: { createdAt: 'asc' } });
  }

  async function auditFor(objectId: string): Promise<AuditLogEntry[]> {
    return em.find(AuditLogEntry, { objectType: 'customer_address', objectId });
  }

  it('T-I1 — moves three rows, one a duplicate: two addresses created, three rows linked, soft-deleted and audited', async () => {
    const anna = await personalCustomer();
    const home = await personalRow(anna, { isDefault: true });
    const homeAgain = await personalRow(anna, {
      recipientName: '  anna   NOWAK ',
      street: 'UL. DŁUGA 5',
      postalCode: ' 80-001 ',
      phone: '+48 (500) 600-700',
    });
    const billing = await personalRow(anna, { kind: 'billing', street: 'ul. Krótka 2', phone: null });

    const result = await service().runInScope();

    expect(result).toMatchObject({ accounts: 1, moved: 2, deduplicated: 1, erased: 0, refused: 0 });
    const orgBook = await book(anna.organizationId);
    expect(orgBook).toHaveLength(2);
    const delivery = orgBook.find((a) => a.kind === 'delivery')!;
    const bill = orgBook.find((a) => a.kind === 'billing')!;
    expect(delivery).toMatchObject({ recipientName: 'Anna Nowak', street: 'ul. Długa 5', city: 'Gdańsk', isDefault: true });
    expect(bill).toMatchObject({ street: 'ul. Krótka 2', isDefault: false });

    for (const [row, target] of [
      [home, delivery],
      [homeAgain, delivery],
      [billing, bill],
    ] as const) {
      const fresh = await reload(row);
      expect(fresh.mergedIntoAddressId).toBe(target.id);
      expect(fresh.mergedAt).toBeInstanceOf(Date);
      expect(fresh.deletedAt).toBeInstanceOf(Date);
      expect(fresh.isDefault).toBe(false);
      expect(fresh.mergeRefusal ?? null).toBeNull();
      const entries = await auditFor(row.id);
      expect(entries.map((e) => e.action)).toEqual(['customer_address.merge']);
      expect(entries[0]!.actorAdminUserId ?? null).toBeNull();
    }
  });

  it('T-I1 — keeps an existing Organization default and makes a personal default the default only where the book has none', async () => {
    const anna = await personalCustomer();
    const orgDefault = await addresses.createAddress(anna.organizationId, {
      kind: 'delivery',
      recipientName: 'Anna Nowak',
      street: 'ul. Inna 9',
      city: 'Gdańsk',
      postalCode: '80-002',
      country: 'PL',
      isDefault: true,
    });
    await personalRow(anna, { isDefault: true });
    await personalRow(anna, { kind: 'billing', isDefault: true });

    await service().runInScope();

    const orgBook = await book(anna.organizationId);
    const defaults = orgBook.filter((a) => a.isDefault);
    expect(defaults.map((a) => [a.kind, a.id === orgDefault.id])).toEqual(
      expect.arrayContaining([
        ['delivery', true],
        ['billing', false],
      ]),
    );
    expect(defaults).toHaveLength(2);
  });

  it('T-I2 — a second run changes nothing', async () => {
    const anna = await personalCustomer();
    const row = await personalRow(anna, { isDefault: true });
    await service().runInScope();
    const afterFirst = await book(anna.organizationId);
    const linked = await reload(row);

    const second = await service().runInScope();

    expect(second).toMatchObject({ accounts: 0, moved: 0, deduplicated: 0, erased: 0, refused: 0 });
    expect((await book(anna.organizationId)).map((a) => [a.id, a.isDefault])).toEqual(
      afterFirst.map((a) => [a.id, a.isDefault]),
    );
    const again = await reload(row);
    expect(again.mergedIntoAddressId).toBe(linked.mergedIntoAddressId);
    expect(again.mergedAt?.toISOString()).toBe(linked.mergedAt?.toISOString());
    expect(await auditFor(row.id)).toHaveLength(1);
    expect(await service().hasWork()).toBe(false);
  });

  it('T-I3 — a crash between the Organization write and the source update leaves no duplicate', async () => {
    const anna = await personalCustomer();
    const row = await personalRow(anna);
    // The state a crash leaves: the first run's Organization write committed
    // (it is `addresses`' own transaction) and the process died before the
    // source row was marked, so the row is still live and unlinked. Written
    // here rather than provoked, because whether the owner's write joins this
    // module's transaction is the ORM's affair — the job must be right either way.
    await addresses.createAddress(anna.organizationId, {
      kind: row.kind,
      recipientName: row.recipientName,
      street: row.street,
      city: row.city,
      postalCode: row.postalCode,
      country: row.country,
      ...(row.phone ? { phone: row.phone } : {}),
    });
    expect((await reload(row)).deletedAt ?? null).toBeNull();

    const result = await service().runInScope();

    expect(result).toMatchObject({ moved: 0, deduplicated: 1 });
    const orgBook = await book(anna.organizationId);
    expect(orgBook).toHaveLength(1);
    const fresh = await reload(row);
    expect(fresh.mergedIntoAddressId).toBe(orgBook[0]!.id);
    expect(fresh.deletedAt).toBeInstanceOf(Date);
  });

  it('T-I4 — a company-member row and an org-less row are blanked, soft-deleted and audited; the company book is untouched', async () => {
    const company = await seedAdHocOrganization(em, 'Retirement Company Book');
    const companyAddress = await addresses.createAddress(company.id, {
      kind: 'delivery',
      recipientName: 'Firma Sp. z o.o.',
      street: 'ul. Fabryczna 1',
      city: 'Łódź',
      postalCode: '90-001',
      country: 'PL',
      isDefault: true,
    });
    const member = await companyMember(company);
    const memberRow = await personalRow(member, { isDefault: true });
    const orgless = await companyMember();
    missingOrganizations.add(orgless.organizationId);
    const orglessRow = await personalRow(orgless, { kind: 'billing' });

    const result = await service().runInScope();

    expect(result).toMatchObject({ accounts: 2, moved: 0, deduplicated: 0, erased: 2, refused: 0 });
    for (const row of [memberRow, orglessRow]) {
      const fresh = await reload(row);
      expect(fresh).toMatchObject({
        recipientName: '-',
        street: '-',
        city: '-',
        postalCode: '-',
        country: 'PL',
        isDefault: false,
      });
      expect(fresh.phone ?? null).toBeNull();
      expect(fresh.deletedAt).toBeInstanceOf(Date);
      expect(fresh.mergedIntoAddressId ?? null).toBeNull();
      const entries = await auditFor(row.id);
      expect(entries.map((e) => e.action)).toEqual(['customer_address.erased']);
      expect(JSON.stringify(entries.map((e) => [e.stateBefore, e.stateAfter]))).not.toContain('Nowak');
    }
    const companyBook = await book(company.id);
    expect(companyBook.map((a) => [a.id, a.street, a.isDefault])).toEqual([
      [companyAddress.id, 'ul. Fabryczna 1', true],
    ]);
  });

  it("T-I5 — an owner refusal sets merge_refusal and lets the account's other rows through", async () => {
    const anna = await personalCustomer();
    const refused = await personalRow(anna, { country: RETIRED_COUNTRY });
    const fine = await personalRow(anna, { street: 'ul. Nowa 3' });

    const result = await service().runInScope();

    expect(result).toMatchObject({ accounts: 1, moved: 1, refused: 1 });
    const kept = await reload(refused);
    expect(kept.deletedAt ?? null).toBeNull();
    expect(kept.mergeRefusal).toBe('DICTIONARY_ENTRY_INACTIVE');
    expect(kept.mergedIntoAddressId ?? null).toBeNull();
    expect((await auditFor(refused.id)).map((e) => e.action)).toEqual(['customer_address.merge_refused']);
    const moved = await reload(fine);
    expect(moved.deletedAt).toBeInstanceOf(Date);
    expect((await book(anna.organizationId)).map((a) => a.street)).toEqual(['ul. Nowa 3']);

    // A refused row is not retried by the next run: it waits for the operator.
    expect(await service().runInScope()).toMatchObject({ accounts: 0, refused: 0 });
    expect(await service().hasWork()).toBe(false);
  });

  it("T-I6 — created rows land in the account's own personal Organization and nowhere else", async () => {
    const anna = await personalCustomer();
    const piotr = await personalCustomer();
    await personalRow(anna, { street: 'ul. Anny 1' });
    await personalRow(piotr, { street: 'ul. Piotra 2' });

    await service().runInScope();

    const reader = new AddressReadService(() => em);
    expect((await reader.listForOrganization(anna.organizationId)).map((a) => a.street)).toEqual(['ul. Anny 1']);
    expect((await reader.listForOrganization(piotr.organizationId)).map((a) => a.street)).toEqual(['ul. Piotra 2']);
    const company = await seedAdHocOrganization(em, 'Bystander');
    expect(await reader.listForOrganization(company.id)).toEqual([]);
  });
});
