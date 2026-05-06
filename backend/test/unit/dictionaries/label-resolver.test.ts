import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import { LabelResolver } from '../../../src/modules/dictionaries/services/label-resolver.js';
import { DictionaryTranslation } from '../../../src/modules/dictionaries/entities/dictionary-translation.entity.js';
import { Language } from '../../../src/modules/languages/entities/language.entity.js';

describe('LabelResolver — locale fallback chain', () => {
  let db: TestDb;
  let em: EntityManager;
  let resolver: LabelResolver;

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
    resolver = new LabelResolver(() => em);
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns direct translation hit', async () => {
    await expect(
      resolver.resolveLabel({ entryType: 'country', entryCode: 'DE', locale: 'pl-PL' }),
    ).resolves.toBe('Niemcy');
  });

  it('walks fallbackCode chain before canonical English fallback', async () => {
    em.persist([
      em.create(Language, {
        code: 'de',
        label: 'German',
        nativeLabel: 'Deutsch',
        fallbackCode: 'en-US',
      }),
      em.create(Language, {
        code: 'de-AT',
        label: 'German (Austria)',
        nativeLabel: 'Österreichisches Deutsch',
        fallbackCode: 'de',
      }),
    ]);
    await em.flush();
    em.persist(
      em.create(DictionaryTranslation, {
        entryType: 'country',
        entryCode: 'PL',
        languageCode: 'de',
        label: 'Polen',
      }),
    );
    await em.flush();

    await expect(
      resolver.resolveLabel({ entryType: 'country', entryCode: 'PL', locale: 'de-AT' }),
    ).resolves.toBe('Polen');
    await expect(
      resolver.resolveLabel({ entryType: 'country', entryCode: 'DE', locale: 'de-AT' }),
    ).resolves.toBe('Germany');
  });

  it('throws only when the parent entry is missing', async () => {
    await expect(
      resolver.resolveLabel({ entryType: 'country', entryCode: 'XX', locale: 'pl-PL' }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });
});
