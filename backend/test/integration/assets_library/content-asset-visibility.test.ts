import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { removeCrmAssets, seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * Asset ids stored in content bodies and settings (issue #544, the follow-up of
 * `specs/166-asset-reference-visibility/` review T055 finding F-2; owner
 * ruling 2026-10-30, option a).
 *
 * A CMS page body or sharing image, a category's page content, a blog post's
 * content, a blog category's description, the shop logo and a sales channel's
 * logo used to store an asset id without asking whether it exists. An id they
 * store is listed in the library for every reader, or published, so a file the
 * library hides from the caller is refused exactly as a missing one — and a
 * missing one, which used to be accepted, is now refused too.
 *
 * **R** may edit all of them and read the library, and may not read Tasks: a
 * file attached to a Task is hidden from R.
 */
describe('assets library — asset ids a content or setting write newly adds (issue #544)', () => {
  let h: BackendServerHandle;
  let R: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const W = { b2b_session: 'stub-admin-session' };
  let defaultChannelId: string;
  let defaultChannelCode: string;

  const run = randomUUID().slice(0, 8);
  const taskId = randomUUID();
  const assetIds: string[] = [];
  let hidden: string;
  let pageId: string;
  let categoryId: string;
  let blogPostId: string;
  let blogCategoryId: string;
  let shopLogoBefore: unknown;
  let channelLogoBefore: string | null;

  const inject = (
    method: 'POST' | 'PATCH' | 'PUT' | 'GET',
    url: string,
    cookies: Record<string, string>,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload }) });

  async function seedAsset(): Promise<string> {
    const id = randomUUID();
    await h.em().getConnection().execute(
      `insert into "assets"
         ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
          "storage_backend", "storage_locator", "created_at", "updated_at")
       values (?, 'image', ?, 'image/png', 2048, ?, 'public', 'local', ?, now(), now())`,
      [id, `cav-${run}-${id.slice(0, 8)}.png`, `cav/${id}`, `cav/${id}`],
    );
    assetIds.push(id);
    return id;
  }

  const doc = (assetId: string) => ({
    root: { props: {} },
    content: [{ type: 'cms.Image', props: { id: `img-${assetId.slice(0, 8)}`, assetId } }],
  });

  const versionOf = async (url: string): Promise<number> =>
    ((await inject('GET', url, W)).json() as { data: { version: number } }).data.version;

  beforeAll(async () => {
    h = await setupBackendServer();
    R = await seedCrmAdmin(h.em(), 'cav-r', [
      'cms.read',
      'cms.write',
      'catalog:read',
      'catalog:write',
      'blog.read',
      'blog.write',
      'settings:read',
      'settings:write',
      'sales_channels:read',
      'sales_channels:write',
      'assets.read',
      'assets.write',
    ]);
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
    channelLogoBefore = channel.logoAssetId ?? null;
    const [logo] = await h.em().getConnection().execute<Array<{ global_value: unknown }>>(
      `select global_value from settings where code = 'shop.logo_asset_id'`,
    );
    shopLogoBefore = logo?.global_value ?? null;

    hidden = await seedAsset();
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private")
       values (?, ?, ?, ?, false, false)`,
      [taskId, `T-CAV-${run}`, `CAV ${run}`, TEST_ADMIN_ID],
    );
    await conn.execute(
      `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
      [taskId, hidden, TEST_ADMIN_ID],
    );

    const page = await inject('POST', '/api/v1/admin/cms/pages', W, {
      name: `CAV ${run}`,
      slug: `cav-${run}`,
      active: true,
      salesChannelIds: [defaultChannelId],
      languages: [channel.defaultLanguage],
    });
    expect(page.statusCode, page.body).toBe(201);
    pageId = (page.json() as { data: { id: string } }).data.id;

    const category = await inject('POST', '/api/v1/admin/catalog/categories', W, {
      name: { 'en-US': `CAV ${run}` },
      slug: `cav-${run}`,
      parentCategoryId: null,
    });
    expect(category.statusCode, category.body).toBe(201);
    categoryId = (category.json() as { data: { id: string } }).data.id;

    const post = await inject('POST', '/api/v1/admin/blog/posts', W, {
      name: { 'en-US': `CAV ${run}` },
      slug: `cav-${run}`,
      salesChannelIds: [defaultChannelId],
      languages: ['en-US'],
    });
    expect(post.statusCode, post.body).toBe(201);
    blogPostId = (post.json() as { data: { id: string } }).data.id;
    const blogCategory = await inject('POST', '/api/v1/admin/blog/categories', W, {
      parentId: null,
      name: { 'en-US': `CAV ${run}` },
      slug: `cav-cat-${run}`,
      salesChannelIds: [defaultChannelId],
      languages: ['en-US'],
      enabled: true,
    });
    expect(blogCategory.statusCode, blogCategory.body).toBe(201);
    blogCategoryId = (blogCategory.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    const conn = h.orm.em.getConnection();
    if (pageId) await conn.execute(`delete from cms_pages where id = ?`, [pageId]);
    if (categoryId) await conn.execute(`update categories set content = null where id = ?`, [categoryId]);
    await conn.execute(`update sales_channels set logo_asset_id = ? where id = ?`, [channelLogoBefore, defaultChannelId]);
    await conn.execute(`update settings set global_value = ?::jsonb where code = 'shop.logo_asset_id'`, [
      shopLogoBefore === null ? null : JSON.stringify(shopLogoBefore),
    ]);
    await conn.execute(`delete from task_attachments where task_id = ?`, [taskId]);
    await conn.execute(`delete from tasks where id = ?`, [taskId]);
    await removeCrmAssets(h.orm.em, assetIds);
    R?.undo();
    await teardownBackendServer(h);
  });

  /** The answer with the asked id and the request id taken out: what must be equal byte for byte. */
  function normalised(response: LightMyRequestResponse, id: string): unknown {
    const body = JSON.parse(response.body.split(id).join('<id>')) as { error?: Record<string, unknown> };
    if (body.error) delete body.error.requestId;
    return { status: response.statusCode, body };
  }

  /** Each write that stores an asset id it was sent, as R. */
  const PATHS: ReadonlyArray<{ name: string; send: (assetId: string) => Promise<LightMyRequestResponse> }> = [
    {
      name: 'PUT /cms/pages/:id/content/:language',
      send: async (assetId) =>
        inject('PUT', `/api/v1/admin/cms/pages/${pageId}/content/en-US`, R.cookies, {
          data: doc(assetId),
          version: await versionOf(`/api/v1/admin/cms/pages/${pageId}`),
        }),
    },
    {
      name: 'PATCH /cms/pages/:id (shareImageAssetId)',
      send: async (assetId) =>
        inject('PATCH', `/api/v1/admin/cms/pages/${pageId}`, R.cookies, {
          shareImageAssetId: assetId,
          version: await versionOf(`/api/v1/admin/cms/pages/${pageId}`),
        }),
    },
    {
      name: 'PUT /catalog/categories/:id/content',
      send: (assetId) =>
        inject('PUT', `/api/v1/admin/catalog/categories/${categoryId}/content`, R.cookies, {
          content: { languages: { 'en-US': doc(assetId) } },
        }),
    },
    {
      name: 'PUT /blog/posts/:id/content',
      send: async (assetId) =>
        inject('PUT', `/api/v1/admin/blog/posts/${blogPostId}/content`, R.cookies, {
          content: { languages: { 'en-US': doc(assetId) } },
          version: await versionOf(`/api/v1/admin/blog/posts/${blogPostId}`),
        }),
    },
    {
      name: 'PUT /blog/categories/:id/description',
      send: async (assetId) =>
        inject('PUT', `/api/v1/admin/blog/categories/${blogCategoryId}/description`, R.cookies, {
          description: { languages: { 'en-US': doc(assetId) } },
          version: await versionOf(`/api/v1/admin/blog/categories/${blogCategoryId}`),
        }),
    },
    {
      name: 'PUT /settings/shop.logo_asset_id/value',
      send: (assetId) =>
        inject('PUT', '/api/v1/admin/settings/shop.logo_asset_id/value', R.cookies, { scope: 'all', value: assetId }),
    },
    {
      name: 'PATCH /sales-channels/:code (logoAssetId)',
      send: async (assetId) => {
        const detail = (await inject('GET', `/api/v1/admin/sales-channels/${defaultChannelCode}`, W)).json() as {
          version: number;
        };
        return inject('PATCH', `/api/v1/admin/sales-channels/${defaultChannelCode}`, R.cookies, {
          logoAssetId: assetId,
          expectedVersion: detail.version,
        });
      },
    },
  ];

  /** Whether any of the stores above holds the id. */
  async function stored(assetId: string): Promise<boolean> {
    const [row] = await h.em().getConnection().execute<Array<{ n: string }>>(
      `select (
         (select count(*) from cms_pages where id = ? and (content::text like ? or share_image_asset_id::text = ?))
       + (select count(*) from categories where id = ? and content::text like ?)
       + (select count(*) from blog_posts where id = ? and content::text like ?)
       + (select count(*) from blog_categories where id = ? and description::text like ?)
       + (select count(*) from settings where code = 'shop.logo_asset_id' and global_value::text like ?)
       + (select count(*) from sales_channels where logo_asset_id::text = ?)
       )::text as n`,
      [pageId, `%${assetId}%`, assetId, categoryId, `%${assetId}%`, blogPostId, `%${assetId}%`, blogCategoryId, `%${assetId}%`, `%${assetId}%`, assetId],
    );
    return Number(row!.n) > 0;
  }

  it('the premise: R may not see the file, W may', async () => {
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, R.cookies)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, W)).statusCode).toBe(200);
  });

  it.each(PATHS)('$name refuses a hidden file exactly as a missing one, and stores neither', async (path) => {
    const missing = randomUUID();
    const forHidden = await path.send(hidden);
    const forMissing = await path.send(missing);
    expect(forMissing.statusCode, `random uuid: ${forMissing.body}`).toBe(404);
    expect(normalised(forHidden, hidden)).toEqual(normalised(forMissing, missing));
    expect(await stored(hidden)).toBe(false);
    expect(await stored(missing)).toBe(false);
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, R.cookies)).statusCode).toBe(404);
  });

  it.each(PATHS)('$name stores a file R may see, as before', async (path) => {
    const visible = await seedAsset();
    const response = await path.send(visible);
    expect(response.statusCode, response.body).toBeLessThan(300);
    expect(await stored(visible)).toBe(true);
  });
});
