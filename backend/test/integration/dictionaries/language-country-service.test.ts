import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { LanguageCountryService } from '../../../src/modules/dictionaries/services/language-country-service.js';

import { dictionaryReadPortsFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { LanguageCountry } from '../../../src/modules/dictionaries/entities/language-country.entity.js';

/**
 * T020 — LanguageCountryService primary-flag invariant
 * (feature 017 / US1).
 *
 * The "at most one primary language per Country" invariant is enforced by
 * the partial unique index `uniq_language_countries_primary_per_country`
 * in the migration; the service implements the transactional promote-with-
 * demote pattern so a set-primary call never violates the index.
 */
describe('LanguageCountryService — primary-flag invariant', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: LanguageCountryService;

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
    service = new LanguageCountryService(() => em, dictionaryReadPortsFor(() => em).languages);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('T020 promoting a different language for the same country atomically demotes the prior primary', async () => {
    // pl-PL is the seeded primary for PL.
    const before = await em.findOne(LanguageCountry, {
      countryCode: 'PL',
      isPrimary: true,
    });
    expect(before?.languageCode).toBe('pl-PL');

    // Promote en-US as primary for PL — must succeed and demote pl-PL.
    await service.upsert({ languageCode: 'en-US', countryCode: 'PL', isPrimary: true });

    const allForPl = await em.find(LanguageCountry, { countryCode: 'PL' });
    const primaries = allForPl.filter((r) => r.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.languageCode).toBe('en-US');
  });

  it('T020 upsert with isPrimary=false preserves the prior primary on the same country', async () => {
    // Add en-US to PL as non-primary; pl-PL remains primary.
    await service.upsert({ languageCode: 'en-US', countryCode: 'PL', isPrimary: false });
    const primaries = await em.find(LanguageCountry, {
      countryCode: 'PL',
      isPrimary: true,
    });
    expect(primaries.map((r) => r.languageCode)).toEqual(['pl-PL']);
  });

  it('T020 refuses to upsert against a non-existent language', async () => {
    await expect(
      service.upsert({ languageCode: 'zz-ZZ', countryCode: 'PL' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });

  it('T020 refuses to upsert against a non-existent country', async () => {
    await expect(
      service.upsert({ languageCode: 'pl-PL', countryCode: 'ZZ' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });
});
