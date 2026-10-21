import { describe, expect, it } from 'vitest';
import { ADMIN_PRODUCT_SELECTION_MAX } from './catalog.js';
import {
  bulkAddPriceListProductsRequestSchema,
  bulkAddPriceListProductsResponseSchema,
  bulkAddPriceListProductsResultSchema,
  priceListIdParamsSchema,
} from './price-lists.js';
import type {
  BuyerLinePriceAnswer,
  BuyerLinePriceLine,
  BuyerLinePricePort,
  BuyerLinePriceQuery,
  LinePricePort,
  LinePriceResult,
  OrgLinePricePort,
} from './price-lists.js';

/** A distinct, valid v4-shaped uuid per index. */
function uuid(i: number): string {
  return `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
}

function ids(count: number): string[] {
  return Array.from({ length: count }, (_, i) => uuid(i + 1));
}

describe('ADMIN_PRODUCT_SELECTION_MAX', () => {
  it('is the 200-product cap of one selection', () => {
    expect(ADMIN_PRODUCT_SELECTION_MAX).toBe(200);
  });
});

describe('bulkAddPriceListProductsRequestSchema', () => {
  it('rejects a body without productIds', () => {
    expect(bulkAddPriceListProductsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty selection', () => {
    expect(bulkAddPriceListProductsRequestSchema.safeParse({ productIds: [] }).success).toBe(false);
  });

  it('rejects one id over the cap', () => {
    const body = { productIds: ids(ADMIN_PRODUCT_SELECTION_MAX + 1) };
    expect(bulkAddPriceListProductsRequestSchema.safeParse(body).success).toBe(false);
  });

  it('rejects a member that is not a uuid', () => {
    const body = { productIds: [uuid(1), 'not-a-uuid'] };
    expect(bulkAddPriceListProductsRequestSchema.safeParse(body).success).toBe(false);
  });

  it('accepts a single id', () => {
    const body = { productIds: [uuid(1)] };
    expect(bulkAddPriceListProductsRequestSchema.parse(body)).toEqual(body);
  });

  it('accepts exactly the cap', () => {
    const body = { productIds: ids(ADMIN_PRODUCT_SELECTION_MAX) };
    expect(bulkAddPriceListProductsRequestSchema.parse(body).productIds).toHaveLength(200);
  });
});

const RESULT = {
  added: [uuid(1)],
  unchanged: [uuid(2)],
  failed: [{ productId: uuid(3), reason: 'product_not_found' }],
};

describe('bulkAddPriceListProductsResultSchema', () => {
  it('parses added, unchanged and failed with product_not_found', () => {
    expect(bulkAddPriceListProductsResultSchema.parse(RESULT)).toEqual(RESULT);
  });

  it('rejects a failure reason it does not know', () => {
    const result = { ...RESULT, failed: [{ productId: uuid(3), reason: 'product_archived' }] };
    expect(bulkAddPriceListProductsResultSchema.safeParse(result).success).toBe(false);
  });
});

describe('bulkAddPriceListProductsResponseSchema', () => {
  it('wraps the result in data', () => {
    expect(bulkAddPriceListProductsResponseSchema.parse({ data: RESULT })).toEqual({ data: RESULT });
  });

  it('rejects the bare result', () => {
    expect(bulkAddPriceListProductsResponseSchema.safeParse(RESULT).success).toBe(false);
  });
});

describe('priceListIdParamsSchema', () => {
  it('accepts a uuid id and rejects anything else', () => {
    expect(priceListIdParamsSchema.parse({ id: uuid(1) })).toEqual({ id: uuid(1) });
    expect(priceListIdParamsSchema.safeParse({ id: 'default' }).success).toBe(false);
  });
});


/**
 * Feature 146 — `buyerLinePricePort`, the batch "what does this buyer pay on
 * this channel" question. The assertions are mostly type-level: a structural
 * stub must compile against the new port, and the existing `LinePricePort` /
 * `OrgLinePricePort` stubs must compile unchanged, because the new port is
 * separate rather than a widening of either.
 */

const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
