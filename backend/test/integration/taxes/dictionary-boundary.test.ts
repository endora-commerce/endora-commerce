import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { TaxService } from '../../../../packages/modules/taxes/src/backend/services/tax-service.js';
import { Country } from '../../helpers/package-entities.js';

describe('Taxes dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: TaxService;

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
    service = new TaxService(() => em, undefined, validator);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('exempts any-country rules from country validation', async () => {
    const row = await service.upsertByCode(baseTax({ country: null }));
    expect(row.country ?? null).toBeNull();
  });

  it('refuses unknown and inactive country codes on create', async () => {
    await expect(service.upsertByCode(baseTax({ country: 'ZZ' }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();
    await expect(service.upsertByCode(baseTax({ country: 'PL' }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });

  it('allows unchanged inactive country updates but validates changes', async () => {
    await service.upsertByCode(baseTax({ country: 'PL' }));
    await em.nativeUpdate(Country, { code: 'PL' }, { isActive: false });
    validator.invalidate();

    await expect(
      service.upsertByCode({ ...baseTax({ country: 'PL' }), name: 'PL VAT updated' }),
    ).resolves.toMatchObject({ country: 'PL', name: 'PL VAT updated' });
    await expect(
      service.upsertByCode({ ...baseTax({ country: 'ZZ' }), name: 'PL VAT updated again' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });
});

function baseTax({ country }: { country: string | null }) {
  return {
    code: 'vat-boundary',
    name: 'Boundary VAT',
    rate: 0.23,
    country,
    appliesToVatStatuses: ['vat_payer'] as Array<'vat_payer'>,
  };
}
