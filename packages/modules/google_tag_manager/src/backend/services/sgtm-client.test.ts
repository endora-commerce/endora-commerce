import { describe, expect, it, vi } from 'vitest';
import { SgtmClient } from './sgtm-client.js';

const dest = { baseUrl: 'https://sgtm.example.com', ingestPath: '/data' };

const event = {
  eventId: '6b1f0000-0000-4000-8000-000000000001',
  clientId: '1234567890.1754006400',
  name: 'purchase',
  params: {
    transaction_id: 'ORD-2026-000123',
    value: 1249,
    currency: 'PLN',
    items: '[{"item_id":"SKU-9"}]',
    gtm_event_id: '6b1f0000-0000-4000-8000-000000000001',
  },
  consent: { analyticsStorage: 'granted' as const },
  page: {
    location: 'https://shop.example.com/checkout/thank-you',
    referrer: 'https://shop.example.com/checkout',
    title: 'Thank you',
    language: 'pl',
  },
  ip: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
};

const ok = (): typeof fetch =>
  vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) =>
    new Response(null, { status: 200 }),
  ) as unknown as typeof fetch;

describe('SgtmClient URL composition', () => {
  it('POSTs to base + ingest path', async () => {
    const fetchFn = ok();
    await new SgtmClient({ fetchFn }).send(dest, event);
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toBe('https://sgtm.example.com/data');
    expect((calls[0]![1] as RequestInit).method).toBe('POST');
    expect((calls[0]![1] as RequestInit).headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });

  it('tolerates a trailing slash on the base and a missing leading slash on the path', async () => {
    const fetchFn = ok();
    await new SgtmClient({ fetchFn }).send(
      { baseUrl: 'https://sgtm.example.com/', ingestPath: 'ingest' },
      event,
    );
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]![0])).toBe('https://sgtm.example.com/ingest');
  });

  it('falls back to the Data Client default path when none is configured', async () => {
    const fetchFn = ok();
    await new SgtmClient({ fetchFn }).send(
      { baseUrl: 'https://sgtm.example.com', ingestPath: '  ' },
      event,
    );
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(String(calls[0]![0])).toBe('https://sgtm.example.com/data');
  });
});

describe('SgtmClient body shape', () => {
  async function bodyOf(
    ev: Parameters<SgtmClient['send']>[1],
  ): Promise<Record<string, unknown>> {
    const fetchFn = ok();
    await new SgtmClient({ fetchFn }).send(dest, ev);
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    return JSON.parse((calls[0]![1] as RequestInit).body as string) as Record<string, unknown>;
  }

  it('sends the documented snake_case envelope with the params flattened', async () => {
    const body = await bodyOf(event);
    expect(body).toMatchObject({
      event_name: 'purchase',
      client_id: '1234567890.1754006400',
      event_id: '6b1f0000-0000-4000-8000-000000000001',
      page_location: 'https://shop.example.com/checkout/thank-you',
      page_referrer: 'https://shop.example.com/checkout',
      page_title: 'Thank you',
      language: 'pl',
      consent: { analytics_storage: 'granted' },
      // The event's own params, flattened at the top level.
      transaction_id: 'ORD-2026-000123',
      value: 1249,
      currency: 'PLN',
      items: '[{"item_id":"SKU-9"}]',
      gtm_event_id: '6b1f0000-0000-4000-8000-000000000001',
    });
  });

  it('includes ip_override and user_agent when consent is granted', async () => {
    const body = await bodyOf(event);
    expect(body['ip_override']).toBe('203.0.113.7');
    expect(body['user_agent']).toBe('Mozilla/5.0');
  });

  it('omits ip_override and user_agent when consent is denied (FR-030)', async () => {
    const body = await bodyOf({ ...event, consent: { analyticsStorage: 'denied' } });
    expect(body['consent']).toEqual({ analytics_storage: 'denied' });
    expect('ip_override' in body).toBe(false);
    expect('user_agent' in body).toBe(false);
  });

  it('omits the optional page fields that were never captured', async () => {
    const body = await bodyOf({
      ...event,
      page: { location: 'https://shop.example.com/' },
    });
    expect(body['page_location']).toBe('https://shop.example.com/');
    expect('page_referrer' in body).toBe(false);
    expect('page_title' in body).toBe(false);
    expect('language' in body).toBe(false);
  });

  it('never lets a param overwrite an envelope field', async () => {
    const body = await bodyOf({
      ...event,
      params: { ...event.params, event_name: 'spoofed', client_id: 'spoofed' },
    });
    expect(body['event_name']).toBe('purchase');
    expect(body['client_id']).toBe('1234567890.1754006400');
  });
});

describe('SgtmClient failure handling', () => {
  it('throws on a non-2xx response so BullMQ retries', async () => {
    const fetchFn = vi.fn(
      async () => new Response('nope', { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(new SgtmClient({ fetchFn }).send(dest, event)).rejects.toThrow(/500/);
  });

  it('propagates a transport error so BullMQ retries', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('unreachable');
    }) as unknown as typeof fetch;
    await expect(new SgtmClient({ fetchFn }).send(dest, event)).rejects.toThrow(/unreachable/);
  });

  it('aborts a hanging destination on the configured timeout', async () => {
    const fetchFn = vi.fn(
      (_u: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    await expect(
      new SgtmClient({ fetchFn, timeoutMs: 5 }).send(dest, event),
    ).rejects.toThrow(/abort/i);
  });

  it('defaults the request timeout to 10 seconds', () => {
    expect(new SgtmClient().timeoutMs).toBe(10_000);
  });
});
