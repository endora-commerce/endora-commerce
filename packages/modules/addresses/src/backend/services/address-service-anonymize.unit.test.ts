import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort, RecordAuditInput } from '@endora-commerce/platform/kernel';
import { Address } from '../entities/address.entity.js';
import { AddressService } from './address-service.js';
import { createAddressServicePort } from './address-ports.js';

/**
 * `specs/173-b2c-address-book-merge/` T-U3 — `anonymizeForOrganization` (OD-7).
 *
 * When the retention sweep scrubs a B2C customer's personal Organization, its
 * saved addresses are cleared **and** blanked: the personal fields become `'-'`,
 * the phone `null`, the default flag `false`, and the row is soft-deleted. The
 * country stays, as it does on the Organization's own registered address. Each
 * row leaves one `address.anonymized` audit entry with a null actor, written in
 * the same unit of work as the scrub.
 *
 * A stub `EntityManager` stands in for the ORM: the method's contract is what it
 * does to the rows it is handed and what it records, and the statement it asks
 * for is pinned by the `find` filter below.
 */

const ORG = '00000000-0000-4000-8000-0000000000a2';

function anAddress(id: string, over: Partial<Address> = {}): Address {
  const address = new Address();
  address.id = id;
  address.organizationId = ORG;
  address.kind = 'delivery';
  address.recipientName = 'Jan Kowalski';
  address.street = 'ul. Testowa 1';
  address.city = 'Warszawa';
  address.postalCode = '00-001';
  address.country = 'PL';
  address.phone = '+48 111 222 333';
  address.isDefault = true;
  address.deletedAt = null;
  Object.assign(address, over);
  return address;
}

function harness(rows: Address[]) {
  const recorded: RecordAuditInput[] = [];
  const filters: unknown[] = [];
  let flushed = 0;
  let inTransaction = false;
  const em = {
    find: async (_entity: unknown, where: unknown) => {
      filters.push(where);
      return rows;
    },
    flush: async () => {
      expect(inTransaction, 'the scrub flushes inside its transaction').toBe(true);
      flushed += 1;
    },
    transactional: async <T>(fn: (tx: EntityManager) => Promise<T>) => {
      inTransaction = true;
      try {
        return await fn(em as unknown as EntityManager);
      } finally {
        inTransaction = false;
      }
    },
  };
  const audit = {
    recordWithin: (_em: EntityManager, input: RecordAuditInput) => {
      recorded.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const service = new AddressService(() => em as unknown as EntityManager, undefined, audit);
  return { service, recorded, filters, flushed: () => flushed };
}

describe('AddressService.anonymizeForOrganization (T-U3)', () => {
  it("blanks and soft-deletes every live address of the Organization, keeping the country", async () => {
    const rows = [
      anAddress('00000000-0000-4000-8000-0000000000b1'),
      anAddress('00000000-0000-4000-8000-0000000000b2', { kind: 'billing', country: 'DE', phone: null }),
    ];
    const { service, filters, flushed } = harness(rows);

    const count = await service.anonymizeForOrganization(ORG);

    expect(count).toBe(2);
    expect(filters).toEqual([{ organizationId: ORG, deletedAt: null }]);
    expect(flushed()).toBe(1);
    for (const row of rows) {
      expect(row.recipientName).toBe('-');
      expect(row.street).toBe('-');
      expect(row.city).toBe('-');
      expect(row.postalCode).toBe('-');
      expect(row.phone).toBeNull();
      expect(row.isDefault).toBe(false);
      expect(row.deletedAt).toBeInstanceOf(Date);
    }
    expect(rows.map((r) => r.country)).toEqual(['PL', 'DE']);
  });

  it('records one address.anonymized entry per row, with a null actor and no personal data', async () => {
    const rows = [anAddress('00000000-0000-4000-8000-0000000000b1'), anAddress('00000000-0000-4000-8000-0000000000b2')];
    const { service, recorded } = harness(rows);

    await service.anonymizeForOrganization(ORG);

    expect(recorded.map((r) => [r.action, r.objectType, r.objectId, r.actorAdminUserId])).toEqual([
      ['address.anonymized', 'address', rows[0]!.id, null],
      ['address.anonymized', 'address', rows[1]!.id, null],
    ]);
    expect(JSON.stringify(recorded)).not.toContain('Kowalski');
    expect(JSON.stringify(recorded)).not.toContain('Testowa');
  });

  it('answers 0 and records nothing for an Organization with no live address', async () => {
    const { service, recorded } = harness([]);
    expect(await service.anonymizeForOrganization(ORG)).toBe(0);
    expect(recorded).toEqual([]);
  });

  it('is reachable through addressServicePort', async () => {
    const rows = [anAddress('00000000-0000-4000-8000-0000000000b1')];
    const { service } = harness(rows);
    const port = createAddressServicePort(() => service);
    expect(await port.anonymizeForOrganization(ORG)).toBe(1);
    expect(rows[0]!.deletedAt).toBeInstanceOf(Date);
  });
});
