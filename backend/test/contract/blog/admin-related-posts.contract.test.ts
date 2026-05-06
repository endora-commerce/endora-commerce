import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin Blog Related Posts contract (T074)', () => {
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

  async function getPost(id: string): Promise<{
    id: string;
    version: number;
    relatedPostIds: string[];
  }> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${id}`,
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { id: string; version: number; relatedPostIds: string[] } })
      .data;
  }

  it('PUT /related-posts replaces the ordered list and the order survives a reload', async () => {
    const a = await createPost(`rp-a-${Date.now()}`);
    const b = await createPost(`rp-b-${Date.now()}`);
    const c = await createPost(`rp-c-${Date.now()}`);

    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [c.id, b.id], version: a.version }),
    });
    expect(setRel.statusCode).toBe(200);

    const reloaded = await getPost(a.id);
    expect(reloaded.relatedPostIds).toEqual([c.id, b.id]);

    // Replace with a different order — verify it overwrites the prior list.
    const setRel2 = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [b.id, c.id], version: reloaded.version }),
    });
    expect(setRel2.statusCode).toBe(200);
    const reloaded2 = await getPost(a.id);
    expect(reloaded2.relatedPostIds).toEqual([b.id, c.id]);
  });

  it('refuses an entry equal to the parent post id (BLOG_RELATED_POST_SELF_REFERENCE)', async () => {
    const a = await createPost(`rp-self-${Date.now()}`);
    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [a.id], version: a.version }),
    });
    expect(setRel.statusCode).toBe(422);
    expect((setRel.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_RELATED_POST_SELF_REFERENCE,
    );
  });

  it('PUT with stale version returns 409 VERSION_CONFLICT', async () => {
    const a = await createPost(`rp-stale-${Date.now()}`);
    const b = await createPost(`rp-stale-b-${Date.now()}`);
    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [b.id], version: 99 }),
    });
    expect(setRel.statusCode).toBe(409);
    expect((setRel.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });
});
