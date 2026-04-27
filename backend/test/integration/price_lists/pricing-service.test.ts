import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { PricingService } from '../../../src/modules/price_lists/services/pricing-service.js';
import { PriceList } from '../../../src/modules/price_lists/entities/price-list.entity.js';
import { PriceListItem } from '../../../src/modules/price_lists/entities/price-list-item.entity.js';
import { PriceListAssignment } from '../../../src/modules/price_lists/entities/price-list-assignment.entity.js';
import { CustomerGroup } from '../../../src/modules/price_lists/entities/customer-group.entity.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { SalesChannel } from '../../../src/modules/catalog/entities/sales-channel.entity.js';
import { Category } from '../../../src/modules/catalog/entities/category.entity.js';

/**
 * T130 — PricingService resolution algorithm:
 *   - org-specific list overrides group list overrides default list
 *   - volume tier picks highest matching minQuantity
 *   - per-category percentage_off + amount_off apply on top of base
 *   - "most favourable to the Customer" wins on ties (FR-050)
 *   - falls back to base price when no list matches
 */

describe('PricingService.resolvePrice', () => {
  let h: BackendServerHandle;
  let pricing: PricingService;
  let product: Product;
  let organization: Organization;
  let salesChannel: SalesChannel;
  let category: Category;

  beforeAll(async () => {
    h = await setupBackendServer();
    pricing = new PricingService(h.em);

    product = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    organization = await h.em().findOneOrFail(Organization, { taxId: 'PL0000000099' });
    salesChannel = await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' });
    category = await h.em().findOneOrFail(Category, { slug: 'small-widgets' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    // Wipe pricing tables between tests for clean isolation.
    const conn = h.em().getConnection();
    await conn.execute('truncate table price_list_assignments cascade');
    await conn.execute('truncate table price_list_items cascade');
    await conn.execute('truncate table price_lists cascade');
    await conn.execute('truncate table customer_groups cascade');
    organization.customerGroupId = null;
    await h.em().flush();
  });

  it('returns the base price when no list applies', async () => {
    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(result.source).toBe('base');
    expect(result.unitPrice.amount).toBe(19.99);
    expect(result.unitPrice.currency).toBe('PLN');
  });

  it('uses an org-specific fixed_unit price', async () => {
    const em = h.em();
    const list = em.create(PriceList, {
      code: 'org-deal',
      name: 'Org Deal',
      currency: 'PLN',
    });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      unitPrice: '15.00',
    });
    em.create(PriceListAssignment, {
      priceListId: list.id,
      organizationId: organization.id,
    });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(result.source).toBe('list');
    expect(result.unitPrice.amount).toBe(15);
    expect(result.priceListId).toBe(list.id);
  });

  it('picks the highest matching volume tier', async () => {
    const em = h.em();
    const list = em.create(PriceList, { code: 'tiered', name: 'Tiered', currency: 'PLN' });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      minQuantity: 1,
      unitPrice: '18.00',
    });
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      minQuantity: 10,
      unitPrice: '12.00',
    });
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      minQuantity: 100,
      unitPrice: '8.00',
    });
    em.create(PriceListAssignment, { priceListId: list.id, organizationId: organization.id });
    await em.flush();

    expect(
      (await pricing.resolvePrice({ product, context: { quantity: 1, organization, salesChannel } })).unitPrice
        .amount,
    ).toBe(18);
    expect(
      (await pricing.resolvePrice({ product, context: { quantity: 9, organization, salesChannel } })).unitPrice
        .amount,
    ).toBe(18);
    expect(
      (await pricing.resolvePrice({ product, context: { quantity: 10, organization, salesChannel } })).unitPrice
        .amount,
    ).toBe(12);
    expect(
      (await pricing.resolvePrice({ product, context: { quantity: 250, organization, salesChannel } })).unitPrice
        .amount,
    ).toBe(8);
  });

  it('applies a per-category percentage_off adjustment to the base price', async () => {
    const em = h.em();
    const list = em.create(PriceList, { code: 'cat-pct', name: 'Cat %', currency: 'PLN' });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'percentage_off',
      categoryId: category.id,
      adjustmentValue: '10',
    });
    em.create(PriceListAssignment, { priceListId: list.id, organizationId: organization.id });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    // 19.99 * (1 - 0.10) = 17.991, rounded to 17.99
    expect(result.unitPrice.amount).toBe(17.99);
    expect(result.source).toBe('list');
  });

  it('applies a per-category amount_off adjustment', async () => {
    const em = h.em();
    const list = em.create(PriceList, { code: 'cat-amt', name: 'Cat Amt', currency: 'PLN' });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'amount_off',
      categoryId: category.id,
      adjustmentValue: '5',
    });
    em.create(PriceListAssignment, { priceListId: list.id, organizationId: organization.id });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    // 19.99 - 5 = 14.99
    expect(result.unitPrice.amount).toBe(14.99);
  });

  it('chooses the most favourable price across multiple lists (FR-050)', async () => {
    const em = h.em();
    const orgList = em.create(PriceList, { code: 'org-soft', name: 'Org Soft', currency: 'PLN' });
    const defaultList = em.create(PriceList, { code: 'default', name: 'Default', currency: 'PLN', isDefault: true });
    await em.persistAndFlush([orgList, defaultList]);

    em.create(PriceListItem, {
      priceListId: orgList.id,
      mode: 'fixed_unit',
      productId: product.id,
      unitPrice: '17.00',
    });
    em.create(PriceListItem, {
      priceListId: defaultList.id,
      mode: 'fixed_unit',
      productId: product.id,
      unitPrice: '12.00',
    });
    em.create(PriceListAssignment, { priceListId: orgList.id, organizationId: organization.id });
    em.create(PriceListAssignment, { priceListId: defaultList.id, isDefault: true });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(result.unitPrice.amount).toBe(12);
    expect(result.priceListId).toBe(defaultList.id);
  });

  it('honours customer-group lists', async () => {
    const em = h.em();
    const group = em.create(CustomerGroup, { code: 'wholesale', name: 'Wholesale' });
    await em.persistAndFlush(group);
    organization.customerGroupId = group.id;
    await em.flush();

    const list = em.create(PriceList, { code: 'group-deal', name: 'Group Deal', currency: 'PLN' });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      unitPrice: '13.50',
    });
    em.create(PriceListAssignment, { priceListId: list.id, customerGroupId: group.id });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(result.unitPrice.amount).toBe(13.5);
    expect(result.priceListId).toBe(list.id);
  });

  it('skips assignments scoped to a different sales channel', async () => {
    const em = h.em();
    const otherChannel = await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' });
    const list = em.create(PriceList, { code: 'channel-only', name: 'Channel-only', currency: 'PLN' });
    await em.persistAndFlush(list);
    em.create(PriceListItem, {
      priceListId: list.id,
      mode: 'fixed_unit',
      productId: product.id,
      unitPrice: '5.00',
    });
    em.create(PriceListAssignment, {
      priceListId: list.id,
      organizationId: organization.id,
      salesChannelId: otherChannel.id, // restrict to a channel we're not in
    });
    await em.flush();

    const result = await pricing.resolvePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(result.source).toBe('base');
    expect(result.unitPrice.amount).toBe(19.99);
  });
});
