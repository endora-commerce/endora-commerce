import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import { CountryService } from '../../../../packages/modules/dictionaries/src/backend/services/country-service.js';
import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';

describe('DictionaryValidator LRU invalidation', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let countryService: CountryService;

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
    countryService = new CountryService(() => em, async () => {
      validator.invalidate();
    });
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('does not serve stale active state after a dictionary write invalidates the LRU', async () => {
    await expect(validator.validateCountryCode('DE', 'create-or-change')).resolves.toBeUndefined();
    await countryService.update('DE', { isActive: false });
    await expect(validator.validateCountryCode('DE', 'create-or-change')).rejects.toMatchObject({
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });
});
