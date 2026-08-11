import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('admin Blog Related Products contract (T075)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const productIds: string[] = [];

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
    // Seed three real Products. Foundation migration's `products` table
    // schema is permissive enough to insert rows with the minimum
    // required fields.
    const conn = h.em().getConnection();
    for (const slug of ['rprod-a', 'rprod-b', 'rprod-c']) {
      const id = randomUUID();
      productIds.push(id);
      await conn.execute(
        `insert into products (id, sku, name, description, slug, type, status, created_at, updated_at)
         values (?, ?, ?::jsonb, '{}'::jsonb, ?, 'simple', 'active', now(), now())`,
        [id, `${slug}-sku-${Date.now()}`, JSON.stringify({ 'en-US': slug }), `${slug}-${Date.now()}`],
      );
    }
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    const conn = h.orm.em.getConnection();
    await conn.execute(
      `delete from blog_post_related_products where product_id = any (?::uuid[])`,
      [`{${productIds.join(',')}}`],
    );
    await conn.execute(`delete from products where id = any (?::uuid[])`, [
      `{${productIds.join(',')}}`,
    ]);
    await h.orm.close(true);
  });

  async function createPost(slug: string): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('PUT /related-products replaces the ordered list', async () => {
    const post = await createPost(`prod-list-${Date.now()}`);
    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${post.id}/related-products`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        productIds: [productIds[0]!, productIds[2]!, productIds[1]!],
        version: post.version,
      }),
    });
    expect(setRel.statusCode).toBe(200);
    const data = (setRel.json() as { data: { relatedProductIds: string[] } }).data;
    expect(data.relatedProductIds).toEqual([
      productIds[0],
      productIds[2],
      productIds[1],
    ]);
  });

  it('PUT with stale version returns 409 VERSION_CONFLICT', async () => {
    const post = await createPost(`prod-stale-${Date.now()}`);
    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${post.id}/related-products`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ productIds: [productIds[0]!], version: 99 }),
    });
    expect(setRel.statusCode).toBe(409);
  });
});
