import { describe, expect, it, vi } from 'vitest';
import type { BuyerLinePriceQuery } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import {
  BUYER_LINE_PRICE_CHUNK_SIZE,
  BuyerLinePriceService,
  type BuyerLinePriceServiceDeps,
} from './buyer-line-price-service.js';
import type { PricingResolutionInput } from './pricing-service.interface.js';

/**
 * `BuyerLinePriceService` — the admin price probe's body lifted into one
 * implementation that the probe and `buyerLinePricePort` share
 * (`specs/146-quote-request-pricing-history/research.md` R2, T019).
 */

const CHANNEL_DEFAULT = { id: '00000000-0000-4000-8000-00000000c0de', defaultCurrency: 'PLN' };
const CHANNEL_A = { id: '00000000-0000-4000-8000-00000000c0a1', defaultCurrency: 'EUR' };
const UNKNOWN_CHANNEL_ID = '00000000-0000-4000-8000-00000000dead';

function productId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

interface Harness {
  service: BuyerLinePriceService;
  deps: BuyerLinePriceServiceDeps;
  calls: PricingResolutionInput[];
  /** One entry per `resolveLinePrices` call: how many lines it carried. */
  batches: number[];
  spies: {
    findByIds: ReturnType<typeof vi.fn>;
    findCustomer: ReturnType<typeof vi.fn>;
    findOrganization: ReturnType<typeof vi.fn>;
    findChannel: ReturnType<typeof vi.fn>;
    findDefaultChannel: ReturnType<typeof vi.fn>;
  };
}

function harness(options: {
  knownProducts?: readonly string[];
  customer?: { id: string; organizationId: string; customerGroupId: string | null } | null;
  organization?: { id: string; customerGroupId: string | null } | null;
} = {}): Harness {
  const known = new Set(options.knownProducts ?? [productId(1), productId(2), productId(3)]);
  const calls: PricingResolutionInput[] = [];
  const batches: number[] = [];
  const findByIds = vi.fn(async (ids: readonly string[]) =>
    ids.filter((id) => known.has(id)).map((id) => ({ id, attributeValues: {} })),
  );
  const findCustomer = vi.fn(async () => options.customer ?? null);
  const findOrganization = vi.fn(async () => options.organization ?? null);
  const findChannel = vi.fn(async (id: string) =>
    id === CHANNEL_A.id ? CHANNEL_A : id === CHANNEL_DEFAULT.id ? CHANNEL_DEFAULT : null,
  );
  const findDefaultChannel = vi.fn(async () => CHANNEL_DEFAULT);
  const deps: BuyerLinePriceServiceDeps = {
    pricingService: {
      // A bracket table: 1–9 pieces at 100, 10+ at 90, priced on the channel's
      // currency unless the caller names one. Batched (D-287 P0): each line is
      // recorded as the single resolution it stands for.
      resolveLinePrices: async (input) => {
        batches.push(input.lines.length);
        const out = new Map();
        for (const line of input.lines) {
          const single: PricingResolutionInput = {
            product: line.product,
            variantId: line.variantId ?? null,
            context: { ...input.context, quantity: line.quantity },
          };
          calls.push(single);
          out.set(line.key, {
            amount: line.quantity >= 10 ? '90.0000' : '100.0000',
            currency: input.context.currencyCode ?? input.context.salesChannel.defaultCurrency,
            priceListId: `list-${input.context.salesChannel.id}`,
            isSale: false,
            bracketStartQuantity: line.quantity >= 10 ? 10 : 1,
            displayMode: 'net_only' as const,
          });
        }
        return out;
      },
    },
    // Partial records: the service reads the ids, the attribute values, the
    // organisation and the customer group off them, and nothing else.
    catalogProductRead: { findByIds } as unknown as BuyerLinePriceServiceDeps['catalogProductRead'],
    customerAccountRead: { findById: findCustomer } as unknown as BuyerLinePriceServiceDeps['customerAccountRead'],
    organizationDetails: { findById: findOrganization } as unknown as BuyerLinePriceServiceDeps['organizationDetails'],
    salesChannels: { findById: findChannel, findSystemDefault: findDefaultChannel },
  };
  return {
    service: new BuyerLinePriceService(deps),
    deps,
    calls,
    batches,
    spies: { findByIds, findCustomer, findOrganization, findChannel, findDefaultChannel },
  };
}

function query(overrides: Partial<BuyerLinePriceQuery> = {}): BuyerLinePriceQuery {
  return {
    buyer: { customerAccountId: null, organizationId: null },
    salesChannelId: null,
    lines: [{ key: 'a', productId: productId(1), quantity: 1 }],
    ...overrides,
  };
}

describe('BuyerLinePriceService.resolveForBuyer (T019)', () => {
  it("prices with the account's customer group over the organization's", async () => {
    const h = harness({
      customer: { id: 'cust-1', organizationId: 'org-1', customerGroupId: 'cg-account' },
      organization: { id: 'org-1', customerGroupId: 'cg-org' },
    });
    await h.service.resolveForBuyer(
      query({ buyer: { customerAccountId: 'cust-1', organizationId: null } }),
    );
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.context.customerGroupId).toBe('cg-account');
    // The organization is the account's own when none is named.
    expect(h.spies.findOrganization).toHaveBeenCalledWith('org-1');
    expect(h.calls[0]!.context.organization).toMatchObject({ id: 'org-1' });
  });

  it("falls back to the organization's group when the account has none", async () => {
    const h = harness({
      customer: { id: 'cust-1', organizationId: 'org-1', customerGroupId: null },
      organization: { id: 'org-1', customerGroupId: 'cg-org' },
    });
    await h.service.resolveForBuyer(
      query({ buyer: { customerAccountId: 'cust-1', organizationId: 'org-1' } }),
    );
    expect(h.calls[0]!.context.customerGroupId).toBe('cg-org');
  });

  it('refuses an account that is not a member of the named organization, before any price', async () => {
    // Security review W2: the organization named in the query used to win over
    // the account's own, so a mismatched pair priced the account's group
    // against a foreign organization's lists. Same refusal as the probe's.
    const h = harness({
      customer: { id: 'cust-1', organizationId: 'org-1', customerGroupId: 'cg-account' },
      organization: { id: 'org-2', customerGroupId: 'cg-org' },
    });
    const refusal = h.service
      .resolveForBuyer(query({ buyer: { customerAccountId: 'cust-1', organizationId: 'org-2' } }))
      .catch((error: unknown) => error);
    const error = await refusal;
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'The customer account is not a member of the organization.',
    });
    expect(h.calls).toHaveLength(0);
    expect(h.spies.findOrganization).not.toHaveBeenCalled();
    expect(h.spies.findByIds).not.toHaveBeenCalled();
  });

  it('prices an account named without its organization, and one whose lookup finds nothing, as before', async () => {
    const h = harness({ customer: null, organization: { id: 'org-2', customerGroupId: 'cg-org' } });
    const answers = await h.service.resolveForBuyer(
      query({ buyer: { customerAccountId: 'cust-gone', organizationId: 'org-2' } }),
    );
    expect(answers[0]!.price).not.toBeNull();
    expect(h.calls[0]!.context.customerGroupId).toBe('cg-org');
  });

  it('resolves on the named channel, and on the system default when the channel is null', async () => {
    const h = harness();
    const onA = await h.service.resolveForBuyer(query({ salesChannelId: CHANNEL_A.id }));
    expect(h.calls[0]!.context.salesChannel).toEqual(CHANNEL_A);
    expect(onA[0]!.price).toMatchObject({ currency: 'EUR', priceListId: `list-${CHANNEL_A.id}` });

    const onDefault = await h.service.resolveForBuyer(query({ salesChannelId: null }));
    expect(h.calls[1]!.context.salesChannel).toEqual(CHANNEL_DEFAULT);
    expect(onDefault[0]!.price).toMatchObject({ currency: 'PLN' });
    expect(h.spies.findDefaultChannel).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit currency over the channel default', async () => {
    const h = harness();
    const [answer] = await h.service.resolveForBuyer(
      query({ salesChannelId: CHANNEL_A.id, currencyCode: 'pln' }),
    );
    expect(answer!.price?.currency).toBe('PLN');
  });

  it('refuses an unknown channel with 400 VALIDATION_FAILED, without echoing the id', async () => {
    const h = harness();
    const error = await h.service
      .resolveForBuyer(query({ salesChannelId: UNKNOWN_CHANNEL_ID }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(400);
    expect((error as HttpError).code).toBe('VALIDATION_FAILED');
    expect((error as HttpError).message).not.toContain(UNKNOWN_CHANNEL_ID);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a malformed channel id with exactly the same error, before any lookup', async () => {
    const h = harness();
    const unknown = (await h.service
      .resolveForBuyer(query({ salesChannelId: UNKNOWN_CHANNEL_ID }))
      .catch((e: unknown) => e)) as HttpError;
    h.spies.findChannel.mockClear();
    const malformed = (await h.service
      .resolveForBuyer(query({ salesChannelId: 'not-a-uuid' }))
      .catch((e: unknown) => e)) as HttpError;
    expect(malformed).toBeInstanceOf(HttpError);
    expect({ status: malformed.statusCode, code: malformed.code, message: malformed.message }).toEqual(
      { status: unknown.statusCode, code: unknown.code, message: unknown.message },
    );
    expect(malformed.message).not.toContain('not-a-uuid');
    // A malformed id must never reach Postgres (a `uuid` cast error is a 500).
    expect(h.spies.findChannel).not.toHaveBeenCalled();
  });

  it('answers price: null for a product that does not exist, and prices the rest', async () => {
    const h = harness({ knownProducts: [productId(1)] });
    const answers = await h.service.resolveForBuyer(
      query({
        lines: [
          { key: 'known', productId: productId(1), quantity: 1 },
          { key: 'ghost', productId: productId(99), quantity: 1 },
        ],
      }),
    );
    expect(answers).toEqual([
      {
        key: 'known',
        price: { amount: '100.0000', currency: 'PLN', isSale: false, priceListId: `list-${CHANNEL_DEFAULT.id}` },
      },
      { key: 'ghost', price: null },
    ]);
  });

  it("honours the line's quantity bracket and passes the variant through", async () => {
    const h = harness();
    const answers = await h.service.resolveForBuyer(
      query({
        lines: [
          { key: 'one', productId: productId(1), quantity: 1 },
          { key: 'ten', productId: productId(1), variantId: 'variant-1', quantity: 10 },
        ],
      }),
    );
    expect(answers.map((a) => a.price?.amount)).toEqual(['100.0000', '90.0000']);
    expect(h.calls[1]!.context.quantity).toBe(10);
    expect(h.calls[1]!.variantId).toBe('variant-1');
    expect(h.calls[0]!.variantId).toBeNull();
  });

  it('echoes the keys in the order the lines were sent', async () => {
    const h = harness();
    const answers = await h.service.resolveForBuyer(
      query({
        lines: [
          { key: 'z', productId: productId(3), quantity: 1 },
          { key: 'a', productId: productId(1), quantity: 1 },
          { key: 'm', productId: productId(2), quantity: 1 },
          { key: 'dup', productId: productId(1), quantity: 1 },
        ],
      }),
    );
    expect(answers.map((a) => a.key)).toEqual(['z', 'a', 'm', 'dup']);
  });

  it('answers an empty query with no reads at all', async () => {
    const h = harness();
    expect(await h.service.resolveForBuyer(query({ lines: [] }))).toEqual([]);
    expect(h.spies.findByIds).not.toHaveBeenCalled();
  });

  it('resolves a 250-line query in bounded chunks, one load of each kind per chunk (T11)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => productId(1000 + i));
    const h = harness({
      knownProducts: ids,
      customer: { id: 'cust-1', organizationId: 'org-1', customerGroupId: null },
      organization: { id: 'org-1', customerGroupId: 'cg-org' },
    });
    const answers = await h.service.resolveForBuyer(
      query({
        buyer: { customerAccountId: 'cust-1', organizationId: 'org-1' },
        salesChannelId: CHANNEL_A.id,
        lines: ids.map((id, i) => ({ key: `k${i}`, productId: id, quantity: 1 })),
      }),
    );
    expect(answers).toHaveLength(250);
    expect(answers.map((a) => a.key)).toEqual(ids.map((_, i) => `k${i}`));
    expect(answers.every((a) => a.price !== null)).toBe(true);

    const chunks = Math.ceil(250 / BUYER_LINE_PRICE_CHUNK_SIZE);
    expect(chunks).toBeGreaterThan(1);
    expect(h.spies.findByIds).toHaveBeenCalledTimes(chunks);
    for (const [chunkIds] of h.spies.findByIds.mock.calls as Array<[readonly string[]]>) {
      expect(chunkIds.length).toBeLessThanOrEqual(BUYER_LINE_PRICE_CHUNK_SIZE);
    }
    for (const spy of [h.spies.findCustomer, h.spies.findOrganization, h.spies.findChannel]) {
      expect(spy.mock.calls.length).toBeGreaterThanOrEqual(1);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(chunks);
    }
    // D-287 P0 — one batched pricing call per chunk, not one per line.
    expect(h.batches).toHaveLength(chunks);
    expect(h.batches.reduce((a, b) => a + b, 0)).toBe(250);
  });
});
