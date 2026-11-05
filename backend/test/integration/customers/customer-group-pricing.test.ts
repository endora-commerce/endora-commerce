import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { setupTestDb, type TestDb } from '../../helpers/test-db.js';
import { Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { CustomerGroup, Organization } from '../../helpers/package-entities.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';
import { priceListChannelBridge } from '../../helpers/orders-neighbour-ports.js';
import { seedPriceBookSql } from '../../helpers/price-book-sql.js';

/**
 * Feature 040, US6 / R6 — the customer's DIRECT customer-group overrides the
 * Organization's group in pricing. A customer-group price book applies when the
 * resolved group is passed via `context.customerGroupId`, and does not apply
 * when it is absent (feature 160: on price books; the buyer belongs to an
 * organization with no group of its own, as every customer belongs to one).
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
  });

  afterEach(async () => {
    await db.rollbackTx();
  });

  it('applies a group-targeted price only when the customer group is present', async () => {
    const channel = em.create(SalesChannel, {
      code: `cg-px-${Math.floor(performance.now())}`,
      name: { 'pl-PL': 'T', 'en-US': 'T' },
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
      name: 'CG Product',
      description: '',
      attributeValues: {},
      visibility: 'public',
    });
    await em.persistAndFlush([channel, group, product]);

    const organization = em.create(Organization, {
      name: 'CG pricing org',
      taxId: `CGPX${Math.floor(performance.now())}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'T 1', city: 'W', postalCode: '00-001', country: 'PL' },
    });
    await em.persistAndFlush(organization);
    const list = await seedPriceBookSql(em, {
      name: 'VIP book',
      audience: { groups: [group.id] },
      channelIds: [channel.id],
      rows: [{ productId: product.id, fixed: '50.0000' }],
    });
    const listId = list;

    const pricing = new PricingService(() => em, undefined, neighbourReadPorts(() => em), undefined, {
      channelBridge: priceListChannelBridge(),
    });
    const buyer = { id: organization.id, customerGroupId: null };

    // With the customer group present → the VIP book applies.
    const withGroup = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, salesChannel: channel, organization: buyer, customerGroupId: group.id },
    });
    expect(withGroup?.priceListId).toBe(listId);
    expect(Number(withGroup?.amount)).toBe(50);

    // Without it → the VIP book does NOT apply (unpriced: the product has no base price).
    const withoutGroup = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, salesChannel: channel, customerGroupId: null, organization: buyer },
    });
    expect(withoutGroup?.priceListId).not.toBe(listId);
  });
});
