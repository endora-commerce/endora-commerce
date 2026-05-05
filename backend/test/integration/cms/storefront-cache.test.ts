import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';
import { CmsCache } from '../../../src/modules/cms/services/cms-cache.js';

/**
 * T096 — Storefront cache integration. Verifies:
 *   1. First resolveBySlug populates Redis at the documented key.
 *   2. Mutating the underlying row out-of-band, then reading again,
 *      returns the cached payload (proves the second read did not hit
 *      the DB).
 *   3. A Page write through the service invalidates the key, and the
 *      next read sees the new state.
 *   4. The same invariants hold for Block and Hook caches.
 */
describe('CMS storefront cache (T096)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  it('caches a resolved Page and serves the cached payload on the second read', async () => {
    expect(h.cms.cache).toBeDefined();
    const slug = `cache-page-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/pages',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Cache page',
        slug,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const page = (created.json() as { data: { id: string; version: number } }).data;

    const data = {
      root: { props: {} },
      content: [{ type: 'Heading', props: { level: 'h1', text: 'V1' } }],
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/pages/${page.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ data, version: page.version }),
    });
    expect(put.statusCode).toBe(200);
    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/pages/${page.id}/publish`,
      cookies: adminCookie,
    });
    expect(publish.statusCode).toBe(200);

    const cacheKey = CmsCache.pageKey(slug, defaultChannelCode, 'en-US');
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const first = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(first.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(1);

    // Mutate the row out-of-band so we can prove the cache was used —
    // a fresh DB read would observe the new heading text.
    await h.em().getConnection().execute(
      `update cms_pages
       set content = jsonb_set(content::jsonb, '{languages,en-US,content,0,props,text}', '"V2-DB-ONLY"')
       where id = ?`,
      [page.id],
    );

    const second = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json() as {
      data: { content: { data: { content: Array<{ props: { text: string } }> } } };
    };
    expect(secondBody.data.content.data.content[0]?.props.text).toBe('V1');

    // Patching through the service must invalidate the cache, and the
    // next read returns the latest DB state.
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/pages/${page.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: 'Cache page renamed' }),
    });
    expect(patch.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const third = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/pages/by-slug?slug=${encodeURIComponent(slug)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const thirdBody = third.json() as {
      data: {
        name: string;
        content: { data: { content: Array<{ props: { text: string } }> } };
      };
    };
    expect(thirdBody.data.name).toBe('Cache page renamed');
    expect(thirdBody.data.content.data.content[0]?.props.text).toBe('V2-DB-ONLY');
  });

  it('caches a resolved Block and invalidates on PATCH', async () => {
    const code = `cache-block-${Date.now()}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Cache block',
        code,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(created.statusCode).toBe(201);
    const block = (created.json() as { data: { id: string; version: number } }).data;

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${block.id}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: { root: { props: {} }, content: [{ type: 'Heading', props: { level: 'h2', text: 'Hello' } }] },
        version: block.version,
      }),
    });
    expect(put.statusCode).toBe(200);

    const cacheKey = CmsCache.blockKey(code, defaultChannelCode, 'en-US');
    expect(await h.redis.exists(cacheKey)).toBe(0);
    const first = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/blocks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(first.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(1);

    const refreshed = (put.json() as { data: { version: number } }).data;
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/cms/blocks/${block.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: 'Renamed', version: refreshed.version }),
    });
    expect(patch.statusCode).toBe(200);
    expect(await h.redis.exists(cacheKey)).toBe(0);
  });

  it('caches a resolved Hook payload and invalidates on attachment changes', async () => {
    const stamp = Date.now();
    const blockCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/blocks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Hook block',
        code: `hook-cache-block-${stamp}`,
        active: true,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(blockCreated.statusCode).toBe(201);
    const blockData = (blockCreated.json() as { data: { id: string; version: number } }).data;
    const blockId = blockData.id;
    const blockPut = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/cms/blocks/${blockId}/content/en-US`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        data: { root: { props: {} }, content: [{ type: 'Heading', props: { level: 'h3', text: 'Hooked' } }] },
        version: blockData.version,
      }),
    });
    expect(blockPut.statusCode).toBe(200);

    const hookCreated = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/cms/hooks',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: 'Cache hook',
        code: `cache-hook-${stamp}`,
        active: true,
        salesChannelIds: [defaultChannelId],
      }),
    });
    expect(hookCreated.statusCode).toBe(201);
    const hook = (hookCreated.json() as { data: { id: string; code: string } }).data;
    const cacheKey = CmsCache.hookKey(hook.code, defaultChannelCode, 'en-US');

    const first = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(hook.code)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json() as { data: { blocks: unknown[] } };
    expect(firstBody.data.blocks).toHaveLength(0);
    expect(await h.redis.exists(cacheKey)).toBe(1);

    const attached = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/cms/hooks/${hook.id}/attachments`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ blockId, position: 0 }),
    });
    expect(attached.statusCode).toBe(201);
    expect(await h.redis.exists(cacheKey)).toBe(0);

    const second = await h.app.inject({
      method: 'GET',
      url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(hook.code)}&language=en-US`,
      headers: { 'x-sales-channel': defaultChannelCode },
    });
    const secondBody = second.json() as { data: { blocks: unknown[] } };
    expect(secondBody.data.blocks).toHaveLength(1);
  });
});
