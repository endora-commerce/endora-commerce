import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';

import type { DictionaryValidator } from '../../../src/modules/dictionaries/services/dictionary-validator.js';
import { dictionaryValidatorFor, runDictionarySeedReconcilerFor } from '../../helpers/dictionary-services.js';
import { Currency } from '../../../src/modules/currencies/entities/currency.entity.js';
import { PromotionService } from '../../../../packages/modules/promotions/src/backend/services/promotion-service.js';
import {
  unreachableCatalogPorts,
  unreachableOrganizationStatus,
} from '../../helpers/promotion-service.js';
import { AuditLogService } from '../../../src/kernel/audit/audit-log-service.js';
import { SalesChannelMembershipService } from '../../../src/kernel/sales-channels/sales-channel-membership.service.js';
import { EventBus } from '../../../src/events/bus.js';

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
    await runDictionarySeedReconcilerFor(() => db.orm.em);
  });

  beforeEach(async () => {
    em = await db.beginTx();
    validator = dictionaryValidatorFor(() => em);
    // Issue #164 — the catalog ports are required. This suite composes no
    // container and its promotions carry no attribute criteria, so it passes
    // ports that refuse rather than ones that answer emptily: the second is the
    // shape the optional parameters used to produce.
    const catalog = unreachableCatalogPorts('the dictionary boundary suite composes no container');
    // Issue #251 — the remaining four arguments are required too. The two the
    // upsert path actually exercises are the real kernel services over this
    // suite's transactional `em` (the channel bind and the audit row); the
    // org-status resolver refuses, because this suite creates no Organization
    // and never calls `applyToCart`.
    const auditLog = new AuditLogService(() => em);
    service = new PromotionService(
      () => em,
      catalog.attributes,
      catalog.products,
      new SalesChannelMembershipService(() => em, new EventBus(), auditLog),
      validator,
      unreachableOrganizationStatus('the dictionary boundary suite creates no Organization'),
      auditLog,
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
