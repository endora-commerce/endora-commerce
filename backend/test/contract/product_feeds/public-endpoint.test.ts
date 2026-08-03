import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registryCache } from '../../../src/modules/_lifecycle/services/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { issueFeedToken } from '../../../src/modules/product_feeds/services/feed-token.service.js';

/**
 * Feature 067 / T026 — the public feed endpoint's refusal surface
 * (FR-048, FR-049) and its caching behaviour.
 *
 * The binding property is that **no field, status, header or body length may
 * distinguish** the five not-available cases. If they diverge, the endpoint
 * becomes an oracle for "does this feed exist", which is exactly what the
 * unguessable token is supposed to prevent.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const PUBLIC_BASE = '/api/v1/public/product-feeds';

describe('public feed endpoint [contract]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedFeedPrices(h.em());
    await setChannelStorefrontUrl(h, 'pl_retail');
    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createFeed(
    over: Record<string, unknown> = {},
  ): Promise<{ feedId: string; token: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: `Feed ${Math.random().toString(36).slice(2, 8)}`,
        slug: `feed-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
        ...over,
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: { feed: { id: string }; issuedToken: { token: string } };
    };
    return { feedId: body.data.feed.id, token: body.data.issuedToken.token };
  }

  describe('the not-available response is one response (FR-049)', () => {
    it('is byte-identical for every not-available case', async () => {
      // 1. A well-shaped token that matches no feed.
      const unknown = issueFeedToken().token;
      // 2. A token whose feed had it revoked.
      const revoked = await createFeed();
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${revoked.feedId}/token/revoke`,
        ...ADMIN,
      });
      // 3. A token on a disabled feed.
      const disabled = await createFeed();
      await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${disabled.feedId}`,
        ...ADMIN,
        payload: { enabled: false },
      });
      // 4. A token whose feed has been deleted.
      const deleted = await createFeed();
      await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/product-feeds/${deleted.feedId}`,
        ...ADMIN,
      });
      // 5. A live feed that has never completed a run.
      const neverRun = await createFeed();

      const responses = await Promise.all(
        [unknown, revoked.token, disabled.token, deleted.token, neverRun.token].map((token) =>
          h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` }),
        ),
      );

      for (const res of responses) {
        expect(res.statusCode).toBe(404);
        expect(res.headers['content-type']).toContain('application/json');
        expect(res.headers['cache-control']).toBe('private, no-store');
      }
      const bodies = new Set(responses.map((r) => r.body));
      expect(bodies.size, `bodies diverged: ${[...bodies].join(' | ')}`).toBe(1);
      const lengths = new Set(responses.map((r) => r.body.length));
      expect(lengths.size).toBe(1);
    });

    it('answers the same way for a malformed token, without leaking the shape check', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/not-a-token` });
      expect(res.statusCode).toBe(404);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('never echoes the token back in the body', async () => {
      const token = issueFeedToken().token;
      const res = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      expect(res.body).not.toContain(token);
    });

    it('requires no authentication to reach the route at all', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${issueFeedToken().token}` });
      // 404, not 401 — the route is anonymous by design (FR-046).
      expect(res.statusCode).toBe(404);
    });
  });

  it('answers 503 + Retry-After while the module is disabled — an operator state, not a secret', async () => {
    const allIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    registryCache.__setEnabledForTesting(allIds.filter((id) => id !== 'product_feeds'));
    try {
      const res = await h.app.inject({
        method: 'GET',
        url: `${PUBLIC_BASE}/${issueFeedToken().token}`,
      });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('60');
    } finally {
      registryCache.__setEnabledForTesting(allIds);
    }
  });

  describe('serving a published artefact', () => {
    let token: string;
    let feedId: string;

    beforeAll(async () => {
      const created = await createFeed({ name: 'Served feed' });
      token = created.token;
      feedId = created.feedId;
      // Drive the generation service directly: the queue consumer is not wired
      // into the shared test server (research §R18 — no Redis in test-server).
      await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    });

    it('serves the artefact with the documented headers (FR-048)', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/xml; charset=utf-8');
      expect(res.headers['cache-control']).toBe('private, max-age=0, must-revalidate');
      expect(String(res.headers['content-disposition'])).toMatch(
        /^inline; filename="[a-z0-9-]+\.xml"$/,
      );
      expect(res.headers['etag']).toMatch(/^"[0-9a-f]{64}"$/);
      expect(res.headers['last-modified']).toBeTruthy();
      expect(res.body).toContain('<rss');
    });

    it('honours If-None-Match with a 304 and no body (FR-048)', async () => {
      const first = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      const etag = String(first.headers['etag']);
      const res = await h.app.inject({
        method: 'GET',
        url: `${PUBLIC_BASE}/${token}`,
        headers: { 'if-none-match': etag },
      });
      expect(res.statusCode).toBe(304);
      expect(res.body).toBe('');
      expect(res.headers['etag']).toBe(etag);
    });

    it('honours If-Modified-Since with a 304', async () => {
      const first = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      const lastModified = String(first.headers['last-modified']);
      const res = await h.app.inject({
        method: 'GET',
        url: `${PUBLIC_BASE}/${token}`,
        headers: { 'if-modified-since': lastModified },
      });
      expect(res.statusCode).toBe(304);
    });

    it('sets no cookie and does not vary on one', async () => {
      const res = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(String(res.headers['vary'] ?? '')).not.toContain('ookie');
    });

    it('stops serving the moment the token is rotated (FR-047, FR-064)', async () => {
      const rotate = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/token/rotate`,
        ...ADMIN,
      });
      expect(rotate.statusCode).toBe(200);
      const next = (rotate.json() as { data: { token: string } }).data.token;

      const old = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${token}` });
      expect(old.statusCode).toBe(404);

      const fresh = await h.app.inject({ method: 'GET', url: `${PUBLIC_BASE}/${next}` });
      expect(fresh.statusCode).toBe(200);
      token = next;
    });
  });

  it('does not call withSystemScope — the anonymous request already carries an ambient context', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../../../src/modules/product_feeds/routes.public.ts', import.meta.url),
      'utf8',
    );
    // Principle XI: the escape hatch exists for CROSSING tenants. This route
    // never does, and adding one would be noise in the audit stream.
    expect(source).not.toMatch(/withSystemScope\s*\(/);
  });
});
