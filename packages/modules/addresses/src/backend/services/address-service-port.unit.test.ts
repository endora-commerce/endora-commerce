import { describe, expect, it } from 'vitest';
import type { AddressRecord } from '@endora-commerce/contracts';
// The class from the package's **source**: this test constructs one instance and
// hands it to a stubbed service, never to an ORM, so the door in
// `helpers/package-entities.ts` — which exists to keep one *registered* class —
// has nothing to protect here and returns a non-constructable type.
import { Address } from '../entities/address.entity.js';
import type { AddressService } from './address-service.js';
import { createAddressServicePort } from './address-ports.js';

/**
 * `createAddressServicePort` — the record-mapping adapter behind
 * `addressServicePort` (feature 075, Phase P; §3.4 of the D-98 record).
 *
 * It acquired its first consumers with issue #195, when `orders` and
 * `organizations` stopped resolving the `addressService` **class** registration
 * beside it. What the re-point buys is exactly one thing — the `Address` entity
 * stops crossing the boundary — so this suite asserts that one thing on every
 * method that returns: the published fields are all populated, and nothing the
 * entity carries beyond them comes with them.
 */

const PUBLISHED_FIELDS: ReadonlyArray<keyof AddressRecord> = [
  'id',
  'organizationId',
  'kind',
  'recipientName',
  'street',
  'city',
  'postalCode',
  'country',
  'phone',
  'isDefault',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

function anAddress(): Address {
  const address = new Address();
  address.id = '00000000-0000-4000-8000-0000000000a1';
  address.organizationId = '00000000-0000-4000-8000-0000000000a2';
  address.kind = 'delivery';
  address.recipientName = 'Jan Kowalski';
  address.street = 'ul. Testowa 1';
  address.city = 'Warszawa';
  address.postalCode = '00-001';
  address.country = 'PL';
  address.phone = '+48 111 222 333';
  address.isDefault = true;
  address.createdAt = new Date('2026-01-01T00:00:00.000Z');
  address.updatedAt = new Date('2026-01-02T00:00:00.000Z');
  address.deletedAt = null;
  return address;
}

/** A service stub that hands back the live entity, as the real one does. */
function serviceReturning(address: Address): () => AddressService {
  const service = {
    list: async () => [address],
    createAddress: async () => address,
    updateAddress: async () => address,
    deleteAddress: async () => undefined,
  } as unknown as AddressService;
  return () => service;
}

describe('createAddressServicePort', () => {
  const address = anAddress();
  const port = createAddressServicePort(serviceReturning(address));

  it('populates every published field on `createAddress`', async () => {
    const record = await port.createAddress(address.organizationId, {
      kind: 'delivery',
      recipientName: address.recipientName,
      street: address.street,
      city: address.city,
      postalCode: address.postalCode,
      country: address.country,
    });
    for (const field of PUBLISHED_FIELDS) {
      expect(record[field]).toEqual(address[field as keyof Address]);
    }
  });

  it('hands back a snapshot, not the entity, on every returning method', async () => {
    const [listed] = await port.list(address.organizationId);
    const created = await port.createAddress(address.organizationId, {
      kind: 'delivery',
      recipientName: address.recipientName,
      street: address.street,
      city: address.city,
      postalCode: address.postalCode,
      country: address.country,
    });
    const updated = await port.updateAddress(address.organizationId, address.id, { city: 'Kraków' });

    for (const record of [listed, created, updated]) {
      expect(record).toBeDefined();
      expect(record).not.toBeInstanceOf(Address);
      // No field beyond the published set travels — the record is a literal, so
      // a relation or an internal column added to the entity later stays home.
      expect(Object.keys(record as object).sort()).toEqual([...PUBLISHED_FIELDS].sort());
    }
  });

  it('normalises the two nullable columns rather than forwarding `undefined`', async () => {
    const bare = anAddress();
    delete bare.phone;
    delete bare.deletedAt;
    const record = await createAddressServicePort(serviceReturning(bare)).createAddress(
      bare.organizationId,
      {
        kind: 'delivery',
        recipientName: bare.recipientName,
        street: bare.street,
        city: bare.city,
        postalCode: bare.postalCode,
        country: bare.country,
      },
    );
    expect(record.phone).toBeNull();
    expect(record.deletedAt).toBeNull();
  });
});
