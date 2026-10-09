import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listDeliveryMethods, listPaymentMethods } from '../../lib/api/methods';

/**
 * The checkout's two method catalogues are asked for the sales channel the
 * buyer is shopping.
 *
 * A delivery or payment method is offered per sales channel, and the backend
 * lists the methods offered in the channel the request resolves. Both reads are
 * made server-side, to the backend's own host, so `X-Sales-Channel` is the only
 * thing that carries the storefront's channel across — and both used to be made
 * with no context at all. That was invisible while the backend ignored the
 * channel; once it does not, a storefront that still asked without the header
 * would be shown the default channel's methods on every channel.
 *
 * A deployment that stamps no channel passes a context without a code, sends no
 * header and gets the default channel's catalogue: the single-channel path,
 * unchanged, and held by the last case.
 */

const originalFetch = globalThis.fetch;
let sent: Array<{ path: string; headers: Record<string, string> }> = [];

beforeEach(() => {
  sent = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    sent.push({
      path: new URL(String(url)).pathname,
      headers: ((init as { headers?: Record<string, string> }).headers ?? {}) as Record<
        string,
        string
      >,
    });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('method catalogues carry the sales channel', () => {
  it('listDeliveryMethods sends X-Sales-Channel', async () => {
    await listDeliveryMethods({ salesChannelCode: 'b2b-eu', locale: 'en-US' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe('/api/v1/delivery-methods');
    expect(sent[0]!.headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('listPaymentMethods sends X-Sales-Channel', async () => {
    await listPaymentMethods({ salesChannelCode: 'b2b-eu', locale: 'en-US' });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe('/api/v1/payment-methods');
    expect(sent[0]!.headers['X-Sales-Channel']).toBe('b2b-eu');
  });

  it('sends no channel header when the deployment stamps none', async () => {
    await listDeliveryMethods({ locale: 'en-US' });
    await listPaymentMethods({ locale: 'en-US' });

    expect(sent).toHaveLength(2);
    for (const request of sent) {
      expect(request.headers).not.toHaveProperty('X-Sales-Channel');
    }
  });
});
