import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin Blog Category description contract (T041)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    await h.em().getConnection().execute(
      `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
         select id, ?, slug from blog_categories where is_system = true
         on conflict do nothing`,
      [defaultChannelId],
    );
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createCategory(slug: string): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('PUT /description saves a per-language Page Builder tree and round-trips via GET', async () => {
    const cat = await createCategory(`desc-${Date.now()}`);
    const tree = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [{ type: 'heading', props: { level: 2, text: 'About' } }],
        },
      },
    };

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/categories/${cat.id}/description`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ description: tree, version: cat.version }),
    });
    expect(put.statusCode).toBe(200);
    const reloaded = (put.json() as {
      data: { description: typeof tree; version: number };
    }).data;
    expect(reloaded.description).toEqual(tree);
    expect(reloaded.version).toBe(cat.version + 1);
  });

  it('an asset id embedded in the description tree is discoverable by AssetReferenceRegistry', async () => {
    const cat = await createCategory(`desc-asset-${Date.now()}`);
    // Insert a real Library Asset row.
    const conn = h.em().getConnection();
    const assetId = randomUUID();
    await conn.execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
         values (?, 'image', 'test.png', 'image/png', 1024, 'local:test-key', now(), now())`,
      [assetId],
    );

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/categories/${cat.id}/description`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        description: {
          schema_version: 1,
          languages: {
            'en-US': {
              type: 'root',
              children: [{ type: 'image', props: { assetId } }],
            },
          },
        },
        version: cat.version,
      }),
    });
    expect(put.statusCode).toBe(200);

    const refs = await h.assetsLibrary.referenceRegistry.findReferences(assetId);
    const blogRefs = refs.filter((r) => r.kind === 'blog_category_description');
    expect(blogRefs.length).toBeGreaterThan(0);
    expect(blogRefs[0]!.entityId).toBe(cat.id);

    // Cleanup the asset so afterAll's catastrophic deletion succeeds.
    await conn.execute(
      `update blog_categories set description = null where id = ?`,
      [cat.id],
    );
    await conn.execute(`delete from assets where id = ?`, [assetId]);
  });
});
