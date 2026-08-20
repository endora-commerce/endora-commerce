import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../src/modules/dictionaries/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { Country } from '../../../src/modules/dictionaries/entities/country.entity.js';
import { WarehouseService } from '../../../src/modules/inventory/services/warehouse-service.js';

describe('Inventory warehouse dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: WarehouseService;

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
    service = new WarehouseService(() => em, validator);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses unknown and inactive warehouse address countries on create', async () => {
    await expect(service.create(baseWarehouse('wh-unknown', 'ZZ'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });

    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();
    await expect(service.create(baseWarehouse('wh-inactive', 'PL'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });

  it('allows unchanged inactive warehouse country updates but validates changes', async () => {
    const created = await service.create(baseWarehouse('wh-pl', 'PL'));
    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();

    await expect(
      service.update(created.id, {
        name: 'Warehouse PL updated',
        address: { street: 'Main', city: 'Warsaw', postalCode: '00-001', countryCode: 'PL' },
      }),
    ).resolves.toMatchObject({ address: { countryCode: 'PL' } });
    await expect(
      service.update(created.id, {
        address: { street: 'Main', city: 'Warsaw', postalCode: '00-001', countryCode: 'ZZ' },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });
});

function baseWarehouse(code: string, countryCode: string) {
  return {
    name: `Warehouse ${code}`,
    code,
    address: { street: 'Main', city: 'Warsaw', postalCode: '00-001', countryCode },
  };
}
