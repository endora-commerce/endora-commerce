import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { GTM_CLIENT_ONLY_EVENTS, type GtmCollectRequest } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registerErrorEnvelope } from '../../../src/http/error-envelope.js';
import { registerGoogleTagManagerStorefrontRoutes } from '../../../src/modules/google_tag_manager/routes.storefront.js';
import type { GtmConfigService } from '../../../src/modules/google_tag_manager/services/gtm-config.service.js';
import type { GtmIngestContext } from '../../../src/modules/google_tag_manager/services/ss-relay-queue.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';

const CHANNEL = { 'x-sales-channel': 'default' };

const validBody = (
  events: Array<{ name: string; params?: unknown }> = [
    { name: 'add_to_cart', params: { currency: 'PLN', value: 249 } },
  ],
): Record<string, unknown> => ({
  clientId: '1234567890.1754006400',
  consent: { analyticsStorage: 'granted' },
  page: { location: 'https://shop.example.com/p/widget-9', title: 'Widget 9' },
  events,
});

/** The channel the module reads is decorated by the shared resolver middleware. */
const FAKE_CHANNEL = {
  id: 'chan-1',
  code: 'default',
  name: { en: 'Default' },
  active: true,
  isPublic: true,
  systemDefault: true,
  defaultLanguage: 'en',
  defaultCurrency: 'PLN',
  themeCode: null,
  logoAssetId: null,
  languages: ['en'],
  currencies: ['PLN'],
  version: 1,
};

/**
 * Contract coverage for the Google Tag Manager relay ingest (feature 066, US3).
 *
 * The route is a pure producer: it validates and enqueues, and never talks to
 * the operator's server container inside the shopper's request (FR-029). The
 * closed allow-list is enforced here as well as in the storefront dispatch
 * switch, so a crafted request can never give a client-only event a server path
 * (FR-024 / FR-025 / SC-007).
 *
 * The producer is a recording stub rather than a live BullMQ queue: "nothing
 * was enqueued" is what most of these cases turn on, and a real queue would
 * have to be built — and never closed — once per shared test server.
 */
describe('Google Tag Manager module — relay ingest', () => {
  let app: FastifyInstance;
  let enqueued: Array<{
    salesChannelId: string;
    request: GtmCollectRequest;
    context: GtmIngestContext;
  }>;

  beforeEach(async () => {
    enqueued = [];
    app = Fastify();
    registerErrorEnvelope(app);
    app.addHook('onRequest', async (request) => {
      request.salesChannel = FAKE_CHANNEL;
    });
    await registerGoogleTagManagerStorefrontRoutes(app, {
      configService: {} as unknown as GtmConfigService,
      enqueueRelay: async (salesChannelId, request, context) => {
        enqueued.push({ salesChannelId, request, context });
        return request.events.length;
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  it('accepts a valid batch with 202 and makes no outbound call in the request (FR-029)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: CHANNEL,
      payload: validBody([
        { name: 'add_to_cart', params: { currency: 'PLN', value: 249 } },
        { name: 'view_item', params: { currency: 'PLN', value: 249 } },
      ]),
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ data: { accepted: 2 } });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.salesChannelId).toBe('chan-1');
    expect(enqueued[0]!.request.events.map((e) => e.name)).toEqual(['add_to_cart', 'view_item']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('captures the ip and user agent server-side, never from the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: { ...CHANNEL, 'user-agent': 'Mozilla/5.0 (contract-test)' },
      payload: { ...validBody(), ip: '198.51.100.9', userAgent: 'spoofed' },
    });

    expect(res.statusCode).toBe(202);
    expect(enqueued[0]!.context.userAgent).toBe('Mozilla/5.0 (contract-test)');
    expect(enqueued[0]!.context.ip).not.toBe('198.51.100.9');
    // The body's own attempt at those fields is dropped by the schema.
    expect(Object.keys(enqueued[0]!.request).sort()).toEqual([
      'clientId',
      'consent',
      'events',
      'page',
    ]);
  });

  it.each([...GTM_CLIENT_ONLY_EVENTS])(
    'rejects the client-only event %s with 400 and enqueues nothing (SC-007)',
    async (name) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/storefront/google-tag-manager/collect',
        headers: CHANNEL,
        payload: validBody([{ name, params: {} }]),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
      expect(enqueued).toHaveLength(0);
    },
  );

  it('rejects an event name that is not in the vocabulary at all', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: CHANNEL,
      payload: validBody([{ name: 'exfiltrate', params: {} }]),
    });
    expect(res.statusCode).toBe(400);
    expect(enqueued).toHaveLength(0);
  });

  it('rejects an empty batch, an oversized batch, and a non-scalar param', async () => {
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: CHANNEL,
      payload: validBody([]),
    });
    expect(empty.statusCode).toBe(400);

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: CHANNEL,
      payload: validBody(Array.from({ length: 26 }, () => ({ name: 'add_to_cart', params: {} }))),
    });
    expect(oversized.statusCode).toBe(400);

    const nested = await app.inject({
      method: 'POST',
      url: '/api/v1/storefront/google-tag-manager/collect',
      headers: CHANNEL,
      payload: validBody([{ name: 'add_to_cart', params: { items: [{ item_id: 'SKU-9' }] } }]),
    });
    expect(nested.statusCode).toBe(400);

    expect(enqueued).toHaveLength(0);
  });

  it('answers 503 server_side_unavailable when no relay producer is configured', async () => {
    // A deployment without Redis registers the routes with no enqueuer; the
    // guard runs before the channel is read, so no resolver is needed.
    const bare = Fastify();
    registerErrorEnvelope(bare);
    await registerGoogleTagManagerStorefrontRoutes(bare, {
      configService: {} as unknown as GtmConfigService,
    });
    await bare.ready();
    try {
      const res = await bare.inject({
        method: 'POST',
        url: '/api/v1/storefront/google-tag-manager/collect',
        headers: CHANNEL,
        payload: validBody(),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('server_side_unavailable');
    } finally {
      await bare.close();
    }
  });
});

describe('Google Tag Manager module — relay ingest under the module gate', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers 503 while the module is disabled in the lifecycle registry', async () => {
    // `defineModuleRoutes` gates on an onRequest hook, so this precedes the
    // route's own producer check.
    const allIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    registryCache.__setEnabledForTesting(allIds.filter((id) => id !== 'google_tag_manager'));
    try {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/storefront/google-tag-manager/collect',
        headers: CHANNEL,
        payload: validBody(),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe('MODULE_DISABLED');
      expect(res.headers['retry-after']).toBe('60');
    } finally {
      registryCache.__setEnabledForTesting(allIds);
    }
  });
});
