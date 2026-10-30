import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ANONYMOUS_PRODUCT_AUDIENCE } from '@endora-commerce/contracts';
import { Product, type ProductRow } from '../../helpers/package-entities.js';
import { ProductLinkService } from '../../../../packages/modules/catalog/dist/backend/services/product-link.service.js';
import { ensureBaseBookSql, seedBasePriceSql } from '../../helpers/price-book-sql.js';

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
    svc = new ProductLinkService(
      () => h.em(),
      undefined,
      h.pricingService,
      h.assetRead,
      h.salesChannels.membershipService,
    );
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
        `truncate table "price_lists" cascade`,
      );
    await ensureBaseBookSql(h.em());
  });

  async function makeProduct(attributeValues: Record<string, unknown>): Promise<ProductRow> {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const em = h.em();
    const product = em.create(Product, {
      sku: `LINK132-${suffix}`,
      slug: `link132-${suffix}`,
      type: 'simple',
      status: 'active',
      name: `Link132 ${suffix}`,
      description: 'fixture',
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
      await seedBasePriceSql(h.em(), target.id, listAmount);
    }
    const rows = await svc.listForStorefront(source.id, {
      resolvedChannel: {
        id: channelId,
        code: channelCode,
        defaultCurrency: 'PLN',
      },
      // The price *source* is what this suite asks about; the viewer is the
      // public one, and which figure each viewer gets is asserted next door in
      // `viewer-priced-listing.test.ts`.
      audience: ANONYMOUS_PRODUCT_AUDIENCE,
    });
    return rows.find((r) => r.product.id === target.id)?.product.price ?? null;
  }

  it('quotes the base book amount, not the catalogue attribute', async () => {
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

  it('renders no price from the attribute on the Product when no book prices it (160 FR-018)', async () => {
    expect(await tilePrice({ defaultPrice: 19.99 }, null)).toBeNull();
  });

  it('renders no price when neither a list nor the Product carries one', async () => {
    expect(await tilePrice({}, null)).toBeNull();
  });
});
