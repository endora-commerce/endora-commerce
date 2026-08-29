import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { Currency, Language } from '../../helpers/package-entities.js';
import { SalesChannelAttributionRegistry } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channel-attribution-registry.js';
import { SalesChannelsService } from '../../../../packages/modules/sales_channels/src/backend/services/sales-channels.service.js';

describe('Sales channels dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: SalesChannelsService;

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
    // An empty attribution registry: this suite is about the dictionary seam
    // and composes neither contributor, so nothing points at any channel here.
    service = new SalesChannelsService(
      () => em,
      new EventBus(),
      validator,
      new SalesChannelAttributionRegistry(),
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses unknown and inactive language/currency codes on create', async () => {
    await expect(
      service.create(channel('bad-lang', { languages: ['xx-XX'], defaultLanguage: 'xx-XX' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
    await expect(
      service.create(channel('bad-curr', { currencies: ['ZZZ'], defaultCurrency: 'ZZZ' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });

    await em.nativeUpdate(Language, { code: 'pl-PL' }, { isActive: false });
    await em.nativeUpdate(Currency, { code: 'EUR' }, { isActive: false });
    validator.invalidate();
    await expect(
      service.create(channel('inactive-lang', { languages: ['pl-PL'], defaultLanguage: 'pl-PL' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_INACTIVE' });
    await expect(
      service.create(channel('inactive-curr', { currencies: ['EUR'], defaultCurrency: 'EUR' })),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_INACTIVE' });
  });

  it('allows unchanged inactive scope updates but validates added codes', async () => {
    const created = await service.create(
      channel('existing-scope', {
        languages: ['en-US', 'pl-PL'],
        defaultLanguage: 'en-US',
        currencies: ['PLN', 'EUR'],
        defaultCurrency: 'PLN',
      }),
    );
    await em.nativeUpdate(Language, { code: 'pl-PL' }, { isActive: false });
    await em.nativeUpdate(Currency, { code: 'EUR' }, { isActive: false });
    validator.invalidate();

    const updated = await service.update(
      created.code,
      { languages: ['en-US', 'pl-PL'], currencies: ['PLN', 'EUR'] },
      created.version,
    );
    expect(updated).toMatchObject({ languages: ['en-US', 'pl-PL'], currencies: ['PLN', 'EUR'] });
    await expect(
      service.update(created.code, { languages: ['en-US', 'xx-XX'] }, updated.version),
    ).rejects.toMatchObject({ statusCode: 409, code: 'DICTIONARY_ENTRY_NOT_FOUND' });
  });
});

function channel(
  code: string,
  overrides: Partial<Parameters<SalesChannelsService['create']>[0]> = {},
): Parameters<SalesChannelsService['create']>[0] {
  return {
    code,
    name: { 'en-US': code },
    languages: ['en-US'],
    defaultLanguage: 'en-US',
    currencies: ['PLN'],
    defaultCurrency: 'PLN',
    active: true,
    ...overrides,
  };
}
