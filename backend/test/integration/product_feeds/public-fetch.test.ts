import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T028 — the public feed URL against a REAL listening server
 * (FR-046, FR-051).
 *
 * `inject()` bypasses `node:_http_server`, which is exactly where a missing
 * `return reply.send(...)` turns into `ERR_HTTP_HEADERS_SENT` in production
 * (research §R18, a hazard this repository has already been bitten by). This
 * route streams its body, so at least one test has to go over a real socket.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };

describe('public feed fetch over a real socket [integration]', () => {
  let h: BackendServerHandle;
  let origin: string;
  let feedId: string;
  let token: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedFeedPrices(h.em());
    await setChannelStorefrontUrl(h, 'pl_retail');

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    const channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: {
        name: 'Socket feed',
        slug: 'socket-feed',
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      data: { feed: { id: string }; issuedToken: { token: string } };
    };
    feedId = body.data.feed.id;
    token = body.data.issuedToken.token;

    await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });

    await h.app.listen({ port: 0, host: '127.0.0.1' });
    const address = h.app.server.address() as { port: number };
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    // Node's global `fetch` (undici) keeps its sockets alive, so a listening
    // server never reaches "no more connections" and `app.close()` waits for
    // the idle timeout. Dropping them explicitly is what keeps this file from
    // costing 30 s of hook timeout on every run.
    h.app.server.closeAllConnections();
    await teardownBackendServer(h);
  });

  it('serves the artefact anonymously — no cookie, no session, no API key', async () => {
    const res = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('private, max-age=0, must-revalidate');
    const text = await res.text();
    expect(text).toContain('<rss');
    expect(text).toContain('</rss>');
  });

  it('returns the stream cleanly — the process does not crash with ERR_HTTP_HEADERS_SENT', async () => {
    // A handler that calls `reply.send()` without returning it double-sends
    // once an async onSend hook runs; over a real socket that is an uncaught
    // exception. Ten sequential fetches all completing is the signal.
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
      expect(res.status).toBe(200);
      await res.text();
    }
  });

  it('serves bytes identical to the admin download (FR-051)', async () => {
    const publicRes = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
    const publicBytes = Buffer.from(await publicRes.arrayBuffer());

    const adminRes = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.rawPayload.equals(publicBytes)).toBe(true);
  });

  it('reports the exact byte size it stored', async () => {
    const res = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
  });

  it('stops serving as soon as the feed is disabled (FR-021)', async () => {
    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/product-feeds/${feedId}`,
      ...ADMIN,
      payload: { enabled: false },
    });
    const res = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
    expect(res.status).toBe(404);
    await res.text();

    await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/product-feeds/${feedId}`,
      ...ADMIN,
      payload: { enabled: true },
    });
    const back = await fetch(`${origin}/api/v1/public/product-feeds/${token}`);
    expect(back.status).toBe(200);
    await back.text();
  });
});
