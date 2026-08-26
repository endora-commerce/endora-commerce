import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';
import { seedFeedPrices, setChannelStorefrontUrl } from '../../helpers/seed-product-feeds.js';
import { ProductFeed } from '../../helpers/package-entities.js';

/**
 * The feed link is re-readable, absolute, and still a secret at rest.
 *
 * A feed URL exists to be pasted into Merchant Center, re-pasted when a
 * provider is reconfigured, and checked when one stops fetching. Showing it
 * once and then masking it left operators with two options, both bad: rotate —
 * which breaks every provider already using the old link — or keep it in a
 * spreadsheet. So the plaintext is now stored encrypted at rest and shown back
 * to the administrator.
 *
 * Four properties hold that together, and each has a test below:
 *  - the URL the admin gets is **absolute** and **actually works**;
 *  - the database never holds the plaintext, only its ciphertext and hash;
 *  - **revoking** drops the recoverable copy, not just the hash;
 *  - the audit trail still records no credential.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const BASE = '/api/v1/admin/product-feeds';

interface TokenView {
  prefix: string | null;
  url: string | null;
  urlIsLive: boolean;
  revokedAt: string | null;
}

describe('feed token reveal [integration]', () => {
  let h: BackendServerHandle;
  let feedId: string;
  let issuedToken: string;

  const readToken = async (): Promise<TokenView> => {
    const res = await h.app.inject({ method: 'GET', url: `${BASE}/${feedId}`, ...ADMIN });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { token: TokenView } }).data.token;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await setChannelStorefrontUrl(h, 'pl_retail');
    const em = h.em();
    await seedFeedPrices(em, { code: 'feed_reveal_default' });

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
        name: 'Reveal feed',
        slug: `reveal-${Math.random().toString(36).slice(2, 10)}`,
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
    issuedToken = body.data.issuedToken.token;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('hands the administrator the real, absolute link — not a masked one', async () => {
    const token = await readToken();

    expect(token.urlIsLive).toBe(true);
    expect(token.url).toBe(`http://feeds.test.local/api/v1/public/product-feeds/${issuedToken}`);
    // The bug that started this: a path is useless to someone pasting it into
    // a provider panel.
    expect(token.url).toMatch(/^https?:\/\//);
    expect(token.url).not.toContain('…');
  });

  it('serves that exact URL, so what is copied is what works', async () => {
    const token = await readToken();
    const path = new URL(token.url!).pathname;

    // Publish something first — an unpublished feed 404s whatever the token is.
    await h.productFeeds.generation.generateNow(feedId, { trigger: 'manual' });
    const res = await h.app.inject({ method: 'GET', url: path });
    expect(res.statusCode).toBe(200);
  });

  it('never stores the plaintext token', async () => {
    const em = h.em();
    em.clear();
    const feed = await em.findOneOrFail(ProductFeed, { id: feedId });

    expect(JSON.stringify(feed.tokenSecret)).not.toContain(issuedToken);
    // The hash is still the only thing the public route compares against.
    expect(feed.tokenHash).toBeTruthy();
    expect(feed.tokenHash).not.toBe(issuedToken);
  });

  it('reveals the new link after a rotation, and stops revealing the old one', async () => {
    const before = await readToken();
    const rotated = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/rotate`,
      ...ADMIN,
    });
    expect(rotated.statusCode).toBe(200);

    const after = await readToken();
    expect(after.urlIsLive).toBe(true);
    expect(after.url).not.toBe(before.url);
    expect(after.url).toContain((rotated.json() as { data: { token: string } }).data.token);
  });

  it('drops the recoverable copy on revoke, not just the hash', async () => {
    const revoked = await h.app.inject({
      method: 'POST',
      url: `${BASE}/${feedId}/token/revoke`,
      ...ADMIN,
    });
    expect(revoked.statusCode).toBe(200);

    const token = await readToken();
    expect(token.url).toBeNull();
    expect(token.urlIsLive).toBe(false);

    // Not merely absent from the response — gone from the row. A revoked feed
    // must not leave a readable credential behind.
    const em = h.em();
    em.clear();
    const feed = await em.findOneOrFail(ProductFeed, { id: feedId });
    expect(feed.tokenSecret ?? null).toBeNull();
    expect(feed.tokenHash ?? null).toBeNull();
  });

  it('still keeps every token field out of the audit trail', async () => {
    const em = h.em();
    em.clear();
    const entries = await em.find(AuditLogEntry, {
      action: { $in: ['product_feeds.token.rotate', 'product_feeds.token.revoke'] },
    });
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const serialized = JSON.stringify([entry.stateBefore, entry.stateAfter]);
      expect(serialized).not.toContain(issuedToken);
      expect(serialized).not.toContain('tokenSecret');
      expect(serialized).not.toContain('tokenHash');
    }
  });
});
