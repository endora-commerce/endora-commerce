import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { CustomerGroup } from '../../../src/modules/customer_accounts/entities/customer-group.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { PriceListService } from '../../../../packages/modules/price_lists/src/backend/services/price-list-service.js';
import { PricingService } from '../../../../packages/modules/price_lists/src/backend/services/pricing-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../../packages/modules/price_lists/src/backend/services/default-price-list-migration.js';
import { neighbourReadPorts } from '../../helpers/price-list-neighbour-ports.js';

/**
 * Feature 011 / US6 — Sale → Special Price (T070).
 *
 * Verifies:
 *   - FR-028: resolver returns Base + Sale partitions independently.
 *   - FR-033: when a Sale list matches alongside a Base list, the
 *     resolver yields both prices (storefront UI then renders Base
 *     struck-through and Sale highlighted).
 *   - FR-034: the cart-line resolver helper picks the Sale price when
 *     present.
 *   - FR-035: when no Sale list matches, the resolver returns base-only.
 *   - FR-036: at most one Sale list per tuple — the resolver picks via
 *     the priority algorithm and discards the rest.
 */
describe('Feature 011 / US6 — Sale → Special Price (T070)', () => {
  let h: BackendServerHandle;
  let product: Product;
  let salesChannel: SalesChannel;
  let customerGroup: CustomerGroup;
  let organization: Organization;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  beforeEach(async () => {
    await h
      .em()
      .getConnection()
      .execute(
        `truncate table "price_list_price_brackets", "price_list_products", "price_lists" cascade`,
      );
    await new DefaultPriceListMigrator(h.em).seedDefault();

    const em = h.em();
    product = await em.findOneOrFail(Product, { id: SEED_PRODUCT_101_ID });
    salesChannel = await em.findOneOrFail(SalesChannel, { systemDefault: true });

    const cg = em.create(CustomerGroup, {
      code: `cg-us6-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      name: 'US6 VIP',
    });
    await em.persistAndFlush(cg);
    customerGroup = cg;

    const org = em.create(Organization, {
      name: 'US6 Test Org',
      taxId: `US6-${Date.now() % 10_000_000}-${Math.floor(Math.random() * 1000)}`,
      vatStatus: 'vat_payer',
      status: 'active',
      registeredAddress: { street: 'X', city: 'X', postalCode: 'X', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organization = org;
  });

  async function seedDefaultBracket(amount: string): Promise<void> {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    await svc.addProduct(DEFAULT_PRICE_LIST_ID, product.id);
    await svc.replaceBrackets(DEFAULT_PRICE_LIST_ID, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
    });
  }

  async function seedSaleList(
    name: string,
    rule: Record<string, unknown>,
    amount: string,
  ): Promise<string> {
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const list = await svc.create({ name, type: 'sale', applicationRule: rule as never });
    await svc.addProduct(list.id, product.id);
    await svc.replaceBrackets(list.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount }],
    });
    await svc.activate(list.id);
    return list.id;
  }

  it('FR-033: returns both Base and Sale when a Sale list matches alongside Base', async () => {
    await seedDefaultBracket('100');
    const saleId = await seedSaleList(
      'Spring Promo',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '60',
    );

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });

    expect(out.base.listId).toBe(DEFAULT_PRICE_LIST_ID);
    expect(Number(out.base.bracket!.amount)).toBe(100);
    expect(out.sale?.listId).toBe(saleId);
    expect(Number(out.sale?.bracket.amount)).toBe(60);
  });

  it('FR-034: resolveLinePrice picks the Sale price when present', async () => {
    await seedDefaultBracket('100');
    await seedSaleList(
      'Spring Promo',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '60',
    );

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const line = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(line).not.toBeNull();
    expect(Number(line!.amount)).toBe(60);
    expect(line!.isSale).toBe(true);
  });

  it('FR-034: resolveLinePrice picks the Base price when no Sale matches', async () => {
    await seedDefaultBracket('100');
    // Sale list that does NOT match this customer.
    const otherCg = h.em().create(CustomerGroup, {
      code: `cg-other-${Date.now()}`,
      name: 'Other',
    });
    await h.em().persistAndFlush(otherCg);
    await seedSaleList(
      'Other-CG Promo',
      { kind: 'criterion', type: 'customerGroup', values: [otherCg.id] },
      '50',
    );

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const line = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(line).not.toBeNull();
    expect(Number(line!.amount)).toBe(100);
    expect(line!.isSale).toBe(false);
    expect(line!.priceListId).toBe(DEFAULT_PRICE_LIST_ID);
  });

  it('FR-035: when no Sale list matches the customer, only Base resolves', async () => {
    await seedDefaultBracket('100');
    // No sale list at all.

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.sale).toBeNull();
    expect(Number(out.base.bracket!.amount)).toBe(100);
  });

  it('FR-035: a Sale list in draft state is excluded — base-only resolution', async () => {
    await seedDefaultBracket('100');
    const svc = new PriceListService(
      h.em,
      undefined,
      undefined,
      undefined,
      neighbourReadPorts(h.em),
    );
    const draft = await svc.create({
      name: 'Draft Promo',
      type: 'sale',
      applicationRule: { kind: 'criterion', type: 'organization', values: [organization.id] },
    });
    await svc.addProduct(draft.id, product.id);
    await svc.replaceBrackets(draft.id, product.id, {
      PLN: [{ minQuantity: 1, maxQuantity: null, amount: '40' }],
    });
    // Intentionally do NOT activate.

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.sale).toBeNull();
    expect(Number(out.base.bracket!.amount)).toBe(100);
  });

  it('FR-036: when two Sale lists both match, the resolver picks one via priority + tie-break', async () => {
    await seedDefaultBracket('100');
    organization.customerGroupId = customerGroup.id;
    await h.em().flush();

    // Lower-priority Sale (Customer Group rule).
    await seedSaleList(
      'CG Promo',
      { kind: 'criterion', type: 'customerGroup', values: [customerGroup.id] },
      '70',
    );
    // Higher-priority Sale (Organization rule).
    const orgSaleId = await seedSaleList(
      'Org Promo',
      { kind: 'criterion', type: 'organization', values: [organization.id] },
      '50',
    );

    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const out = await pricing.resolveEngine({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(out.sale?.listId).toBe(orgSaleId);
    expect(Number(out.sale?.bracket.amount)).toBe(50);
  });

  it('returns null line price when no Base bracket exists for the requested currency', async () => {
    // Default has no bracket for this product.
    const pricing = new PricingService(h.em, undefined, undefined, neighbourReadPorts(h.em));
    const line = await pricing.resolveLinePrice({
      product,
      context: { quantity: 1, organization, salesChannel },
    });
    expect(line).toBeNull();
  });

  it('storefront route includes the saleListId + salePrice when Sale matches', async () => {
    await seedDefaultBracket('100');
    await seedSaleList(
      'Spring Promo',
      // Currency criterion — picker doesn't need DB IDs and works for guests.
      { kind: 'criterion', type: 'currency', values: ['PLN'] },
      '75',
    );

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/storefront/products/${product.id}/resolved-price?quantity=1`,
      headers: { 'x-sales-channel': salesChannel.code },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        resolvedPrice: {
          baseListId: string;
          basePrice: { amount: string };
          saleListId: string | null;
          salePrice: { amount: string } | null;
        };
      };
    };
    expect(body.data.resolvedPrice.baseListId).toBe(DEFAULT_PRICE_LIST_ID);
    expect(Number(body.data.resolvedPrice.basePrice.amount)).toBe(100);
    expect(body.data.resolvedPrice.saleListId).toBeTruthy();
    expect(Number(body.data.resolvedPrice.salePrice?.amount)).toBe(75);
  });
});
