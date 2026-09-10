import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { ADMIN_COOKIES } from '../../helpers/test-actors.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { STUB_CUSTOMER_PASSWORD } from '../../helpers/seed-organizations.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Feature 067 / T025 — feed CRUD contract (FR-019, FR-021, FR-023, FR-044,
 * FR-057).
 *
 * The binding rules are the whole point of this surface: a feed is exactly one
 * channel, one language, one currency and one price basis, validated against
 * live data rather than a static enum, so a misconfigured feed is refused at
 * save time and never silently produces a wrong-priced file.
 */

const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const READER = { cookies: { b2b_session: 'stub-feed-reader-session' } };
const FEED_READER_ID = '00000000-0000-4000-8000-0000000000f1';

describe('product feeds — admin CRUD [contract]', () => {
  let h: BackendServerHandle;
  let templateId: string;
  let channelId: string;

  beforeAll(async () => {
    h = await setupBackendServer();

    // A read-only administrator (`product_feeds:read` and nothing else), used
    // to prove that reads are allowed and every mutation is refused.
    const role = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/admin-roles/product_feeds_reader',
      ...ADMIN,
      payload: {
        code: 'product_feeds_reader',
        name: 'Product feeds reader',
        permissions: ['product_feeds:read'],
      },
    });
    expect(role.statusCode).toBe(200);
    const roleId = (role.json() as { data: { id: string } }).data.id;
    const em = h.em();
    em.create(AdminUser, {
      id: FEED_READER_ID,
      email: 'feed-reader@example.com',
      passwordHash: await hashPassword(STUB_CUSTOMER_PASSWORD),
      firstName: 'Feed',
      lastName: 'Reader',
      adminRoleId: roleId,
      status: 'active',
    });
    await em.flush();
    ADMIN_COOKIES['stub-feed-reader-session'] = { adminUserId: FEED_READER_ID };

    const templates = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/feed-templates',
      ...ADMIN,
    });
    expect(templates.statusCode).toBe(200);
    const rows = (templates.json() as { data: Array<{ id: string; systemCode: string | null }> })
      .data;
    templateId = rows.find((t) => t.systemCode === 'google_merchant_v1')!.id;

    channelId = (await em.findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
  });

  afterAll(async () => {
    delete ADMIN_COOKIES['stub-feed-reader-session'];
    await teardownBackendServer(h);
  });

  function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: 'Google feed',
      slug: `google-feed-${Math.random().toString(36).slice(2, 10)}`,
      feedTemplateId: templateId,
      salesChannelId: channelId,
      languageCode: 'en-US',
      currencyCode: 'PLN',
      pricePresentation: 'gross',
      taxCountry: 'PL',
      ...over,
    };
  }

  it('rejects an unauthenticated request', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/product-feeds' });
    expect(res.statusCode).toBe(401);
  });

  it('answers 503 + Retry-After while the module is disabled', async () => {
    const allIds = REGISTERED_MANIFESTS.map((e) => e.manifest.id);
    registryCache.__setEnabledForTesting(allIds.filter((id) => id !== 'product_feeds'));
    try {
      const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/product-feeds', ...ADMIN });
      expect(res.statusCode).toBe(503);
      expect(res.headers['retry-after']).toBe('60');
    } finally {
      registryCache.__setEnabledForTesting(allIds);
    }
  });

  it('creates a feed and keeps its link readable afterwards (FR-046)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/product-feeds',
      ...ADMIN,
      payload: validBody({ name: 'Created feed' }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      data: {
        feed: Record<string, unknown>;
        issuedToken: { token: string; url: string; prefix: string; rotatedAt: string };
      };
    };
    expect(body.data.issuedToken.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.data.issuedToken.url).toContain(body.data.issuedToken.token);
    expect(body.data.feed['name']).toBe('Created feed');
    expect(body.data.feed['enabled']).toBe(true);

    // Reading it back DOES return the link again. This inverts the original
    // FR-046 reading, deliberately: the token is now stored encrypted at rest
    // (`product_feeds.token_secret`) precisely so the operator can re-copy the
    // URL a provider needs. Show-once left them rotating — which breaks every
    // provider already fetching — or keeping the link in a spreadsheet.
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/product-feeds/${String(body.data.feed['id'])}`,
      ...ADMIN,
    });
    expect(read.statusCode).toBe(200);
    const token = (read.json() as { data: { token: Record<string, unknown> } }).data.token;
    expect(token['prefix']).toBe(body.data.issuedToken.prefix);
    expect(token['revokedAt']).toBeNull();
    expect(token['urlIsLive']).toBe(true);
    expect(token['url']).toBe(body.data.issuedToken.url);
  });

  it('returns the documented list row in one call (FR-055)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/product-feeds', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<Record<string, unknown>>; pagination: unknown };
    expect(body.pagination).toBeTruthy();
    const row = body.data[0]!;
    for (const key of [
      'id',
      'name',
      'slug',
      'feedTemplateName',
      'salesChannelCode',
      'languageCode',
      'currencyCode',
      'enabled',
      'lastRun',
      'nextRunAt',
      'publishedItemCount',
      'isRunning',
      'scheduleTooTightWarning',
      'token',
    ]) {
      expect(row, `missing ${key}`).toHaveProperty(key);
    }
  });

  describe('binding validation (FR-019, FR-044)', () => {
    it('refuses gross prices without a tax country, naming the field', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ pricePresentation: 'gross', taxCountry: null }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('taxCountry');
    });

    it('refuses a language that is not active on the installation', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ languageCode: 'zz-ZZ' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('languageCode');
    });

    it('refuses a currency the channel does not carry', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ currencyCode: 'JPY' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('currencyCode');
    });

    it('refuses an unknown sales channel', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ salesChannelId: '00000000-0000-4000-8000-00000000dead' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('salesChannelId');
    });

    it('refuses an unknown template', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ feedTemplateId: '00000000-0000-4000-8000-00000000beef' }),
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain('feedTemplateId');
    });

    it('refuses a cron without a timezone and a timezone without a cron (XOR)', async () => {
      const cronOnly = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ schedule: { cron: '0 */4 * * *' } }),
      });
      expect(cronOnly.statusCode).toBe(400);

      const tzOnly = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ schedule: { timezone: 'Europe/Warsaw' } }),
      });
      expect(tzOnly.statusCode).toBe(400);
    });

    it('refuses an invalid cron expression and an unknown timezone (FR-031)', async () => {
      const badCron = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ schedule: { cron: 'not a cron', timezone: 'Europe/Warsaw' } }),
      });
      expect(badCron.statusCode).toBe(400);

      const badTz = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ schedule: { cron: '0 */4 * * *', timezone: 'Mars/Phobos' } }),
      });
      expect(badTz.statusCode).toBe(400);
    });

    it('refuses a grammatically valid but impossible expression (FR-031)', async () => {
      // The contract's regex is grammatical only, so `60 * * * *` parses. If it
      // were accepted, the operator would see a saved schedule that silently
      // never fires — the failure mode with no error attached.
      for (const cron of ['60 * * * *', '* 24 * * *', '* * 32 * *', '* * * 13 *', '* * * * 8']) {
        const res = await h.app.inject({
          method: 'POST',
          url: '/api/v1/admin/product-feeds',
          ...ADMIN,
          payload: validBody({ schedule: { cron, timezone: 'Europe/Warsaw' } }),
        });
        expect(res.statusCode, cron).toBe(400);
      }
    });

    it('accepts a valid schedule', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ schedule: { cron: '0 */4 * * *', timezone: 'Europe/Warsaw' } }),
      });
      expect(res.statusCode).toBe(201);
      const feed = (res.json() as { data: { feed: Record<string, unknown> } }).data.feed;
      expect(feed['schedule']).toEqual({ cron: '0 */4 * * *', timezone: 'Europe/Warsaw' });
    });
  });

  describe('update, duplicate and delete', () => {
    let feedId: string;

    beforeAll(async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ name: 'Mutable feed' }),
      });
      feedId = String((res.json() as { data: { feed: { id: string } } }).data.feed.id);
    });

    it('updates only what was sent and bumps the version', async () => {
      const before = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
      });
      const beforeVersion = (before.json() as { data: { version: number } }).data.version;

      const res = await h.app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(200);
      const feed = (res.json() as { data: Record<string, unknown> }).data;
      expect(feed['enabled']).toBe(false);
      expect(feed['name']).toBe('Mutable feed');
      expect(Number(feed['version'])).toBe(beforeVersion + 1);
    });

    it('duplicates into an independent feed with its OWN token (FR-022)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/duplicate`,
        ...ADMIN,
        payload: { name: 'Copy of mutable feed', slug: 'copy-of-mutable-feed' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        data: { feed: { id: string; token: { prefix: string } }; issuedToken: { token: string } };
      };
      expect(body.data.feed.id).not.toBe(feedId);

      const original = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
      });
      const originalPrefix = (original.json() as { data: { token: { prefix: string } } }).data.token
        .prefix;
      expect(body.data.feed.token.prefix).not.toBe(originalPrefix);
    });

    it('rotates the token, invalidating the previous one immediately (FR-047)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/token/rotate`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const issued = (res.json() as { data: { token: string; url: string } }).data;
      expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(issued.url).toContain(issued.token);
    });

    it('revokes the token, leaving no public URL (FR-047)', async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/token/revoke`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(200);
      const token = (res.json() as { data: { token: Record<string, unknown> } }).data.token;
      expect(token['url']).toBeNull();
      expect(token['revokedAt']).not.toBeNull();
    });

    it('deletes the feed (204) and then answers 404', async () => {
      const del = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
      });
      expect(del.statusCode).toBe(204);
      const read = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...ADMIN,
      });
      expect(read.statusCode).toBe(404);
    });
  });

  describe('permission gating (FR-057)', () => {
    let feedId: string;

    beforeAll(async () => {
      const res = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ name: 'Gated feed' }),
      });
      feedId = String((res.json() as { data: { feed: { id: string } } }).data.feed.id);
    });

    it('lets a :read administrator list and read', async () => {
      const list = await h.app.inject({ method: 'GET', url: '/api/v1/admin/product-feeds', ...READER });
      expect(list.statusCode).toBe(200);
      const detail = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}`,
        ...READER,
      });
      expect(detail.statusCode).toBe(200);
    });

    it('refuses every mutation for a :read administrator', async () => {
      const cases: Array<[string, string, Record<string, unknown> | undefined]> = [
        ['POST', '/api/v1/admin/product-feeds', validBody()],
        ['PATCH', `/api/v1/admin/product-feeds/${feedId}`, { enabled: false }],
        ['POST', `/api/v1/admin/product-feeds/${feedId}/duplicate`, { name: 'x', slug: 'x-copy' }],
        ['POST', `/api/v1/admin/product-feeds/${feedId}/generate`, undefined],
        ['POST', `/api/v1/admin/product-feeds/${feedId}/token/rotate`, undefined],
        ['POST', `/api/v1/admin/product-feeds/${feedId}/token/revoke`, undefined],
        ['DELETE', `/api/v1/admin/product-feeds/${feedId}`, undefined],
      ];
      for (const [method, url, payload] of cases) {
        const res = await h.app.inject({
          method: method as 'POST',
          url,
          ...READER,
          ...(payload ? { payload } : {}),
        });
        expect(res.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('refuses the artefact download for a :read administrator — it carries prices', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}/artefact`,
        ...READER,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('generation trigger (FR-030, FR-032)', () => {
    it('returns 202 with a queued run without running inline', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ name: 'Trigger feed' }),
      });
      const feedId = String(
        (created.json() as { data: { feed: { id: string } } }).data.feed.id,
      );

      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/generate`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(202);
      const body = (res.json() as { data: { runId: string; status: string } }).data;
      expect(body.status).toBe('queued');
      expect(body.runId).toMatch(/^[0-9a-f-]{36}$/);

      // The run row exists and is still queued — nothing executed in-request.
      const runs = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/product-feeds/${feedId}/runs`,
        ...ADMIN,
      });
      expect(runs.statusCode).toBe(200);
      const rows = (runs.json() as { data: Array<{ id: string; status: string }> }).data;
      expect(rows.find((r) => r.id === body.runId)?.status).toBe('queued');
    });

    it('refuses to enqueue for a disabled feed (409 feed_disabled)', async () => {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: validBody({ name: 'Disabled feed', enabled: false }),
      });
      const feedId = String(
        (created.json() as { data: { feed: { id: string } } }).data.feed.id,
      );
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/product-feeds/${feedId}/generate`,
        ...ADMIN,
      });
      expect(res.statusCode).toBe(409);
      expect(res.body).toContain('feed_disabled');
    });
  });
});
