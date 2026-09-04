import { describe, expect, it } from 'vitest';
import {
  Ga4Forwarder,
  NoopForwarder,
  buildForwarderFromEnv,
} from './ga4-forwarder.js';

/**
 * T237 — GA4 forwarder is opt-in. Without env vars the factory returns a
 * NoopForwarder; ingest never reaches GA4. With env vars, the forwarder
 * batches per client and POSTs to the Measurement Protocol endpoint.
 */

describe('Ga4Forwarder', () => {
  it('factory returns NoopForwarder when env vars are unset', () => {
    const fwd = buildForwarderFromEnv({});
    expect(fwd).toBeInstanceOf(NoopForwarder);
    expect(fwd.enabled).toBe(false);
  });

  it('factory returns Ga4Forwarder when both env vars are set', () => {
    const fwd = buildForwarderFromEnv({
      ANALYTICS_GA4_MEASUREMENT_ID: 'G-XXXX',
      ANALYTICS_GA4_API_SECRET: 'shhh',
    });
    expect(fwd).toBeInstanceOf(Ga4Forwarder);
    expect(fwd.enabled).toBe(true);
  });

  it('Ga4Forwarder POSTs to the Measurement Protocol with grouped client_ids', async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      seen.push({ url: String(input), body: init!.body as string });
      return new Response('', { status: 204 });
    };

    const fwd = new Ga4Forwarder({
      measurementId: 'G-XXXX',
      apiSecret: 'shhh',
      fetchFn: fakeFetch,
    });

    await fwd.forwardMany([
      {
        type: 'product.viewed',
        occurredAt: '2026-04-25T12:00:00.000Z',
        sessionId: 'sess-A',
        properties: { productId: 'p-1' },
      },
      {
        type: 'product.viewed',
        occurredAt: '2026-04-25T12:01:00.000Z',
        sessionId: 'sess-A',
        properties: { productId: 'p-2' },
      },
      {
        type: 'search.performed',
        occurredAt: '2026-04-25T12:02:00.000Z',
        sessionId: 'sess-B',
        properties: { query: 'widgets' },
      },
    ]);

    // One request per session bucket.
    expect(seen).toHaveLength(2);
    for (const req of seen) {
      expect(req.url).toContain('measurement_id=G-XXXX');
      expect(req.url).toContain('api_secret=shhh');
      const parsed = JSON.parse(req.body) as {
        client_id: string;
        events: Array<{ name: string; params: Record<string, unknown> }>;
      };
      expect(['sess-A', 'sess-B']).toContain(parsed.client_id);
      // GA4 normalises event names — dots become underscores.
      expect(parsed.events.every((e) => !e.name.includes('.'))).toBe(true);
    }
  });
});
