import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';
import { ProductLinkService } from '../../../src/modules/catalog/services/product-link.service.js';
import { PriceListService } from '../../../src/modules/price_lists/services/price-list-service.js';
import {
  DefaultPriceListMigrator,
  DEFAULT_PRICE_LIST_ID,
} from '../../../src/modules/price_lists/services/default-price-list-migration.js';

/**
 * Issue #132 — a related / up-sell / cross-sell tile prices through
 * `price_lists`.
 *
 * The tile sits on the product page, next to a price the PDP resolved through
 * the engine, and used to quote the catalogue attribute instead — two prices
 * for two products on one page, arrived at two different ways. It also quoted
 * a literal `'PLN'` regardless of the channel's currency; that is fixed here
 * too, because the amount and its currency come out of the same answer.
 */

describe('product link tile price source (#132)', () => {
  let h: BackendServerHandle;
  let svc: ProductLinkService;
  let channelId: string;
  let channelCode: string;
  let counter = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    svc = new ProductLinkService(() => h.em(), undefined, h.pricingService);
    const def = await h.salesChannels.resolver.getSystemDefault();
    channelId = def.id;
    channelCode = def.code;
  }, 60_000);

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
  });

  async function makeProduct(attributeValues: Record<string, unknown>): Promise<Product> {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const em = h.em();
    const product = em.create(Product, {
      sku: `LINK132-${suffix}`,
      slug: `link132-${suffix}`,
      type: 'simple',
      status: 'active',
      name: { en: `Link132 ${suffix}` },
      description: { en: 'fixture' },
      visibility: 'public',
      attributeValues,
      allowedOrganizationIds: [],
    });
    await em.persistAndFlush(product);
    await h.salesChannels.membershipService.addToChannel(channelId, 'product', product.id);
    return product;
  }

  async function tilePrice(
    targetAttributes: Record<string, unknown>,
    listAmount: string | null,
  ): Promise<{ amount: number; currency: string } | null> {
    const source = await makeProduct({});
    const target = await makeProduct(targetAttributes);
    await svc.bulkCreate(source.id, [
      { targetProductId: target.id, kind: 'cross_sell' },
    ]);
    if (listAmount !== null) {
      const lists = new PriceListService(h.em);
      await lists.addProduct(DEFAULT_PRICE_LIST_ID, target.id);
      await lists.replaceBrackets(DEFAULT_PRICE_LIST_ID, target.id, {
        PLN: [{ minQuantity: 1, maxQuantity: null, amount: listAmount }],
      });
    }
    const rows = await svc.listForStorefront(source.id, {
      resolvedChannel: {
        id: channelId,
        code: channelCode,
        isPublic: true,
        defaultCurrency: 'PLN',
      },
    });
    return rows.find((r) => r.product.id === target.id)?.product.price ?? null;
  }

  it('quotes the price list amount, not the catalogue attribute', async () => {
    expect(await tilePrice({ defaultPrice: 19.99 }, '88.00')).toEqual({
      amount: 88,
      currency: 'PLN',
    });
  });

  it('renders a resolved zero as zero rather than as an absence', async () => {
    expect(await tilePrice({ defaultPrice: 19.99 }, '0.00')).toEqual({
      amount: 0,
      currency: 'PLN',
    });
  });

  it("falls back to the Product's own price when no list prices it", async () => {
    expect(await tilePrice({ defaultPrice: 19.99 }, null)).toEqual({
      amount: 19.99,
      currency: 'PLN',
    });
  });

  it('renders no price when neither a list nor the Product carries one', async () => {
    expect(await tilePrice({}, null)).toBeNull();
  });
});
