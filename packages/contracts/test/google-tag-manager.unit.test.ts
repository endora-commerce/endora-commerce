import { describe, expect, it } from 'vitest';
import {
  GTM_CLIENT_ONLY_EVENTS,
  GTM_RELAY_ELIGIBLE_EVENTS,
  gtmCollectRequestSchema,
  gtmContainerIdSchema,
} from '../src/google-tag-manager.js';

/**
 * Feature 066 — the contract surface shared by the storefront emitter, the
 * backend ingest validator and the docs. The two event lists being disjoint is
 * the structural guarantee behind FR-025: a client-only event can never acquire
 * a server-side path.
 */

function collectBody(events: Array<{ name: string; params?: unknown }>): unknown {
  return {
    clientId: '1234567890.1754006400',
    consent: { analyticsStorage: 'granted' },
    page: { location: 'https://shop.example.com/p/widget-9' },
    events,
  };
}

describe('gtmContainerIdSchema', () => {
  it('accepts a well-formed container id', () => {
    expect(gtmContainerIdSchema.safeParse('GTM-ABC1234').success).toBe(true);
  });

  it.each([
    ['lowercase tail', 'GTM-abc1234'],
    ['a GA4 measurement id', 'G-ABC1234'],
    ['an empty tail', 'GTM-'],
    ['an empty string', ''],
    ['a 12-character tail', 'GTM-ABCDEFGHIJKL'],
  ])('rejects %s', (_label, value) => {
    expect(gtmContainerIdSchema.safeParse(value).success).toBe(false);
  });
});

describe('the event vocabulary', () => {
  it('ships a non-empty relay-eligible list and a non-empty client-only list', () => {
    expect(GTM_RELAY_ELIGIBLE_EVENTS.length).toBeGreaterThan(0);
    expect(GTM_CLIENT_ONLY_EVENTS.length).toBeGreaterThan(0);
  });

  it('keeps the two lists disjoint (FR-025)', () => {
    const relay = new Set<string>(GTM_RELAY_ELIGIBLE_EVENTS);
    const overlap = GTM_CLIENT_ONLY_EVENTS.filter((name) => relay.has(name));
    expect(overlap).toEqual([]);
  });
});

describe('gtmCollectRequestSchema', () => {
  it('accepts a relay-eligible event', () => {
    const parsed = gtmCollectRequestSchema.safeParse(
      collectBody([{ name: 'add_to_cart', params: { currency: 'PLN', value: 249 } }]),
    );
    expect(parsed.success).toBe(true);
  });

  it.each(['scroll', 'form_start', 'file_download', 'gtm.load'])(
    'rejects the client-only event %s (FR-024)',
    (name) => {
      expect(gtmCollectRequestSchema.safeParse(collectBody([{ name }])).success).toBe(false);
    },
  );

  it('rejects an empty event batch', () => {
    expect(gtmCollectRequestSchema.safeParse(collectBody([])).success).toBe(false);
  });

  it('rejects a batch of 26 events', () => {
    const events = Array.from({ length: 26 }, () => ({ name: 'add_to_cart', params: {} }));
    expect(gtmCollectRequestSchema.safeParse(collectBody(events)).success).toBe(false);
  });

  it('rejects a non-scalar param value (FR-021)', () => {
    const nested = gtmCollectRequestSchema.safeParse(
      collectBody([{ name: 'add_to_cart', params: { items: [{ item_id: 'SKU-9' }] } }]),
    );
    expect(nested.success).toBe(false);
  });
});
