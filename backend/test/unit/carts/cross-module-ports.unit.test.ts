import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogProductReadPort,
  CustomerAccountReadPort,
  LinePricePort,
  PromotionCodePort,
  QuoteRequestReadPort,
  RfqCustomerPort,
} from '@endora-commerce/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { ANONYMOUS_PRODUCT_AUDIENCE, ERROR_CODES } from '@endora-commerce/contracts';
import { Cart } from '../../../../packages/modules/carts/src/backend/entities/cart.entity.js';
import { CartItem } from '../../../../packages/modules/carts/src/backend/entities/cart-item.entity.js';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { CartConversionService } from '../../../../packages/modules/carts/src/backend/services/cart-conversion-service.js';
import { CartUpsellService } from '../../../../packages/modules/carts/src/backend/services/cart-upsell-service.js';
import { CartOrganizationVisibilityService } from '../../../../packages/modules/carts/src/backend/services/cart-organization-visibility-service.js';

/**
 * Feature 075, Phase C — `carts` asks its five neighbours instead of querying
 * their tables.
 *
 * The `EntityManager` below **throws on any entity `carts` does not own**, so a
 * read that goes around a port reads as "`carts` queried someone else's table"
 * rather than as a silent pass. Every case here fails on the pre-cut code for
 * that reason, which is what makes the fixture worth having: the ports are the
 * only way the data can arrive.
 */

const CARTS_OWN_ENTITIES = new Set<unknown>([Cart, CartItem]);

function ownTablesOnly(rows: {
  carts?: Cart[];
  items?: CartItem[];
}): () => EntityManager {
  const refuse = (entity: unknown): never => {
    throw new Error(
      `carts queried an entity it does not own: ${String(
        (entity as { name?: string }).name ?? entity,
      )}`,
    );
  };
  const em = {
    find: async (entity: unknown) => {
      if (!CARTS_OWN_ENTITIES.has(entity)) refuse(entity);
      return entity === Cart ? (rows.carts ?? []) : (rows.items ?? []);
    },
    findOne: async (entity: unknown) => {
      if (!CARTS_OWN_ENTITIES.has(entity)) refuse(entity);
      return entity === Cart ? (rows.carts?.[0] ?? null) : (rows.items?.[0] ?? null);
    },
    findAndCount: async (entity: unknown) => {
      if (!CARTS_OWN_ENTITIES.has(entity)) refuse(entity);
      const found = entity === Cart ? (rows.carts ?? []) : (rows.items ?? []);
      return [found, found.length];
    },
    getKnex: () => refuse('knex'),
    getConnection: () => refuse('connection'),
    execute: async () => refuse('raw sql'),
    nativeDelete: async () => 0,
    flush: async () => {},
  } as unknown as EntityManager;
  return () => em;
}

function cartRow(overrides: Partial<Cart> = {}): Cart {
  return {
    id: 'cart-1',
    customerAccountId: 'cust-1',
    organizationId: 'org-1',
    status: 'active',
    approvalStatus: 'not_required',
    lastActivityAt: new Date(),
    ...overrides,
  } as unknown as Cart;
}

function itemRow(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    cartId: 'cart-1',
    productId: 'p-1',
    variantId: null,
    quantity: 2,
    unitPrice: '10.00',
    currency: 'PLN',
    ...overrides,
  } as unknown as CartItem;
}

describe('carts — the up-sell strip reads catalog through its port', () => {
  it('walks the links and the target rows without touching catalog tables', async () => {
    const listLinksBySourceIds = vi.fn(async () => [
      { id: 'l-1', sourceProductId: 'p-1', targetProductId: 'p-2', kind: 'up_sell', position: 0 },
      { id: 'l-2', sourceProductId: 'p-1', targetProductId: 'p-1', kind: 'up_sell', position: 1 },
    ]);
    const catalog = {
      listLinksBySourceIds,
      findByIds: async () => [
        {
          id: 'p-2',
          slug: 'target',
          name: 'Target product',
          attributeValues: { primaryAssetUrl: 'https://cdn.example/p2.png' },
          createdAt: new Date('2026-01-01'),
        },
      ],
    } as unknown as CatalogProductReadPort;

    const service = new CartUpsellService(ownTablesOnly({ items: [itemRow()] }), catalog);
    // Issue #227 — the fixture rows carry no `visibility`, which reads as
    // `public` here, so the audience narrows nothing and this test still says
    // what it said: the link narrowing is the port's.
    const candidates = await service.forCart('cart-1', 5, ANONYMOUS_PRODUCT_AUDIENCE);

    // The link narrowed by kind at the port, not filtered afterwards.
    expect(listLinksBySourceIds).toHaveBeenCalledWith(['p-1'], 'up_sell');
    // `p-1` is already in the cart, so its self-link is dropped.
    expect(candidates).toEqual([
      {
        productId: 'p-2',
        productName: 'Target product',
        productSlug: 'target',
        productThumbnailUrl: 'https://cdn.example/p2.png',
        matchCount: 1,
      },
    ]);
  });
});

describe('carts — the org-admin cart list names its owners through customer_accounts', () => {
  it('renders the owner e-mail from the port', async () => {
    const accounts = {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, email: `${id}@example.test` })),
    } as unknown as CustomerAccountReadPort;

    const service = new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow()], items: [itemRow()] }),
      accounts,
    );
    const page = await service.list('org-1');

    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.ownerDisplayName).toBe('cust-1@example.test');
    expect(page.data[0]?.ownerEmail).toBe('cust-1@example.test');
  });

  // Issue #751 — the owner is named as the members page names a member, the
  // e-mail travelling beside the name.
  it('names the owner by full name, the e-mail beside it', async () => {
    const accounts = {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, email: `${id}@example.test`, firstName: 'Jan', lastName: 'Kowalski' })),
    } as unknown as CustomerAccountReadPort;

    const service = new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow()], items: [itemRow()] }),
      accounts,
    );
    const page = await service.list('org-1');

    expect(page.data[0]).toMatchObject({
      ownerDisplayName: 'Jan Kowalski',
      ownerEmail: 'cust-1@example.test',
    });
  });

  // Issue #751 (owner ruling on PR #760) — a completed cart names the order it produced.
  it('answers the order a completed cart produced, and null for an open one', async () => {
    const accounts = {
      findByIds: async (ids: readonly string[]) => ids.map((id) => ({ id, email: `${id}@example.test` })),
    } as unknown as CustomerAccountReadPort;
    const orderId = '00000000-0000-4000-8000-000000000751';

    const completed = await new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow({ status: 'completed', completedOrderId: orderId })], items: [] }),
      accounts,
    ).list('org-1');
    const open = await new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow()], items: [itemRow()] }),
      accounts,
    ).list('org-1');

    expect(completed.data[0]?.orderId).toBe(orderId);
    expect(open.data[0]?.orderId).toBeNull();
  });

  it('falls back to the e-mail for an owner with a blank name, and to the id for one that is gone', async () => {
    const blank = {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ id, email: `${id}@example.test`, firstName: ' ', lastName: '' })),
    } as unknown as CustomerAccountReadPort;
    const gone = { findByIds: async () => [] } as unknown as CustomerAccountReadPort;

    const named = await new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow()], items: [itemRow()] }),
      blank,
    ).list('org-1');
    const missing = await new CartOrganizationVisibilityService(
      ownTablesOnly({ carts: [cartRow()], items: [itemRow()] }),
      gone,
    ).list('org-1');

    expect(named.data[0]).toMatchObject({ ownerDisplayName: 'cust-1@example.test', ownerEmail: 'cust-1@example.test' });
    expect(missing.data[0]).toMatchObject({ ownerDisplayName: 'cust-1', ownerEmail: null });
  });
});

describe('carts — quote-to-cart conversion reads quote_requests through its port', () => {
  const quoteRequests = {
    findById: async () =>
      ({ id: 'qr-1', customerAccountId: 'cust-1' }) as never,
    listItems: async () => [
      {
        id: 'qri-1',
        quoteRequestId: 'qr-1',
        productId: 'p-1',
        productName: 'Quoted product',
        variantId: null,
        quantity: 3,
        packagingUnitName: null,
        packagingUnitBaseQuantity: null,
      },
    ],
  } as unknown as QuoteRequestReadPort;

  const rfq = {} as unknown as RfqCustomerPort;
  const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1', salesChannelId: 'channel-1' };

  /**
   * Issue #259 — the conversion narrows to the request's channel, and these
   * cases run outside a request. So the gate has nothing to ask, and a port
   * that throws on every method proves it asks nothing rather than assuming it.
   */
  const refusingChannelMembership = new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`carts asked the channel bridge (${String(property)}) with no request`);
      },
    },
  ) as SalesChannelMembershipPort;

  it('drops a line whose product catalog no longer has, by name', async () => {
    const catalog = { findByIds: async () => [] } as unknown as CatalogProductReadPort;
    const cartService = {
      getOrCreateForCustomer: async () => cartRow(),
    } as never;

    const service = new CartConversionService(
      ownTablesOnly({}),
      cartService,
      rfq,
      quoteRequests,
      catalog,
      refusingChannelMembership,
    );
    const result = await service.createCartFromQuoteRequest('qr-1', ctx);

    expect(result.droppedLines).toEqual([
      { productId: 'p-1', productName: 'Quoted product', reason: 'not_purchasable' },
    ]);
    expect(result.appendedLineCount).toBe(0);
  });

  /**
   * The `catch` around `addItem` reports one unpriceable line and keeps going,
   * which is right. `ModuleDisabledError` **is** an `HttpError`, so without the
   * `rethrowIfModuleDisabled` first line the same `instanceof` test would report
   * a switched-off pricing engine as "no price in your list" for every line —
   * issue #124's defect wearing a per-line report.
   */
  it('re-throws a disabled provider instead of reporting it as an unpriced line', async () => {
    const catalog = {
      findByIds: async () => [{ id: 'p-1' }],
    } as unknown as CatalogProductReadPort;
    const cartService = {
      addItems: async () => {
        throw new ModuleDisabledError('price_lists');
      },
      getOrCreateForCustomer: async () => cartRow(),
    } as never;

    const service = new CartConversionService(
      ownTablesOnly({}),
      cartService,
      rfq,
      quoteRequests,
      catalog,
      refusingChannelMembership,
    );

    await expect(service.createCartFromQuoteRequest('qr-1', ctx)).rejects.toMatchObject({
      statusCode: 503,
      code: ERROR_CODES.MODULE_DISABLED,
    });
  });

  it('still reports an ordinary per-line refusal as a dropped line', async () => {
    const catalog = {
      findByIds: async () => [{ id: 'p-1' }],
    } as unknown as CatalogProductReadPort;
    // Feature 155 (R12.5) — the batch reports the refusal as a `failed` outcome.
    const cartService = {
      addItems: async () => ({
        cart: cartRow(),
        items: [],
        outcomes: [
          {
            index: 0,
            status: 'failed',
            error: {
              status: 400,
              code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY,
              message: 'This product is sold on request only and cannot be added to the cart.',
            },
          },
        ],
      }),
      getOrCreateForCustomer: async () => cartRow(),
    } as never;

    const service = new CartConversionService(
      ownTablesOnly({}),
      cartService,
      rfq,
      quoteRequests,
      catalog,
      refusingChannelMembership,
    );
    const result = await service.createCartFromQuoteRequest('qr-1', ctx);

    expect(result.droppedLines).toEqual([
      { productId: 'p-1', productName: 'Quoted product', reason: 'no_price_in_customer_list' },
    ]);
  });
});

describe('carts — quote-to-cart conversion maps the batch outcomes (feature 155, R12.5)', () => {
  const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1', salesChannelId: 'channel-1' };
  const qrLine = (id: string, productId: string, quantity: number) => ({
    id,
    quoteRequestId: 'qr-1',
    productId,
    productName: `Quoted ${productId}`,
    variantId: null,
    quantity,
    packagingUnitName: null,
    packagingUnitBaseQuantity: null,
  });
  const quoteRequests = {
    findById: async () => ({ id: 'qr-1', customerAccountId: 'cust-1' }) as never,
    listItems: async () => [
      qrLine('qri-1', 'p-added', 10),
      qrLine('qri-2', 'p-short', 5),
      qrLine('qri-3', 'p-hidden', 5),
      qrLine('qri-4', 'p-quote-only', 1),
    ],
  } as unknown as QuoteRequestReadPort;
  const catalog = {
    findByIds: async (ids: readonly string[]) => ids.map((id) => ({ id })),
  } as unknown as CatalogProductReadPort;

  it('reports below_minimum with the minimum, a 404 as not_purchasable, any other failure as no price — in one batch', async () => {
    const addItems = vi.fn(async () => ({
      cart: cartRow(),
      items: [],
      outcomes: [
        { index: 0, status: 'added' },
        {
          index: 1,
          status: 'below_minimum',
          productId: 'p-short',
          productName: 'Catalogue name',
          kind: 'pieces',
          minimum: 10,
        },
        { index: 2, status: 'failed', error: { status: 404, code: ERROR_CODES.PRODUCT_NOT_FOUND, message: 'x' } },
        {
          index: 3,
          status: 'failed',
          error: { status: 400, code: ERROR_CODES.CART_PRODUCT_QUOTE_ONLY, message: 'x' },
        },
      ],
    }));
    const service = new CartConversionService(
      ownTablesOnly({}),
      { addItems, getOrCreateForCustomer: async () => cartRow() } as never,
      {} as unknown as RfqCustomerPort,
      quoteRequests,
      catalog,
      {} as SalesChannelMembershipPort,
    );

    const result = await service.createCartFromQuoteRequest('qr-1', ctx, { language: 'pl' });

    expect(addItems).toHaveBeenCalledTimes(1);
    expect(addItems).toHaveBeenCalledWith(
      { customer: ctx },
      [
        { productId: 'p-added', quantity: 10 },
        { productId: 'p-short', quantity: 5 },
        { productId: 'p-hidden', quantity: 5 },
        { productId: 'p-quote-only', quantity: 1 },
      ],
      { onLineError: 'report', language: 'pl' },
    );
    expect(result.appendedLineCount).toBe(1);
    // The name is the buyer's own quote line's, never the catalogue's (R12.5).
    expect(result.droppedLines).toEqual([
      { productId: 'p-short', productName: 'Quoted p-short', reason: 'below_minimum', minimum: 10 },
      { productId: 'p-hidden', productName: 'Quoted p-hidden', reason: 'not_purchasable' },
      { productId: 'p-quote-only', productName: 'Quoted p-quote-only', reason: 'no_price_in_customer_list' },
    ]);
  });
});

describe('carts — cart-to-quote conversion hands quote_requests the cart price as the reference', () => {
  /**
   * Feature 146 (FR-008, research R3) — the cart's unit price is not a buyer's
   * proposal. It travels as the line's reference through the port's in-process
   * third argument, index-aligned with the items, and no line carries a
   * `desiredUnitPrice`.
   */
  it('sends no desiredUnitPrice and passes lineReferencePrices from the cart snapshot', async () => {
    const createForCustomer = vi.fn(async () => ({ id: 'qr-new' }) as never);
    const rfq = { createForCustomer, listForCustomer: vi.fn() } as unknown as RfqCustomerPort;
    const items = [
      itemRow({ id: 'item-1', productId: 'p-1', quantity: 2, unitPrice: '120.00', currency: 'PLN' }),
      itemRow({
        id: 'item-2',
        productId: 'p-2',
        variantId: 'v-2',
        quantity: 200,
        unitPrice: '4.25',
        currency: 'EUR',
        packagingUnitId: 'u-paleta',
        packagingUnitName: 'Paleta',
        packagingUnitBaseQuantity: 100,
      } as Partial<CartItem>),
    ];
    const catalog = {
      listPackagingUnitsByProductIds: async () => [
        { id: 'u-paleta', productId: 'p-2', name: 'Paleta', baseQuantity: 100, minOrderUnits: null },
      ],
    } as unknown as CatalogProductReadPort;
    const service = new CartConversionService(
      ownTablesOnly({ carts: [cartRow()], items }),
      {} as never,
      rfq,
      {} as unknown as QuoteRequestReadPort,
      catalog,
      {} as SalesChannelMembershipPort,
    );
    const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1' };

    const result = await service.convertToQuoteRequest(cartRow(), ctx, 'Please quote');

    expect(result.quoteRequestId).toBe('qr-new');
    expect(createForCustomer).toHaveBeenCalledTimes(1);
    expect(createForCustomer).toHaveBeenCalledWith(
      ctx,
      {
        headerNote: 'Please quote',
        items: [
          { productId: 'p-1', quantity: 2 },
          // Feature 155 (FR-026) — the unit's id; its name and base are the catalogue's.
          { productId: 'p-2', variantId: 'v-2', quantity: 200, packagingUnitId: 'u-paleta' },
        ],
      },
      {
        lineReferencePrices: [
          { amount: '120.00', currency: 'PLN' },
          { amount: '4.25', currency: 'EUR' },
        ],
      },
    );
  });
});

describe('carts — cart-to-quote conversion sends the packaging unit by id (feature 155, FR-026, US4 #11)', () => {
  it('sends packagingUnitId for a live unit, plain pieces for a deleted one, after one unit read over the cart', async () => {
    const createForCustomer = vi.fn(async () => ({ id: 'qr-new' }) as never);
    const rfq = { createForCustomer } as unknown as RfqCustomerPort;
    const items = [
      itemRow({ id: 'item-1', productId: 'p-1', quantity: 3 }),
      itemRow({
        id: 'item-2',
        productId: 'p-2',
        quantity: 128,
        packagingUnitId: 'u-live',
        packagingUnitName: 'Pallet',
        packagingUnitBaseQuantity: 64,
      } as Partial<CartItem>),
      itemRow({
        id: 'item-3',
        productId: 'p-3',
        quantity: 96,
        packagingUnitId: 'u-gone',
        packagingUnitName: 'Crate',
        packagingUnitBaseQuantity: 48,
      } as Partial<CartItem>),
    ];
    const listPackagingUnitsByProductIds = vi.fn(async () => [
      { id: 'u-live', productId: 'p-2', name: 'Pallet', baseQuantity: 64, minOrderUnits: null },
    ]);
    const catalog = { listPackagingUnitsByProductIds } as unknown as CatalogProductReadPort;
    const service = new CartConversionService(
      ownTablesOnly({ carts: [cartRow()], items }),
      {} as never,
      rfq,
      {} as unknown as QuoteRequestReadPort,
      catalog,
      {} as SalesChannelMembershipPort,
    );
    const ctx = { customerAccountId: 'cust-1', organizationId: 'org-1' };

    await service.convertToQuoteRequest(cartRow(), ctx);

    expect(listPackagingUnitsByProductIds).toHaveBeenCalledTimes(1);
    const [ids] = listPackagingUnitsByProductIds.mock.calls[0] as unknown as [string[]];
    // Only the buyer's own cart lines' products (F12).
    expect(ids.every((id) => ['p-1', 'p-2', 'p-3'].includes(id))).toBe(true);
    expect(ids).toEqual(expect.arrayContaining(['p-2', 'p-3']));
    expect(createForCustomer).toHaveBeenCalledWith(
      ctx,
      {
        items: [
          { productId: 'p-1', quantity: 3 },
          // A live unit: its id, and no name or base quantity.
          { productId: 'p-2', quantity: 128, packagingUnitId: 'u-live' },
          // A deleted unit: plain pieces, the quantity unchanged.
          { productId: 'p-3', quantity: 96 },
        ],
      },
      expect.anything(),
    );
  });
});

describe('carts — the published price and coupon slices are the ones the module needs', () => {
  it('LinePricePort answers the six fields a cart line snapshots', async () => {
    const port: LinePricePort = {
      resolveLinePrice: async () => ({
        amount: '19.99',
        currency: 'PLN',
        priceListId: 'pl-1',
        isSale: false,
        bracketStartQuantity: 1,
        displayMode: 'gross_only',
      }),
    };
    const resolved = await port.resolveLinePrice({
      product: { id: 'p-1', attributeValues: {} },
      context: { quantity: 1, salesChannel: { id: 'ch-1', defaultCurrency: 'PLN' } },
    });
    expect(resolved?.amount).toBe('19.99');
  });

  /**
   * The four eligibility fields joined `ResolvedPromotionCode` in this cut.
   * Without them the coupon service can only answer `invalid_code`, where the
   * storefront renders `expired`, `wrong_organization` and `below_min_spend`.
   */
  it('ResolvedPromotionCode carries the reason a code is refused', async () => {
    const port: PromotionCodePort = {
      resolveByCode: async () => ({
        promotionId: 'promo-1',
        couponId: null,
        name: 'Spring',
        isActive: true,
        validFrom: null,
        validUntil: new Date('2020-01-01'),
        organizationId: 'org-2',
        minCartSubtotal: '500.00',
      }),
    };
    const resolved = await port.resolveByCode('SPRING');
    expect(resolved?.validUntil).toEqual(new Date('2020-01-01'));
    expect(resolved?.organizationId).toBe('org-2');
    expect(resolved?.minCartSubtotal).toBe('500.00');
  });
});
