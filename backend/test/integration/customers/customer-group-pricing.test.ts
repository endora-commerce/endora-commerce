import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { CustomerGroup } from '../../../src/modules/price_lists/entities/customer-group.entity.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import { DefaultPriceListMigrator } from '../../../src/modules/price_lists/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 040, US6 / R6 — the customer's DIRECT customer-group overrides the
 * Organization's group in pricing. A customer-group-targeted price list applies
 * when the resolved group is passed via `context.customerGroupId`, and does not
 * apply when it is absent.
 */
describe('Customer-group pricing override (US6)', () => {
  let db: TestDb;
  let em: EntityManager;

  beforeAll(async () => {
    db = await setupTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    em = await db.beginTx();
    await new DefaultPriceListMigrator(() => em).seedDefault();
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('applies a group-targeted price only when the customer group is present', async () => {
    const channel = em.create(SalesChannel, {
      code: `cg-px-${Math.floor(performance.now())}`,
      name: { 'pl-PL': 'T', 'en-US': 'T' },
      isPublic: true,
      defaultLanguage: 'pl-PL',
      defaultCurrency: 'PLN',
      languages: ['pl-PL'],
      currencies: ['PLN'],
    });
    const group = em.create(CustomerGroup, { code: `vip-${Math.floor(performance.now())}`, name: 'VIP' });
    const product = em.create(Product, {
      sku: `cg-prod-${Math.floor(performance.now())}`,
      slug: `cg-prod-${Math.floor(performance.now())}`,
      type: 'simple',
      name: { 'en-US': 'CG Product' },
      description: { 'en-US': '' },
      attributeValues: {},
      visibility: 'public',
    });
    await em.persistAndFlush([channel, group, product]);

    const svc = new PriceListService(() => em, undefined, undefined, undefined, neighbourReadPorts(() => em));
    const list = await svc.create({
      name: 'VIP List',
      type: 'base',
      applicationRule: { kind: 'criterion', type: 'customerGroup', values: [group.id] },
    });
    await svc.addProduct(list.id, product.id);
    await svc.replaceBrackets(list.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '50.0000' }],
    });
    await svc.activate(list.id);

    const pricing = new PricingService(() => em, undefined, undefined, neighbourReadPorts(() => em));

    // With the customer group present → the VIP list applies.
    const withGroup = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, salesChannel: channel, customerGroupId: group.id },
    });
    expect(withGroup?.priceListId).toBe(list.id);
    expect(Number(withGroup?.amount)).toBe(50);

    // Without it → the VIP list does NOT apply (a different list, or null).
    const withoutGroup = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, salesChannel: channel, customerGroupId: null, organization: null },
    });
    expect(withoutGroup?.priceListId).not.toBe(list.id);
  });
});
