/**
 * The audit-state rule for the retired personal address book
 * (`specs/conventions/audit-state.md`, D-288, issue #470). A `CustomerAddress` is
 * `@CustomerScoped`, and the platform audit log is one global table read under
 * `audit_log:read` without Organization reach, so the retirement job's and the
 * retention sweep's entries carry names and structure: the kind, codes, booleans,
 * dates and the id of the Organization address a row was moved into. Never the
 * recipient, street, city, postal code or phone, never the account the row belongs
 * to (the tenant anchor) and never the Organization it moved to — the entry is
 * recorded against the row by id. No screen reads these values back out of the
 * audit log, so there is no value store.
 *
 * The service runs against an in-memory EntityManager and stub ports; the audit
 * port records what it is handed.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AddressRecord } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { CustomerAddress } from '../entities/customer-address.entity.js';
import { AddressBookRetirementService } from './address-book-retirement-service.js';
import { CUSTOMER_ADDRESS_AUDIT_KEYS } from './customer-address-audit-state.js';

const ACCOUNT = randomUUID();
const PERSONAL_ORG = randomUUID();
const COMPANY_ORG = randomUUID();
const SENTINELS = [ACCOUNT, PERSONAL_ORG, COMPANY_ORG, 'S470-NAME', 'S470-STREET', 'S470-CITY', 'S470-POSTAL', '+48470470470'];

function aRow(over: Partial<CustomerAddress> = {}): CustomerAddress {
  const row = new CustomerAddress();
  row.id = randomUUID();
  row.customerAccountId = ACCOUNT;
  row.kind = 'delivery';
  row.recipientName = 'S470-NAME';
  row.street = 'S470-STREET';
  row.city = 'S470-CITY';
  row.postalCode = 'S470-POSTAL';
  row.country = 'PL';
  row.phone = '+48470470470';
  row.isDefault = false;
  row.deletedAt = null;
  row.mergeRefusal = null;
  Object.assign(row, over);
  return row;
}

function harness(rows: CustomerAddress[], organization: { id: string; isPersonal: boolean }) {
  const entries: RecordAuditInput[] = [];
  let accountBatches = 0;
  const pending = () => rows.filter((r) => r.deletedAt == null && r.mergeRefusal == null);
  const em = {
    execute: async () => (accountBatches++ === 0 ? [{ id: ACCOUNT }] : []),
    find: async (_entity: unknown, where: Record<string, unknown>) => ('$or' in where ? rows : pending()),
    flush: async () => undefined,
    transactional: async <T>(fn: (tx: EntityManager) => Promise<T>) => fn(em as unknown as EntityManager),
  };
  const audit = {
    recordWithin: (_em: EntityManager, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return {} as never;
    },
  } as unknown as AuditPort;
  let created = 0;
  const service = new AddressBookRetirementService({
    emFactory: () => em as unknown as EntityManager,
    accounts: { findByIds: async () => [{ id: ACCOUNT, organizationId: organization.id }] as never },
    organizations: { findByIds: async () => [{ ...organization, deletedAt: null }] as never },
    addresses: {
      list: async () => [],
      createAddress: async (_org: string, input: { kind: 'delivery' | 'billing' }) => {
        created += 1;
        if (created === 2) throw new HttpError(409, 'DICTIONARY_ENTRY_INACTIVE', 'S470-NAME refused');
        return { id: randomUUID(), kind: input.kind, isDefault: false } as unknown as AddressRecord;
      },
    },
    auditLog: audit,
  });
  return { service, entries };
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) expect(CUSTOMER_ADDRESS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
    }
  }
}

describe('retired personal address book audit state carries names, never values (#470)', () => {
  it('customer_address.merge and .merge_refused hold no value, no account and no Organization', async () => {
    const rows = [aRow({ isDefault: true }), aRow({ kind: 'billing' })];
    const h = harness(rows, { id: PERSONAL_ORG, isPersonal: true });

    await h.service.runInScope();

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => [e.action, e.objectId])).toEqual([
      ['customer_address.merge', rows[0]!.id],
      ['customer_address.merge_refused', rows[1]!.id],
    ]);
    expect(h.entries[0]?.stateBefore).toEqual({ kind: 'delivery' });
    expect(h.entries[0]?.stateAfter).toEqual({
      mergedIntoAddressId: rows[0]!.mergedIntoAddressId,
      deduplicated: false,
      wasDefault: true,
    });
    expect(h.entries[1]?.stateAfter).toEqual({ mergeRefusal: 'DICTIONARY_ENTRY_INACTIVE' });
  });

  it('customer_address.erased holds no value and no account', async () => {
    const rows = [aRow()];
    const h = harness(rows, { id: COMPANY_ORG, isPersonal: false });

    await h.service.runInScope();

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.action)).toEqual(['customer_address.erased']);
    expect(h.entries[0]?.stateBefore).toEqual({ kind: 'delivery' });
    expect(Object.keys(h.entries[0]?.stateAfter ?? {})).toEqual(['erasedAt']);
  });

  it('customer_address.anonymized records the kind and whether the row was deleted, never the account', async () => {
    const rows = [aRow(), aRow({ kind: 'billing', deletedAt: new Date('2025-01-02T03:04:05.000Z') })];
    const h = harness(rows, { id: PERSONAL_ORG, isPersonal: true });

    expect(await h.service.anonymizeForAccount(ACCOUNT)).toBe(2);

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.stateBefore)).toEqual([
      { kind: 'delivery', wasDeleted: false },
      { kind: 'billing', wasDeleted: true },
    ]);
    for (const entry of h.entries) expect(Object.keys(entry.stateAfter ?? {})).toEqual(['anonymizedAt']);
  });
});
