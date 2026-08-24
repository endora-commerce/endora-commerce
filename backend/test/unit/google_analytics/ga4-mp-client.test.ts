import { describe, expect, it, vi } from 'vitest';
import { Ga4MpClient } from '../../../../packages/modules/google_analytics/src/backend/services/ga4-mp-client.js';

const dest = { endpoint: '', measurementId: 'G-ABC', apiSecret: 'sekret' };
const event = {
  clientId: 'c-1',
  name: 'add_to_cart',
  params: { sku: 'X1', value: 9 },
  consent: { analyticsStorage: 'granted' as const },
};

describe('Ga4MpClient', () => {
  it('POSTs to the GA4 MP default endpoint with measurement_id + api_secret', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 204 }));
    await new Ga4MpClient({ fetchFn: fetchFn as unknown as typeof fetch }).send(dest, event);
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toContain('https://www.google-analytics.com/mp/collect');
    expect(String(url)).toContain('measurement_id=G-ABC');
    expect(String(url)).toContain('api_secret=sekret');
    const body = JSON.parse((init!).body as string);
    expect(body.client_id).toBe('c-1');
    expect(body.events[0].name).toBe('add_to_cart');
  });

  it('uses a server-side GTM endpoint override when provided', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: 200 }));
    await new Ga4MpClient({ fetchFn: fetchFn as unknown as typeof fetch }).send(
      { ...dest, endpoint: 'https://sgtm.example.com/g/collect' },
      event,
    );
    expect(String(fetchFn.mock.calls[0]![0])).toContain('https://sgtm.example.com/g/collect');
  });

  it('throws on a non-2xx response so BullMQ retries (FR-024)', async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response('nope', { status: 500 }));
    await expect(
      new Ga4MpClient({ fetchFn: fetchFn as unknown as typeof fetch }).send(dest, event),
    ).rejects.toThrow(/500/);
  });
});
