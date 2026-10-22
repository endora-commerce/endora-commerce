import { describe, expect, it } from 'vitest';
import { ADMIN_PRODUCT_SELECTION_MAX } from './catalog.js';
import type {
  BuyerLinePriceAnswer,
  BuyerLinePriceLine,
  BuyerLinePricePort,
  BuyerLinePriceQuery,
  LinePricePort,
  LinePriceResult,
  OrgLinePricePort,
} from './price-lists.js';

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('ADMIN_PRODUCT_SELECTION_MAX', () => {
  it('is the 200-product cap of one selection', () => {
    expect(ADMIN_PRODUCT_SELECTION_MAX).toBe(200);
  });
});

describe('BuyerLinePricePort', () => {
  it('a structural stub compiles and echoes the caller keys in order', async () => {
    const port: BuyerLinePricePort = {
      resolveForBuyer: async (query: BuyerLinePriceQuery): Promise<BuyerLinePriceAnswer[]> =>
        query.lines.map((l: BuyerLinePriceLine) => ({
          key: l.key,
          price:
            l.variantId === null
              ? null
              : { amount: '12.50', currency: query.currencyCode ?? 'PLN', isSale: false, priceListId: ID(9) },
        })),
    };

    const query: BuyerLinePriceQuery = {
      buyer: { customerAccountId: ID(1), organizationId: ID(2) },
      salesChannelId: null,
      lines: [
        { key: 'a', productId: ID(3), quantity: 10 },
        { key: 'b', productId: ID(4), variantId: null, quantity: 1 },
      ],
    };

    const answers = await port.resolveForBuyer(query);
    expect(answers.map((a) => a.key)).toEqual(['a', 'b']);
    expect(answers[0]!.price).toEqual({ amount: '12.50', currency: 'PLN', isSale: false, priceListId: ID(9) });
    expect(answers[1]!.price).toBeNull();
  });

  it('an anonymous buyer on a named channel with an explicit currency is a valid query', () => {
    const query: BuyerLinePriceQuery = {
      buyer: { customerAccountId: null, organizationId: null },
      salesChannelId: ID(5),
      currencyCode: 'EUR',
      lines: [],
    };
    expect(query.lines).toHaveLength(0);
  });
});

describe('LinePricePort and OrgLinePricePort are unchanged', () => {
  const RESULT: LinePriceResult = {
    amount: '1.00',
    currency: 'PLN',
    priceListId: ID(9),
    isSale: false,
    bracketStartQuantity: 1,
    displayMode: 'net_only',
  };

  it('a LinePricePort stub written before this feature still compiles', async () => {
    const port: LinePricePort = { resolveLinePrice: async () => RESULT };
    expect(
      await port.resolveLinePrice({
        product: { id: ID(3), attributeValues: {} },
        context: { quantity: 1, salesChannel: { id: ID(5), defaultCurrency: 'PLN' } },
      }),
    ).toBe(RESULT);
  });

  it('an OrgLinePricePort stub written before this feature still compiles', async () => {
    const port: OrgLinePricePort = {
      resolveLinePrice: async () => null,
      listTierStarts: async () => [1, 10],
    };
    expect(await port.listTierStarts(ID(3), 'PLN')).toEqual([1, 10]);
  });
});
