/**
 * The audit-state rule for Organization addresses (`specs/conventions/audit-state.md`,
 * D-288, issue #470). An `Address` is `@OrgScoped`, and the platform audit log is one
 * global table read under `audit_log:read` without Organization reach, so an address's
 * entries carry names and structure: the kind, the names of the fields that changed,
 * whether a removed row was already deleted, and dates. Never the recipient, the street,
 * the city, the postal code, the phone or the Organization the address belongs to (the
 * tenant anchor). No address screen reads values back out of the audit log, so there is
 * no value store: the address row holds the current values.
 *
 * Every write records through `recordAuditFromContext` / `recordWithin` on the caller's
 * transaction; the EntityManager is an in-memory stand-in and the audit port records
 * what it is handed.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { expectNoAuditValues } from '@endora-commerce/test-kit/audit';
import { Address } from '../entities/address.entity.js';
import { ADDRESS_AUDIT_KEYS } from './address-audit-state.js';
import { AddressService } from './address-service.js';

const ORG = randomUUID();
const SENTINELS = [ORG, 'S470-NAME', 'S470-STREET', 'S470-CITY', 'S470-POSTAL', '+48470470470'];

function aStoredAddress(over: Partial<Address> = {}): Address {
  const address = new Address();
  address.id = randomUUID();
  address.organizationId = ORG;
  address.kind = 'delivery';
  address.recipientName = 'S470-NAME';
  address.street = 'S470-STREET';
  address.city = 'S470-CITY';
  address.postalCode = 'S470-POSTAL';
  address.country = 'PL';
  address.phone = '+48470470470';
  address.isDefault = false;
  address.deletedAt = null;
  Object.assign(address, over);
  return address;
}

function harness(stored: Address[] = []) {
  const entries: RecordAuditInput[] = [];
  const em = {
    find: async () => stored,
    findOne: async () => stored[0] ?? null,
    nativeUpdate: async () => 0,
    create: (_entity: unknown, data: Record<string, unknown>) => Object.assign(new Address(), { id: randomUUID(), ...data }),
    persist: () => undefined,
    flush: async () => undefined,
    transactional: async <T>(fn: (tx: EntityManager) => Promise<T>) => fn(em as unknown as EntityManager),
  };
  const audit = {
    recordWithin: (_em: EntityManager, input: RecordAuditInput) => {
      entries.push(structuredClone(input));
      return {} as never;
    },
  } as unknown as AuditPort;
  const service = new AddressService(() => em as unknown as EntityManager, undefined, audit);
  return { service, entries };
}

function expectKeysAllowlisted(entries: readonly RecordAuditInput[]): void {
  for (const entry of entries) {
    for (const state of [entry.stateBefore, entry.stateAfter]) {
      for (const key of Object.keys(state ?? {})) expect(ADDRESS_AUDIT_KEYS, `${entry.action}: ${key}`).toContain(key);
    }
  }
}

describe('Organization address audit state carries names, never values (#470)', () => {
  it('address.create names the fields it was created with, and holds no value nor the Organization', async () => {
    const h = harness();
    const address = await h.service.createAddress(ORG, {
      kind: 'billing',
      recipientName: 'S470-NAME',
      street: 'S470-STREET',
      city: 'S470-CITY',
      postalCode: 'S470-POSTAL',
      country: 'pl',
      phone: '+48470470470',
      isDefault: true,
    });

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => [e.action, e.objectType, e.objectId])).toEqual([['address.create', 'address', address.id]]);
    expect(h.entries[0]?.stateBefore).toBeNull();
    expect(h.entries[0]?.stateAfter).toEqual({
      kind: 'billing',
      changedFields: ['city', 'country', 'isDefault', 'phone', 'postalCode', 'recipientName', 'street'],
    });
  });

  it('address.update names exactly the fields whose value changed', async () => {
    const stored = aStoredAddress();
    const h = harness([stored]);

    await h.service.updateAddress(ORG, stored.id, {
      recipientName: 'S470-NAME-2',
      street: 'S470-STREET',
      phone: '+48470470471',
      isDefault: true,
    });

    expectNoAuditValues(h.entries, [...SENTINELS, '+48470470471']);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => [e.action, e.objectId])).toEqual([['address.update', stored.id]]);
    expect(h.entries[0]?.stateAfter).toEqual({ kind: 'delivery', changedFields: ['isDefault', 'phone', 'recipientName'] });
  });

  it('address.delete names the kind of the row it removed, nothing else', async () => {
    const stored = aStoredAddress({ kind: 'billing' });
    const h = harness([stored]);

    await h.service.deleteAddress(ORG, stored.id);

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries[0]?.stateBefore).toEqual({ kind: 'billing' });
    expect(h.entries[0]?.stateAfter).toBeNull();
  });

  it('address.anonymized records the kind, whether the row was deleted and when, never the Organization', async () => {
    const stored = [aStoredAddress(), aStoredAddress({ kind: 'billing', deletedAt: new Date('2025-01-02T03:04:05.000Z') })];
    const h = harness(stored);

    expect(await h.service.anonymizeForOrganization(ORG)).toBe(2);

    expectNoAuditValues(h.entries, SENTINELS);
    expectKeysAllowlisted(h.entries);
    expect(h.entries.map((e) => e.stateBefore)).toEqual([
      { kind: 'delivery', wasDeleted: false },
      { kind: 'billing', wasDeleted: true },
    ]);
    for (const entry of h.entries) expect(Object.keys(entry.stateAfter ?? {})).toEqual(['anonymizedAt']);
  });
});
