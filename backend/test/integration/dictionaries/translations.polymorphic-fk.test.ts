import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import { dictionaryReadPortsFor } from '../../helpers/dictionary-services.js';
import { TranslationService } from '../../../src/modules/dictionaries/services/translation-service.js';

describe('TranslationService — polymorphic parent invariant', () => {
  let db: TestDb;
  let em: EntityManager;
  let service: TranslationService;

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
    service = new TranslationService(
      () => em,
      dictionaryReadPortsFor(() => em).currencies,
      dictionaryReadPortsFor(() => em).languages,
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses a translation for a missing polymorphic parent', async () => {
    await expect(
      service.upsert({
        entryType: 'country',
        entryCode: 'XX',
        languageCode: 'pl-PL',
        label: 'Nie istnieje',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });

  it('upserts translations across all three entry kinds', async () => {
    await expect(
      service.upsert({
        entryType: 'country',
        entryCode: 'DE',
        languageCode: 'pl-PL',
        label: 'Niemcy',
      }),
    ).resolves.toMatchObject({ entryType: 'country', entryCode: 'DE' });
    await expect(
      service.upsert({
        entryType: 'currency',
        entryCode: 'EUR',
        languageCode: 'pl-PL',
        label: 'Euro',
      }),
    ).resolves.toMatchObject({ entryType: 'currency', entryCode: 'EUR' });
    await expect(
      service.upsert({
        entryType: 'language',
        entryCode: 'en-US',
        languageCode: 'pl-PL',
        label: 'Angielski',
      }),
    ).resolves.toMatchObject({ entryType: 'language', entryCode: 'en-US' });
  });
});
