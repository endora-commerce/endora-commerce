import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { runDictionarySeedReconciler } from '../../../src/modules/dictionaries/services/seed-reconciler.js';
import type { DictionaryValidator } from '../../../src/modules/dictionaries/services/dictionary-validator.js';
import { dictionaryValidatorFor } from '../../helpers/dictionary-services.js';
import { Currency } from '../../../src/modules/currencies/entities/currency.entity.js';
import { PromotionService } from '../../../src/modules/promotions/services/promotion-service.js';
import { unreachableCatalogPorts } from '../../helpers/promotion-service.js';

describe('Promotions dictionary boundary', () => {
  let db: TestDb;
  let em: EntityManager;
  let validator: DictionaryValidator;
  let service: PromotionService;

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
    // Issue #164 — the catalog ports are required. This suite composes no
    // container and its promotions carry no attribute criteria, so it passes
    // ports that refuse rather than ones that answer emptily: the second is the
    // shape the optional parameters used to produce.
    const catalog = unreachableCatalogPorts('the dictionary boundary suite composes no container');
    service = new PromotionService(
      () => em,
      catalog.attributes,
      catalog.products,
      undefined,
      validator,
    );
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  afterAll(async () => {
    await db.close();
  });

  it('refuses unknown and inactive currencies for amount promotions', async () => {
    await expect(service.upsert(basePromotion('bad', 'ZZZ'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
    await em.nativeUpdate(Currency, { code: 'PLN' }, { isActive: false });
    validator.invalidate();
    await expect(service.upsert(basePromotion('inactive', 'PLN'))).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_INACTIVE',
    });
  });

  it('allows unchanged inactive currency updates but validates currency changes', async () => {
    await service.upsert(basePromotion('promo-pln', 'PLN'));
    await em.nativeUpdate(Currency, { code: 'PLN' }, { isActive: false });
    validator.invalidate();

    await expect(service.upsert({ ...basePromotion('promo-pln', 'PLN'), name: 'Updated' })).resolves.toMatchObject({
      currency: 'PLN',
      name: 'Updated',
    });
    await expect(service.upsert({ ...basePromotion('promo-pln', 'ZZZ'), name: 'Bad' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'DICTIONARY_ENTRY_NOT_FOUND',
    });
  });
});

function basePromotion(code: string, currency: string) {
  return {
    code,
    name: `Promotion ${code}`,
    kind: 'amount_off' as const,
    value: 10,
    currency,
    isActive: true,
  };
}
