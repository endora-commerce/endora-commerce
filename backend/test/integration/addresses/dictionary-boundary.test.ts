import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { AddressService } from '../../../../packages/modules/addresses/src/backend/services/address-service.js';
import { Country } from '../../helpers/package-entities.js';

describe('Addresses dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: AddressService;
  let organizationId: string;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconcilerFor(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    validator = dictionaryValidatorFor(() => em);
    service = new AddressService(() => em, validator);
    const org = em.create(Organization, {
      name: 'Dictionary Boundary Org',
      taxId: `BOUNDARY-${crypto.randomUUID().slice(0, 8)}`,
      status: 'active',
      registeredAddress: {
        street: 'Main',
        city: 'Warsaw',
        postalCode: '00-001',
        country: 'PL',
      },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('keeps historical reads working after the stored country becomes inactive', async () => {
    await service.createAddress(organizationId, baseAddress({ country: 'PL' }));
    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();

    const rows = await service.list(organizationId);
    expect(rows[0]?.country).toBe('PL');
  });

  it('refuses unknown and inactive countries on create', async () => {
    await expect(
      service.createAddress(organizationId, baseAddress({ country: 'ZZ' })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });

    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();
    await expect(
      service.createAddress(organizationId, baseAddress({ country: 'PL' })),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });

  it('allows unchanged inactive country updates but validates country changes', async () => {
    const address = await service.createAddress(organizationId, baseAddress({ country: 'PL' }));
    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();

    await expect(
      service.updateAddress(organizationId, address.id, { country: 'PL', city: 'Krakow' }),
    ).resolves.toMatchObject({ city: 'Krakow', country: 'PL' });
    await expect(
      service.updateAddress(organizationId, address.id, { country: 'ZZ' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });
});

function baseAddress({ country }: { country: string }) {
  return {
    kind: 'delivery' as const,
    recipientName: 'Buyer',
    street: 'Main',
    city: 'Warsaw',
    postalCode: '00-001',
    country,
  };
}
