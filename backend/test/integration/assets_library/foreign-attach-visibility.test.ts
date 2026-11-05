import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { TEST_ADMIN_ID } from '../../helpers/test-actors.js';
import { removeCrmAssets, seedCrmAdmin } from '../../helpers/seed-crm.js';

/**
 * Linking an existing library file to a record of a module **without** reader
 * restrictions (`specs/166-asset-reference-visibility/` FR-006 as amended by
 * review T055, finding F-2).
 *
 * A product, a category or a blog entry is an unrestricted reference: linking
 * a file the library hides from the caller would make it visible to every
 * library reader (FR-001 b), and refusing it any other way than a missing file
 * would say that it exists. So each path answers a hidden id exactly as a
 * random uuid — status, code and message, the id taken out — and links nothing.
 *
 * **R** may edit the catalog, the blog and the library, and may not read
 * Tasks: a file attached to a Task is hidden from R.
 */
describe('assets library — linking a hidden file from a module without reader restrictions (166 T055 F-2)', () => {
  let h: BackendServerHandle;
  let R: { cookies: { b2b_session: string }; adminUserId: string; undo: () => void };
  const W = { b2b_session: 'stub-admin-session' };
  let defaultChannelId: string;

  const run = randomUUID().slice(0, 8);
  const taskId = randomUUID();
  const assetIds: string[] = [];
  let hiddenImage: string;
  let hiddenPdf: string;
  let productId: string;
  let virtualProductId: string;
  let categoryId: string;
  let attachmentTypeId: string;
  let blogPostId: string;
  let blogCategoryId: string;

  const inject = (
    method: 'POST' | 'PATCH' | 'GET',
    url: string,
    cookies: Record<string, string>,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse> =>
    h.app.inject({ method, url, cookies, ...(payload === undefined ? {} : { payload }) });

  async function seedAsset(kind: 'image' | 'pdf'): Promise<string> {
    const id = randomUUID();
    const mime = kind === 'image' ? 'image/png' : 'application/pdf';
    await h.em().getConnection().execute(
      `insert into "assets"
         ("id", "kind", "filename", "mime_type", "size_bytes", "storage_url", "visibility",
          "storage_backend", "storage_locator", "created_at", "updated_at")
       values (?, ?, ?, ?, 2048, ?, 'public', 'local', ?, now(), now())`,
      [id, kind, `fav-${run}-${id.slice(0, 8)}.${kind === 'image' ? 'png' : 'pdf'}`, mime, `fa/${id}`, `fa/${id}`],
    );
    assetIds.push(id);
    return id;
  }

  async function createProduct(extra: Record<string, unknown>, cookies: Record<string, string> = W) {
    const suffix = randomUUID().slice(0, 8);
    return inject('POST', '/api/v1/admin/catalog/products', cookies, {
      sku: `FAV-${run}-${suffix}`,
      name: `FAV ${run} ${suffix}`,
      description: 'Feature 166 T055',
      categoryIds: [],
      attributeValues: {},
      visibility: 'public',
      type: 'simple',
      ...extra,
    });
  }

  beforeAll(async () => {
    h = await setupBackendServer();
    R = await seedCrmAdmin(h.em(), 'fav-r', [
      'catalog:read',
      'catalog:write',
      'blog.read',
      'blog.write',
      'assets.read',
      'assets.write',
    ]);
    defaultChannelId = (await h.em().findOneOrFail(SalesChannel, { systemDefault: true })).id;

    hiddenImage = await seedAsset('image');
    hiddenPdf = await seedAsset('pdf');
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into "tasks" ("id", "number", "title", "created_by_admin_user_id", "is_draft", "is_private")
       values (?, ?, ?, ?, false, false)`,
      [taskId, `T-FAV-${run}`, `FAV ${run}`, TEST_ADMIN_ID],
    );
    for (const assetId of [hiddenImage, hiddenPdf]) {
      await conn.execute(
        `insert into "task_attachments" ("task_id", "asset_id", "added_by_admin_user_id") values (?, ?, ?)`,
        [taskId, assetId, TEST_ADMIN_ID],
      );
    }

    const product = await createProduct({});
    expect(product.statusCode, product.body).toBe(201);
    productId = (product.json() as { data: { id: string } }).data.id;
    const virtual = await createProduct({ type: 'virtual', downloadUrl: 'https://files.example.com/fav.pdf' });
    expect(virtual.statusCode, virtual.body).toBe(201);
    virtualProductId = (virtual.json() as { data: { id: string } }).data.id;

    const category = await inject('POST', '/api/v1/admin/catalog/categories', W, {
      name: { 'en-US': `FAV ${run}` },
      slug: `fav-${run}`,
      parentCategoryId: null,
    });
    expect(category.statusCode, category.body).toBe(201);
    categoryId = (category.json() as { data: { id: string } }).data.id;

    const type = await inject('POST', '/api/v1/admin/catalog/attachment-types', W, {
      code: `fav_${run}`,
      name: { 'en-US': `FAV ${run}` },
    });
    expect(type.statusCode, type.body).toBe(201);
    attachmentTypeId = (type.json() as { data: { id: string } }).data.id;

    const post = await inject('POST', '/api/v1/admin/blog/posts', W, blogPost(null));
    expect(post.statusCode, post.body).toBe(201);
    blogPostId = (post.json() as { data: { id: string } }).data.id;
    const blogCat = await inject('POST', '/api/v1/admin/blog/categories', W, blogCategory(null));
    expect(blogCat.statusCode, blogCat.body).toBe(201);
    blogCategoryId = (blogCat.json() as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    const conn = h.orm.em.getConnection();
    const any = (ids: readonly string[]) => `{${ids.join(',')}}`;
    await conn.execute(`delete from gallery_items where asset_id = any(?::uuid[])`, [any(assetIds)]);
    await conn.execute(`delete from product_attachments where asset_id = any(?::uuid[])`, [any(assetIds)]);
    await conn.execute(`update products set download_asset_id = null where download_asset_id = any(?::uuid[])`, [any(assetIds)]);
    await conn.execute(`update categories set main_image_asset_id = null where main_image_asset_id = any(?::uuid[])`, [any(assetIds)]);
    await conn.execute(`update blog_posts set main_image_asset_id = null where main_image_asset_id = any(?::uuid[])`, [any(assetIds)]);
    await conn.execute(`update blog_categories set main_image_asset_id = null where main_image_asset_id = any(?::uuid[])`, [any(assetIds)]);
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

  /** Every place the reference tables could hold the hidden id. */
  async function referencesTo(assetId: string): Promise<number> {
    const [row] = await h.em().getConnection().execute<Array<{ n: string }>>(
      `select (
         (select count(*) from gallery_items where asset_id = ?)
       + (select count(*) from product_attachments where asset_id = ?)
       + (select count(*) from products where download_asset_id = ?)
       + (select count(*) from categories where main_image_asset_id = ?)
       + (select count(*) from blog_posts where main_image_asset_id = ?)
       + (select count(*) from blog_categories where main_image_asset_id = ?)
       )::text as n`,
      [assetId, assetId, assetId, assetId, assetId, assetId],
    );
    return Number(row!.n);
  }

  const blogPost = (mainImageAssetId: string | null) => ({
    name: { 'en-US': `FAV ${run}` },
    slug: `fav-${run}-${randomUUID().slice(0, 8)}`,
    salesChannelIds: [defaultChannelId],
    languages: ['en-US'],
    mainImageAssetId,
  });
  const blogCategory = (mainImageAssetId: string | null) => ({
    parentId: null,
    name: { 'en-US': `FAV ${run}` },
    slug: `fav-${run}-${randomUUID().slice(0, 8)}`,
    salesChannelIds: [defaultChannelId],
    languages: ['en-US'],
    enabled: true,
    mainImageAssetId,
  });

  /** Each admin path that links an existing library file by id, with the kind of file it takes. */
  const PATHS: ReadonlyArray<{
    name: string;
    kind: 'image' | 'pdf';
    send: (assetId: string) => Promise<LightMyRequestResponse>;
  }> = [
    {
      name: 'POST /catalog/products/:id/gallery',
      kind: 'image',
      send: (assetId) => inject('POST', `/api/v1/admin/catalog/products/${productId}/gallery`, R.cookies, { assetId }),
    },
    {
      name: 'POST /catalog/products/:id/attachments',
      kind: 'pdf',
      send: (assetId) =>
        inject('POST', `/api/v1/admin/catalog/products/${productId}/attachments`, R.cookies, {
          assetId,
          attachmentTypeId,
          name: 'FAV attachment',
        }),
    },
    {
      name: 'POST /catalog/products (virtual, downloadAssetId)',
      kind: 'pdf',
      send: (assetId) => createProduct({ type: 'virtual', downloadAssetId: assetId }, R.cookies),
    },
    {
      name: 'PATCH /catalog/categories/:id (mainImageAssetId)',
      kind: 'image',
      send: (assetId) => inject('PATCH', `/api/v1/admin/catalog/categories/${categoryId}`, R.cookies, { mainImageAssetId: assetId }),
    },
    {
      name: 'POST /blog/posts (mainImageAssetId)',
      kind: 'image',
      send: (assetId) => inject('POST', '/api/v1/admin/blog/posts', R.cookies, blogPost(assetId)),
    },
    {
      name: 'PATCH /blog/posts/:id (mainImageAssetId)',
      kind: 'image',
      send: (assetId) => inject('PATCH', `/api/v1/admin/blog/posts/${blogPostId}`, R.cookies, { mainImageAssetId: assetId }),
    },
    {
      name: 'PATCH /blog/categories/:id (mainImageAssetId)',
      kind: 'image',
      send: (assetId) =>
        inject('PATCH', `/api/v1/admin/blog/categories/${blogCategoryId}`, R.cookies, { mainImageAssetId: assetId }),
    },
    {
      name: 'POST /blog/categories (mainImageAssetId)',
      kind: 'image',
      send: (assetId) => inject('POST', '/api/v1/admin/blog/categories', R.cookies, blogCategory(assetId)),
    },
  ];

  it('the premise: R may not see either file, W may', async () => {
    for (const id of [hiddenImage, hiddenPdf]) {
      expect((await inject('GET', `/api/v1/admin/assets/${id}`, R.cookies)).statusCode).toBe(404);
      expect((await inject('GET', `/api/v1/admin/assets/${id}`, W)).statusCode).toBe(200);
    }
  });

  it.each(PATHS)('$name answers a hidden file exactly as a random uuid, and links nothing', async (path) => {
    const hidden = path.kind === 'image' ? hiddenImage : hiddenPdf;
    const missing = randomUUID();
    const forHidden = await path.send(hidden);
    const forMissing = await path.send(missing);
    expect(forMissing.statusCode, `random uuid: ${forMissing.body}`).toBeGreaterThanOrEqual(400);
    expect(forMissing.statusCode, `random uuid: ${forMissing.body}`).toBeLessThan(500);
    expect(normalised(forHidden, hidden)).toEqual(normalised(forMissing, missing));
    expect(await referencesTo(hidden)).toBe(0);
    expect((await inject('GET', `/api/v1/admin/assets/${hidden}`, R.cookies)).statusCode).toBe(404);
  });

  it('PATCH /catalog/products/:id is not a linking path: a downloadAssetId it is sent is not stored', async () => {
    const response = await inject('PATCH', `/api/v1/admin/catalog/products/${virtualProductId}`, R.cookies, {
      downloadAssetId: hiddenPdf,
      downloadUrl: null,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(await referencesTo(hiddenPdf)).toBe(0);
  });

    it('a file R may see is linked as before (the gallery, a blog post)', async () => {
    const visible = await seedAsset('image');
    const gallery = await inject('POST', `/api/v1/admin/catalog/products/${productId}/gallery`, R.cookies, { assetId: visible });
    expect(gallery.statusCode, gallery.body).toBe(201);
    const post = await inject('POST', '/api/v1/admin/blog/posts', R.cookies, blogPost(visible));
    expect(post.statusCode, post.body).toBe(201);
  });
});
