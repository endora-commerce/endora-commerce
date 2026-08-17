import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DictionaryReferenceError } from '@b2b/contracts';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import type { DictionaryValidator } from '../../../src/modules/dictionaries/services/dictionary-validator.js';
import { dictionaryValidatorFor } from '../../helpers/dictionary-services.js';

describe('DictionaryValidator port', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;

  beforeAll(async () => {
    db = await setupTestDb();
    const conn = db.orm.em.getConnection();
    await conn.execute(`delete from "dictionary_translations"`);
    await conn.execute(`delete from "language_countries"`);
    await conn.execute(`delete from "countries"`);
    await runDictionarySeedReconciler(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    validator = dictionaryValidatorFor(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('accepts active country, currency, and language codes', async () => {
    await expect(validator.validateCountryCode('PL', 'create-or-change')).resolves.toBeUndefined();
    await expect(validator.validateCurrencyCode('PLN', 'create-or-change')).resolves.toBeUndefined();
    await expect(validator.validateLanguageCode('en-US', 'create-or-change')).resolves.toBeUndefined();
  });

  it('throws DICTIONARY_ENTRY_NOT_FOUND for unknown codes in either mode', async () => {
    await expect(validator.validateCountryCode('ZZ', 'create-or-change')).rejects.toMatchObject({
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
      entryType: 'country',
      entryCode: 'ZZ',
    });
    await expect(validator.validateCurrencyCode('ZZZ', 'unchanged')).rejects.toBeInstanceOf(
      DictionaryReferenceError,
    );
  });

  it('allows inactive codes only when mode is unchanged', async () => {
    await expect(validator.validateCountryCode('RU', 'unchanged')).resolves.toBeUndefined();
    await expect(validator.validateCountryCode('RU', 'create-or-change')).rejects.toMatchObject({
      code: 'DICTIONARY_ENTRY_INACTIVE',
      entryType: 'country',
      entryCode: 'RU',
    });
  });
});
