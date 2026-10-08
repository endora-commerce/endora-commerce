import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  CMS_STOREFRONT_CACHE_TAGS,
  MEGAMENU_STOREFRONT_CACHE_TAG,
} from '@endora-commerce/contracts';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * A saved page, block, template or hook reaches the shopper on the next
 * request — without an operator opening the cache screen.
 *
 * Two caches stand between an admin save and the storefront: `cms`' Redis
 * read-through cache, and the storefront's Next Data Cache in front of it
 * (`revalidate: 60` on every CMS read). Every write dropped the first and none
 * told the second, so a change appeared only once the 60 s window had run out
 * — and one request later than that, because a time-expired entry is served
 * stale once while it refreshes. The cache screen could not help: it clears
 * Redis namespaces, which the write had already done.
 *
 * These tests drive the real admin routes and read what the backend then asks
 * the storefront's `/api/revalidate` endpoint to drop. The tag names come from
 * `@endora-commerce/contracts`, which `storefront/test/lib/content-cache-tags.test.ts`
 * asserts the storefront's fetches carry — the two files are the two ends of
 * one contract.
 *
 * `fetch` is the seam because it is the one the revalidator crosses: the
 * harness serves requests through `app.inject`, which never touches it.
 */

const STOREFRONT = 'http://storefront.test:3010';
const REVALIDATE_URL = `${STOREFRONT}/api/revalidate`;

const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

describe('CMS writes revalidate the storefront', () => {
  let h: BackendServerHandle;
  let channelId: string;
  let channelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const json = { 'content-type': 'application/json' };

  /** Every tag posted at the storefront since the last `reset()`. */
  let posted: string[] = [];
  let storefrontDown = false;
  const realFetch = globalThis.fetch;

  function reset(): void {
    posted = [];
  }

  /** The revalidation is fire-and-forget, so the assertion waits for it. */
  async function expectPosted(tags: string[]): Promise<void> {
    await vi.waitFor(() => {
      for (const tag of tags) expect(posted).toContain(tag);
    });
  }

  beforeAll(async () => {
    // Before the harness composes: each module reads these when its
    // revalidator is first resolved, exactly as a deployment's process does.
    process.env['STOREFRONT_BASE_URL'] = STOREFRONT;
    process.env['REVALIDATE_SECRET'] = 'sekret';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) !== REVALIDATE_URL) return realFetch(input as never, init);
      if (storefrontDown) throw new Error('connect ECONNREFUSED');
      expect((init?.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
      const body = JSON.parse(String(init?.body)) as { tags: string[] };
      posted.push(...body.tags);
      return new Response(JSON.stringify({ revalidated: true }), { status: 200 });
    });

    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    channelId = channel.id;
    channelCode = channel.code;
  });

  afterEach(() => {
    storefrontDown = false;
    reset();
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (ORIGINAL_ENV.url === undefined) delete process.env['STOREFRONT_BASE_URL'];
    else process.env['STOREFRONT_BASE_URL'] = ORIGINAL_ENV.url;
    if (ORIGINAL_ENV.secret === undefined) delete process.env['REVALIDATE_SECRET'];
    else process.env['REVALIDATE_SECRET'] = ORIGINAL_ENV.secret;
    await teardownBackendServer(h);
  });

  const heading = (text: string) => ({
    root: { props: {} },
    content: [{ type: 'cms.Heading', props: { level: 'h2', text } }],
  });

  async function send(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<{ statusCode: number; data: { id: string; version: number } }> {
    const res = await h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(payload === undefined ? {} : { headers: json, payload: JSON.stringify(payload) }),
    });
    const body = res.body.length > 0 ? (res.json() as { data?: unknown }) : {};
    return {
      statusCode: res.statusCode,
      data: (body.data ?? {}) as { id: string; version: number },
    };
  }

  async function createBlock(code: string, text: string): Promise<{ id: string; version: number }> {
    const created = await send('POST', '/api/v1/admin/cms/blocks', {
      name: `Block ${code}`,
      code,
      active: true,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    const saved = await send(
      'PUT',
      `/api/v1/admin/cms/blocks/${created.data.id}/content/en-US`,
      { data: heading(text), version: created.data.version },
    );
    expect(saved.statusCode).toBe(200);
    return saved.data;
  }

  it('a page: create, content save, publish, archive and delete each name its slug and the index', async () => {
    const slug = `reval-page-${Date.now()}`;
    const pageTags = [CMS_STOREFRONT_CACHE_TAGS.page(slug), CMS_STOREFRONT_CACHE_TAGS.pageIndex];

    const created = await send('POST', '/api/v1/admin/cms/pages', {
      name: 'Revalidated page',
      slug,
      active: true,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    await expectPosted(pageTags);
    const id = created.data.id;

    reset();
    const saved = await send('PUT', `/api/v1/admin/cms/pages/${id}/content/en-US`, {
      data: heading('V1'),
      version: created.data.version,
    });
    expect(saved.statusCode).toBe(200);
    await expectPosted(pageTags);

    for (const transition of ['publish', 'archive', 'unarchive'] as const) {
      reset();
      const res = await send('POST', `/api/v1/admin/cms/pages/${id}/${transition}`);
      expect(res.statusCode).toBe(200);
      await expectPosted(pageTags);
    }

    reset();
    const patched = await send('PATCH', `/api/v1/admin/cms/pages/${id}`, { name: 'Renamed' });
    expect(patched.statusCode).toBe(200);
    await expectPosted(pageTags);

    reset();
    const deleted = await send('DELETE', `/api/v1/admin/cms/pages/${id}`);
    expect(deleted.statusCode).toBeLessThan(300);
    await expectPosted(pageTags);

    // One page's write is not every page's: the broad tag belongs to content
    // a page may embed, and a page embeds no other page.
    expect(posted).not.toContain(CMS_STOREFRONT_CACHE_TAGS.pages);
  });

  it('a renamed slug names the address the page left as well as the one it took', async () => {
    const before = `reval-old-${Date.now()}`;
    const after = `reval-new-${Date.now()}`;
    const created = await send('POST', '/api/v1/admin/cms/pages', {
      name: 'Moving page',
      slug: before,
      active: true,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    await expectPosted([CMS_STOREFRONT_CACHE_TAGS.page(before)]);

    reset();
    const patched = await send('PATCH', `/api/v1/admin/cms/pages/${created.data.id}`, {
      slug: after,
    });
    expect(patched.statusCode).toBe(200);
    await expectPosted([
      CMS_STOREFRONT_CACHE_TAGS.page(before),
      CMS_STOREFRONT_CACHE_TAGS.page(after),
      CMS_STOREFRONT_CACHE_TAGS.pageIndex,
    ]);
  });

  it('a block: every write names the block and everything that may inline it', async () => {
    const code = `reval-block-${Date.now()}`;
    const blockTags = [
      CMS_STOREFRONT_CACHE_TAGS.block(code),
      CMS_STOREFRONT_CACHE_TAGS.pages,
      CMS_STOREFRONT_CACHE_TAGS.hooks,
    ];

    const created = await send('POST', '/api/v1/admin/cms/blocks', {
      name: 'Revalidated block',
      code,
      active: true,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    await expectPosted(blockTags);

    reset();
    const saved = await send(
      'PUT',
      `/api/v1/admin/cms/blocks/${created.data.id}/content/en-US`,
      { data: heading('V1'), version: created.data.version },
    );
    expect(saved.statusCode).toBe(200);
    await expectPosted(blockTags);

    reset();
    const patched = await send('PATCH', `/api/v1/admin/cms/blocks/${created.data.id}`, {
      active: false,
    });
    expect(patched.statusCode).toBe(200);
    await expectPosted(blockTags);

    reset();
    const deleted = await send('DELETE', `/api/v1/admin/cms/blocks/${created.data.id}`);
    expect(deleted.statusCode).toBeLessThan(300);
    await expectPosted(blockTags);
  });

  it('a template: every write names every page', async () => {
    const code = `reval-template-${Date.now()}`;
    const created = await send('POST', '/api/v1/admin/cms/templates', {
      name: 'Revalidated template',
      code,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    await expectPosted([CMS_STOREFRONT_CACHE_TAGS.pages]);

    reset();
    const saved = await send(
      'PUT',
      `/api/v1/admin/cms/templates/${created.data.id}/content/en-US`,
      { data: heading('V1'), version: created.data.version },
    );
    expect(saved.statusCode).toBe(200);
    await expectPosted([CMS_STOREFRONT_CACHE_TAGS.pages]);

    reset();
    const deleted = await send('DELETE', `/api/v1/admin/cms/templates/${created.data.id}`);
    expect(deleted.statusCode).toBeLessThan(300);
    await expectPosted([CMS_STOREFRONT_CACHE_TAGS.pages]);
  });

  it('a hook: create, attach, detach and delete each name the hook', async () => {
    const code = `reval.hook.${Date.now()}`;
    const hookTags = [CMS_STOREFRONT_CACHE_TAGS.hook(code)];
    const block = await createBlock(`reval-hook-block-${Date.now()}`, 'Attached');

    reset();
    const created = await send('POST', '/api/v1/admin/cms/hooks', {
      name: 'Revalidated hook',
      code,
      active: true,
      salesChannelIds: [channelId],
    });
    expect(created.statusCode).toBe(201);
    await expectPosted(hookTags);

    reset();
    const attached = await send('POST', `/api/v1/admin/cms/hooks/${created.data.id}/attachments`, {
      blockId: block.id,
      position: 0,
    });
    expect(attached.statusCode).toBe(201);
    await expectPosted(hookTags);

    reset();
    const detached = await send(
      'DELETE',
      `/api/v1/admin/cms/hooks/${created.data.id}/attachments/${block.id}`,
    );
    expect(detached.statusCode).toBeLessThan(300);
    await expectPosted(hookTags);

    reset();
    const deleted = await send('DELETE', `/api/v1/admin/cms/hooks/${created.data.id}`);
    expect(deleted.statusCode).toBeLessThan(300);
    await expectPosted(hookTags);
  });

  it('a block save reaches a hook that inlines it — the Redis entry goes too', async () => {
    const code = `reval.hook.embed.${Date.now()}`;
    const block = await createBlock(`reval-embedded-${Date.now()}`, 'Before');
    const hook = await send('POST', '/api/v1/admin/cms/hooks', {
      name: 'Embedding hook',
      code,
      active: true,
      salesChannelIds: [channelId],
    });
    expect(hook.statusCode).toBe(201);
    const attached = await send('POST', `/api/v1/admin/cms/hooks/${hook.data.id}/attachments`, {
      blockId: block.id,
      position: 0,
    });
    expect(attached.statusCode).toBe(201);

    const read = async (): Promise<string> => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/cms/hooks/by-code?code=${encodeURIComponent(code)}&language=en-US`,
        headers: { 'x-sales-channel': channelCode },
      });
      expect(res.statusCode).toBe(200);
      return JSON.stringify(res.json());
    };
    // The first read fills the hook's Redis entry with the block's tree.
    expect(await read()).toContain('Before');

    const saved = await send('PUT', `/api/v1/admin/cms/blocks/${block.id}/content/en-US`, {
      data: heading('After'),
      version: block.version,
    });
    expect(saved.statusCode).toBe(200);

    // A storefront refetch answering the revalidation must not land on the
    // entry the write left behind.
    expect(await read()).toContain('After');
  });

  it('a block save reaches a megamenu that inlines it — its Redis entry and its tag', async () => {
    const block = await createBlock(`reval-menu-block-${Date.now()}`, 'MenuBefore');
    const menu = await send('POST', '/api/v1/admin/megamenu/menus', {
      name: `Revalidated menu ${Date.now()}`,
    });
    expect(menu.statusCode).toBe(201);

    reset();
    const parentId = '6f2c7b4a-1d3e-4cb5-ab21-fa1023df1177';
    const items = await send('PUT', `/api/v1/admin/megamenu/menus/${menu.data.id}/items`, {
      items: [
        {
          id: parentId,
          parentId: null,
          position: 0,
          kind: 'external-link',
          labels: { 'en-US': 'Specials' },
          target: { url: 'https://example.com/specials' },
        },
        {
          parentId,
          position: 0,
          kind: 'cms-block-embed',
          labels: { 'en-US': 'Hero' },
          target: { blockId: block.id, embedSide: 'right' },
        },
      ],
      version: menu.data.version,
    });
    expect(items.statusCode).toBe(200);
    // The menu's own write: its tree changed, so its storefront entry goes.
    await expectPosted([MEGAMENU_STOREFRONT_CACHE_TAG]);

    const scope = { salesChannelId: channelId, language: 'en-US' };
    await send('POST', `/api/v1/admin/megamenu/menus/${menu.data.id}/bindings`, scope);
    reset();
    const activated = await send(
      'POST',
      `/api/v1/admin/megamenu/menus/${menu.data.id}/activate`,
      scope,
    );
    expect(activated.statusCode).toBe(200);
    await expectPosted([MEGAMENU_STOREFRONT_CACHE_TAG]);

    const read = async (): Promise<string> => {
      const res = await h.app.inject({
        method: 'GET',
        url: '/api/v1/megamenu/by-channel?language=en-US',
        headers: { 'x-sales-channel': channelCode },
      });
      expect(res.statusCode).toBe(200);
      return JSON.stringify(res.json());
    };
    expect(await read()).toContain('MenuBefore');

    reset();
    const saved = await send('PUT', `/api/v1/admin/cms/blocks/${block.id}/content/en-US`, {
      data: heading('MenuAfter'),
      version: block.version,
    });
    expect(saved.statusCode).toBe(200);

    // The tag is posted only after the menu's Redis entry has gone, so by the
    // time it is observable the next read is the new tree.
    await expectPosted([MEGAMENU_STOREFRONT_CACHE_TAG]);
    expect(await read()).toContain('MenuAfter');

    reset();
    const deactivated = await send(
      'POST',
      `/api/v1/admin/megamenu/menus/${menu.data.id}/deactivate`,
      scope,
    );
    expect(deactivated.statusCode).toBeLessThan(300);
    await expectPosted([MEGAMENU_STOREFRONT_CACHE_TAG]);
  });

  it('a storefront that cannot be reached does not fail the save', async () => {
    storefrontDown = true;
    const code = `reval-down-${Date.now()}`;

    const created = await send('POST', '/api/v1/admin/cms/blocks', {
      name: 'Saved while the storefront is down',
      code,
      active: true,
      salesChannelIds: [channelId],
      languages: ['en-US'],
    });
    expect(created.statusCode).toBe(201);
    const saved = await send(
      'PUT',
      `/api/v1/admin/cms/blocks/${created.data.id}/content/en-US`,
      { data: heading('Still saved'), version: created.data.version },
    );
    expect(saved.statusCode).toBe(200);
  });
});
