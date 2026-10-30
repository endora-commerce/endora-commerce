import { describe, expect, it, vi } from 'vitest';

vi.mock('./order-line-order.js', () => ({
  loadArrangedOrderLines: async () => ({ lines: [{ productId: 'prod-1', variantId: null, quantity: 2 }] }),
}));

const { OrderCloneToQuoteService } = await import('./order-clone-to-quote-service.js');

/**
 * Feature 163 (FR-018; code review of the T155 fix round) — a buyer's clone of an
 * order into a quote request is judged where the buyer is: the request's channel
 * and the scope language its tag resolves to, beside the message language, as
 * every buyer seam (`CreateForCustomerOptions`). The operator's clone keeps
 * `minimums: 'warn'` and names no tag — an operator speaks the channel default.
 */

const B2C = '00000000-0000-4000-8000-0000000000d1';
const CTX = { customerAccountId: 'cust-1', organizationId: 'org-1' };

function rig() {
  const createForCustomer = vi.fn(async (_ctx: unknown, _request: unknown, _options: unknown) => ({ id: 'rfq-1' }));
  const service = new OrderCloneToQuoteService(
    () => ({ findOne: async () => ({ id: 'order-1' }) }) as never,
    () => ({ createForCustomer }) as never,
  );
  return { service, createForCustomer };
}

describe('163 — order clone to a quote request', () => {
  it('threads the buyer’s message language, language tag and channel', async () => {
    const { service, createForCustomer } = rig();
    await service.clone('order-1', CTX, { language: 'pl', languageTag: 'de-DE', salesChannelId: B2C });
    expect(createForCustomer.mock.calls[0]?.[2]).toEqual({ language: 'pl', languageTag: 'de-DE', salesChannelId: B2C });
  });

  it('keeps the operator’s clone at minimums warn, with no tag', async () => {
    const { service, createForCustomer } = rig();
    await service.clone('order-1', CTX, { actor: 'operator' });
    expect(createForCustomer.mock.calls[0]?.[2]).toEqual({ minimums: 'warn' });
  });
});
