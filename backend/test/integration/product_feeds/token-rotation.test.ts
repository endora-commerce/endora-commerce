import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/modules/audit_logs/entities/audit-log-entry.entity.js';
import { ProductFeed } from '../../../src/modules/product_feeds/entities/product-feed.entity.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';

/**
 * Feature 067 / T101 — token rotation and revocation (FR-047, FR-049, FR-059).
 *
 * Rotation is a security control, so the test is about the sharp edges rather
 * than the happy path:
 *
 *  - **the old URL stops working immediately**. No grace window: a rotation an
 *    operator performs because a link leaked has to be effective the moment
 *    they press the button, not at the end of a cache TTL.
 *  - **the new URL serves the same file**. Rotation changes who may fetch, not
 *    what is published, so a provider that is updated with the new link sees no
 *    change in the catalogue.
 *  - **revocation leaves the admin download working** (FR-051 vs FR-049). The
 *    distinction is invisible unless it is stated, and it is the reason an
 *    operator can safely turn a link off.
 *  - **neither Command records the plaintext or the hash**. An audit trail that
 *    stores the secret it was rotating away from defeats the rotation.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';
const PUBLIC = '/api/v1/public/product-feeds';

interface Issued {
  token: string;
  url: string;
  prefix: string;
  rotatedAt: string;
}

describe('feed token rotation [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let firstToken: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_rotation_default' });

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    const templateId = (
      templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
    ).data.find((t) => t.systemCode === 'google_merchant_v1')!.id;
    const channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;

    const created = await h.app.inject({
      method: 'POST',
      url: BASE,
      ...ADMIN,
      payload: {
        name: 'Rotation feed',
        slug: `rotation-${Math.random().toString(36).slice(2, 10)}`,
        feedTemplateId: templateId,
        salesChannelId: channelId,
        languageCode: 'en-US',
        currencyCode: 'PLN',
        pricePresentation: 'net',
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      data: { feed: { id: string }; issuedToken: Issued };
    };
    feedId = body.data.feed.id;
    firstToken = body.data.issuedToken.token;

    // Publish something, so the public route has a file to serve.
    const run = await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    expect(['completed', 'completed_with_warnings']).toContain(run.status);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('invalidates the old URL immediately and serves the same file on the new one', async () => {
    const before = await h.app.inject({ method: 'GET', url: `${PUBLIC}/${firstToken}` });
    expect(before.statusCode).toBe(200);
    const publishedBytes = before.body;

    const rotated = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/rotate`,
      ...ADMIN,
    });
    expect(rotated.statusCode).toBe(200);
    const issued = (rotated.json() as { data: Issued }).data;
    expect(issued.token).not.toBe(firstToken);

    // No grace window — the previous link is gone the moment the call returns.
    const stale = await h.app.inject({ method: 'GET', url: `${PUBLIC}/${firstToken}` });
    expect(stale.statusCode).toBe(404);

    const fresh = await h.app.inject({ method: 'GET', url: `${PUBLIC}/${issued.token}` });
    expect(fresh.statusCode).toBe(200);
    // Rotation changes who may fetch, never what is published.
    expect(fresh.body).toBe(publishedBytes);

    firstToken = issued.token;
  });

  it('is safe while a provider is mid-fetch: the in-flight response is unaffected', async () => {
    // The public route resolves the token, opens the artefact stream and only
    // then writes the body. A rotation racing that must not truncate or corrupt
    // the response already being served — the artefact object is immutable and
    // the stream holds it open, so the fetch completes on the bytes it started.
    const inFlight = h.app.inject({ method: 'GET', url: `${PUBLIC}/${firstToken}` });
    const rotate = h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/rotate`,
      ...ADMIN,
    });
    const [fetched, rotated] = await Promise.all([inFlight, rotate]);
    expect(rotated.statusCode).toBe(200);
    // Either the fetch resolved the old token before it was replaced (200 with
    // a complete file) or it arrived after (a clean 404). What must never
    // happen is a partial or corrupt body.
    expect([200, 404]).toContain(fetched.statusCode);
    if (fetched.statusCode === 200) {
      // Compared in bytes, not characters: a feed carries Polish product names.
      expect(fetched.rawPayload.length).toBe(Number(fetched.headers['content-length']));
    }
    firstToken = (rotated.json() as { data: Issued }).data.token;
  });

  it('leaves no public URL after revocation while the admin download still works', async () => {
    const revoked = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/revoke`,
      ...ADMIN,
    });
    expect(revoked.statusCode).toBe(200);
    const feed = (revoked.json() as { data: { token: { url: string | null; revokedAt: string | null } } })
      .data;
    expect(feed.token.url).toBeNull();
    expect(feed.token.revokedAt).not.toBeNull();

    const publicFetch = await h.app.inject({ method: 'GET', url: `${PUBLIC}/${firstToken}` });
    expect(publicFetch.statusCode).toBe(404);

    // FR-051 — the operator can still get the file; only the anonymous link is
    // gone. This is the sentence that makes "turn the link off" a safe action.
    const download = await h.app.inject({
      method: 'GET',
      url: `${BASE}/${feedId}/artefact`,
      ...ADMIN,
    });
    expect(download.statusCode).toBe(200);
    expect(download.body.length).toBeGreaterThan(0);
  });

  it('re-issues a working link when a revoked feed is rotated again', async () => {
    const rotated = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/rotate`,
      ...ADMIN,
    });
    expect(rotated.statusCode).toBe(200);
    const issued = (rotated.json() as { data: Issued }).data;
    const fetched = await h.app.inject({ method: 'GET', url: `${PUBLIC}/${issued.token}` });
    expect(fetched.statusCode).toBe(200);
    firstToken = issued.token;
  });

  it('never records the plaintext token or its hash in the audit trail (FR-059)', async () => {
    const em = h.em();
    em.clear();
    const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
    const entries = await em.find(AuditLogEntry, {
      objectType: 'product_feed',
      objectId: feedId,
    });
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('product_feeds.token.rotate');
    expect(actions).toContain('product_feeds.token.revoke');

    const serialized = JSON.stringify(
      entries.map((entry) => ({ before: entry.stateBefore, after: entry.stateAfter })),
    );
    expect(serialized).not.toContain(firstToken);
    expect(serialized).not.toContain(String(feed.tokenHash));
    expect(serialized).not.toContain('tokenHash');
  });
});
