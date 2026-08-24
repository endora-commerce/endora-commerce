import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import { DictionaryTranslation } from '../../../src/modules/dictionaries/entities/dictionary-translation.entity.js';
import { Language } from '../../helpers/package-entities.js';
import { runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';

describe('Dictionary translations — cascade on language delete', () => {
  let db: TestDb;
  let em: EntityManager;

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
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('deleting a Language deletes its dictionary_translations rows', async () => {
    const language = em.create(Language, {
      code: 'aa-AA',
      label: 'Test Language',
      nativeLabel: 'Test Language',
    });
    em.persist(language);
    await em.flush();

    em.persist(
      em.create(DictionaryTranslation, {
        entryType: 'country',
        entryCode: 'PL',
        languageCode: 'aa-AA',
        label: 'Poland in Test Language',
      }),
    );
    await em.flush();

    await em.removeAndFlush(language);

    const rows = await em.execute<Array<{ count: string }>>(
      `select count(*)::text as count
       from "dictionary_translations"
       where "entry_type" = 'country'
         and "entry_code" = 'PL'
         and "language_code" = 'aa-AA'`,
    );
    expect(rows[0]?.count).toBe('0');
  });
});
