import { describe, expect, it } from 'vitest';
import type {
  CatalogProductRecord,
  DisplayMode,
  LinePricesPort,
  LinePriceResult,
  OrganizationDetailsPort,
  ProductDisplayModePort,
} from '@endora-commerce/contracts';
import {
  CartLinePricing,
  agreedUnitPriceFor,
  storedPriceDiffers,
  type CartPricingContext,
} from './cart-line-pricing.js';

/**
 * The one answer to "what may this cart line cost at this quantity" — shared by
 * `CartService` (add, merge, quantity change) and by order placement, which
 * compares it with the stored price before copying that price onto the order.
 */

const product = (attributeValues: Record<string, unknown> = {}): CatalogProductRecord =>
  ({ id: 'p-1', attributeValues }) as unknown as CatalogProductRecord;

/** A batched stub answering every line with `price(quantity)`; records each batch. */
function batched(
  price: (quantity: number) => LinePriceResult | null,
  batches: Array<{ quantities: number[]; context: Record<string, unknown> }> = [],
): LinePricesPort {
  return {
    async resolveLinePrices({ lines, context }) {
      batches.push({ quantities: lines.map((l) => l.quantity), context: { ...context } });
      return new Map(lines.map((line) => [line.key, price(line.quantity)]));
    },
  };
}

/** Quantity-tier list: 11.49 below 100 pieces, 1.00 from 100 up. */
function tieredPricing(calls: number[] = []): LinePricesPort {
  return batched((quantity) => {
    calls.push(quantity);
    return {
      amount: quantity >= 100 ? '1.0000' : '11.4900',
      currency: 'PLN',
      priceListId: 'list-1',
      isSale: false,
      bracketStartQuantity: quantity >= 100 ? 100 : 1,
      displayMode: 'gross_only',
    };
  });
}

const noListPrice: LinePricesPort = batched(() => null);

function displayModes(mode: DisplayMode): ProductDisplayModePort {
  return { resolveDisplayMode: async () => mode };
}

/** Every context below is built by hand, so nothing looks an organization up. */
const noOrganizations = {} as OrganizationDetailsPort;

const ctx: CartPricingContext = {
  channel: { id: 'ch-1', defaultCurrency: 'PLN' },
  organization: null,
  organizationId: null,
  signedIn: true,
};

describe('CartLinePricing.orderablePrice', () => {
  it('prices a line at the bracket its current quantity falls in', async () => {
    const pricing = new CartLinePricing(tieredPricing(), displayModes('gross_only'), noOrganizations);
    expect(
      await pricing.orderablePrice(ctx, { product: product(), variantId: null, quantity: 100 }),
    ).toEqual({ ok: true, unitPrice: '1.00', currency: 'PLN', source: 'price_list', priceSource: null });
    expect(
      await pricing.orderablePrice(ctx, { product: product(), variantId: null, quantity: 1 }),
    ).toEqual({ ok: true, unitPrice: '11.49', currency: 'PLN', source: 'price_list', priceSource: null });
  });

  it('keeps an agreed price only while the quantity is the agreed quantity', async () => {
    const calls: number[] = [];
    const pricing = new CartLinePricing(
      tieredPricing(calls),
      displayModes('gross_only'),
      noOrganizations,
    );
    const agreed = { quantity: 10, unitPrice: '5.00', currency: 'PLN' };

    expect(
      await pricing.orderablePrice(ctx, {
        product: product(),
        variantId: null,
        quantity: 10,
        agreed,
      }),
    ).toEqual({ ok: true, unitPrice: '5.00', currency: 'PLN', source: 'agreed', priceSource: 'agreed' });
    expect(calls).toEqual([]);

    expect(
      await pricing.orderablePrice(ctx, {
        product: product(),
        variantId: null,
        quantity: 11,
        agreed,
      }),
    ).toEqual({ ok: true, unitPrice: '11.49', currency: 'PLN', source: 'price_list', priceSource: null });
  });

  it("is unpriced when no price book prices the line — the product's legacy own price is not a price (FR-018)", async () => {
    const pricing = new CartLinePricing(noListPrice, displayModes('gross_only'), noOrganizations);
    expect(
      await pricing.orderablePrice(ctx, {
        product: product({ defaultPrice: 19.99 }),
        variantId: null,
        quantity: 3,
      }),
    ).toEqual({ ok: false, reason: 'unpriced' });
  });

  it('passes the variant and records the tier that priced the line (FR-030, FR-031)', async () => {
    const seen: Array<string | null | undefined> = [];
    const pricing = new CartLinePricing(
      {
        async resolveLinePrices({ lines }) {
          for (const line of lines) seen.push(line.variantId);
          return new Map(
            lines.map((line) => [
              line.key,
              {
                amount: '83.6000',
                currency: 'PLN',
                priceListId: 'book-1',
                isSale: false,
                bracketStartQuantity: 1,
                displayMode: 'gross_only' as const,
                source: 'buyer' as const,
              },
            ]),
          );
        },
      },
      displayModes('gross_only'),
      noOrganizations,
    );
    expect(
      await pricing.orderablePrice(ctx, { product: product(), variantId: 'v-red', quantity: 2 }),
    ).toEqual({ ok: true, unitPrice: '83.60', currency: 'PLN', source: 'price_list', priceSource: 'buyer' });
    expect(seen).toEqual(['v-red']);
  });

  it('answers unpriced when neither a list nor the product carries a price', async () => {
    const pricing = new CartLinePricing(noListPrice, displayModes('gross_only'), noOrganizations);
    expect(
      await pricing.orderablePrice(ctx, { product: product(), variantId: null, quantity: 1 }),
    ).toEqual({ ok: false, reason: 'unpriced' });
  });

  it('answers quote_only for a product sold on request, listed or not', async () => {
    const listed = new CartLinePricing(
      batched(() => ({
        amount: '3.00',
        currency: 'PLN',
        priceListId: 'l',
        isSale: false,
        bracketStartQuantity: 1,
        displayMode: 'none',
      })),
      displayModes('gross_only'),
      noOrganizations,
    );
    expect(
      await listed.orderablePrice(ctx, { product: product(), variantId: null, quantity: 1 }),
    ).toEqual({ ok: false, reason: 'quote_only' });

    const unlisted = new CartLinePricing(noListPrice, displayModes('none'), noOrganizations);
    expect(
      await unlisted.orderablePrice(ctx, {
        product: product({ defaultPrice: 4 }),
        variantId: null,
        quantity: 1,
      }),
    ).toEqual({ ok: false, reason: 'quote_only' });
  });

  it('honours an agreed price for a product sold on request', async () => {
    const pricing = new CartLinePricing(noListPrice, displayModes('none'), noOrganizations);
    expect(
      await pricing.orderablePrice(ctx, {
        product: product(),
        variantId: null,
        quantity: 4,
        agreed: { quantity: 4, unitPrice: '0.00', currency: 'PLN' },
      }),
    ).toEqual({ ok: true, unitPrice: '0.00', currency: 'PLN', source: 'agreed', priceSource: 'agreed' });
  });
});

describe('CartLinePricing — D-287 P0', () => {
  it('answers unpriced on a basket whose channel is gone', async () => {
    const pricing = new CartLinePricing(noListPrice, displayModes('gross_only'), noOrganizations);
    expect(
      await pricing.orderablePrice(
        { ...ctx, channel: null },
        { product: product({ defaultPrice: 19.99 }), variantId: null, quantity: 1 },
      ),
    ).toEqual({ ok: false, reason: 'unpriced' });
  });

  it("prices a basket's lines in one batched call, agreed lines excluded", async () => {
    const batches: Array<{ quantities: number[]; context: Record<string, unknown> }> = [];
    const pricing = new CartLinePricing(
      batched(
        (quantity) => ({
          amount: quantity >= 100 ? '1.0000' : '11.4900',
          currency: 'PLN',
          priceListId: 'list-1',
          isSale: false,
          bracketStartQuantity: 1,
          displayMode: 'gross_only',
        }),
        batches,
      ),
      displayModes('gross_only'),
      noOrganizations,
    );
    const answers = await pricing.orderablePrices(
      { ...ctx, organization: { id: 'org-1', customerGroupId: null } as never, customerAccountId: 'cust-1' },
      [
        { key: 'a', product: product(), variantId: null, quantity: 1 },
        { key: 'b', product: product(), variantId: null, quantity: 100 },
        {
          key: 'c',
          product: product(),
          variantId: null,
          quantity: 7,
          agreed: { quantity: 7, unitPrice: '5.00', currency: 'PLN' },
        },
      ],
    );
    expect(batches).toHaveLength(1);
    expect(batches[0]!.quantities).toEqual([1, 100]);
    // The customer travels to the engine, which applies their own group.
    expect(batches[0]!.context['customerAccountId']).toBe('cust-1');
    expect(answers.get('a')).toMatchObject({ unitPrice: '11.49', source: 'price_list', priceSource: null });
    expect(answers.get('b')).toMatchObject({ unitPrice: '1.00', source: 'price_list', priceSource: null });
    expect(answers.get('c')).toMatchObject({ unitPrice: '5.00', source: 'agreed', priceSource: 'agreed' });
  });
});

describe('agreedUnitPriceFor', () => {
  it('is null for a line that carries no agreement', () => {
    expect(agreedUnitPriceFor(5, null)).toBeNull();
    expect(agreedUnitPriceFor(5, { quantity: null, unitPrice: null, currency: null })).toBeNull();
  });

  it('is the agreed price at the agreed quantity and null at any other', () => {
    const agreed = { quantity: 5, unitPrice: '2.5', currency: 'EUR' };
    expect(agreedUnitPriceFor(5, agreed)).toEqual({ unitPrice: '2.50', currency: 'EUR' });
    expect(agreedUnitPriceFor(6, agreed)).toBeNull();
  });
});



describe('storedPriceDiffers', () => {
  it('compares amounts at two decimals and the currency', () => {
    expect(storedPriceDiffers({ unitPrice: '1.00', currency: 'PLN' }, { unitPrice: '1', currency: 'PLN' })).toBe(false);
    expect(storedPriceDiffers({ unitPrice: '1.00', currency: 'PLN' }, { unitPrice: '11.49', currency: 'PLN' })).toBe(true);
    expect(storedPriceDiffers({ unitPrice: '1.00', currency: 'PLN' }, { unitPrice: '1.00', currency: 'EUR' })).toBe(true);
    expect(storedPriceDiffers({ unitPrice: '1.00', currency: 'PLN' }, null)).toBe(true);
  });
});

describe('CartLinePricing.contextFor — the basket’s own channel', () => {
  /**
   * `specs/154-sales-channel-access/` (contracts/basket-attribution.md §2): the
   * context is the basket's channel, looked up by id. It used to load the
   * system-default channel whatever the basket, which is the shape this
   * refuses: the only lookup is by the id it was given.
   */
  it('loads the channel it is given, by id, and nothing else', async () => {
    const lookups: Array<Record<string, unknown>> = [];
    const em = {
      findOne: async (_entity: unknown, where: Record<string, unknown>) => {
        lookups.push(where);
        return where['id'] === 'ch-b' ? { id: 'ch-b', defaultCurrency: 'EUR' } : null;
      },
    } as unknown as Parameters<CartLinePricing['contextFor']>[0];
    const pricing = new CartLinePricing(noListPrice, displayModes('both'), noOrganizations);

    const context = await pricing.contextFor(em, {
      organizationId: null,
      signedIn: false,
      salesChannelId: 'ch-b',
    });

    expect(context.channel).toEqual({ id: 'ch-b', defaultCurrency: 'EUR' });
    expect(lookups).toEqual([{ id: 'ch-b' }]);
  });

  it('answers no channel for one that is gone, rather than another channel', async () => {
    const em = { findOne: async () => null } as unknown as Parameters<
      CartLinePricing['contextFor']
    >[0];
    const pricing = new CartLinePricing(noListPrice, displayModes('both'), noOrganizations);
    const context = await pricing.contextFor(em, {
      organizationId: null,
      signedIn: true,
      salesChannelId: 'ch-gone',
    });
    expect(context.channel).toBeNull();
  });
});
