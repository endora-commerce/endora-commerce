import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@endora-commerce/platform/events';
import { AuditLogService } from '@endora-commerce/platform/composition';
import { transactionBoundCommandBus } from '../../helpers/sales-channels-service.js';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../../packages/modules/dictionaries/src/backend/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { Language } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { MegamenuService } from '../../../../packages/modules/megamenu/src/backend/services/megamenu-service.js';

describe('Megamenu dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: MegamenuService;
  let salesChannelId: string;

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
    // Every megamenu write is a Command since feature 168 (plan R-7).
    service = new MegamenuService(
      () => em,
      transactionBoundCommandBus(() => em, new AuditLogService(() => em), new EventBus()),
      undefined,
      validator,
    );
    const channel = em.create(SalesChannel, {
      code: `menu-${crypto.randomUUID().slice(0, 8)}`,
      name: { 'en-US': 'Menu Channel' },
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persist(channel).flush();
    salesChannelId = channel.id;
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses unknown and inactive languages on binding create', async () => {
    const menu = await service.create({ name: 'Main menu' });
    await expect(service.addBinding(menu.id, salesChannelId, 'xx-XX')).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });

    await em.nativeUpdate(Language, { code: 'pl-PL' }, { isActive: false });
    validator.invalidate();
    await expect(service.addBinding(menu.id, salesChannelId, 'pl-PL')).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });
});
