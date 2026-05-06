import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin Blog Tags CRUD contract (T062)', () => {
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

  async function createTag(code: string): Promise<{ id: string; version: number; code: string }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': code },
        code,
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number; code: string } }).data;
  }

  it('creates a Tag with a unique global code', async () => {
    const code = `test-${Date.now()}`;
    const tag = await createTag(code);
    expect(tag.code).toBe(code);
    expect(tag.version).toBe(1);
  });

  it('refuses a duplicate code with 409 BLOG_TAG_CODE_TAKEN', async () => {
    const code = `dup-${Date.now()}`;
    await createTag(code);
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': 'X' }, code }),
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_TAG_CODE_TAKEN,
    );
  });

  it('PATCH with stale version returns 409 VERSION_CONFLICT', async () => {
    const tag = await createTag(`stale-${Date.now()}`);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/blog/tags/${tag.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': 'New' }, version: 99 }),
    });
    expect(patch.statusCode).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });

  it('refuses delete while attached to a post (BLOG_TAG_IN_USE)', async () => {
    const tag = await createTag(`inuse-${Date.now()}`);
    const post = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'P' },
        slug: `tagged-${Date.now()}`,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        categoryIds: [],
      }),
    });
    const postData = (post.json() as { data: { id: string; version: number } }).data;
    const setTags = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${postData.id}/tags`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ tagIds: [tag.id], version: postData.version }),
    });
    expect(setTags.statusCode).toBe(200);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/tags/${tag.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: tag.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_TAG_IN_USE,
    );
  });

  it('inbound-references probe surfaces referencing posts', async () => {
    const tag = await createTag(`probe-${Date.now()}`);
    const post = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'P' },
        slug: `probe-tag-${Date.now()}`,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    const postData = (post.json() as { data: { id: string; version: number; slug: string } })
      .data;
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${postData.id}/tags`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ tagIds: [tag.id], version: postData.version }),
    });

    const probe = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/tags/${tag.id}/inbound-references`,
      cookies: adminCookie,
    });
    expect(probe.statusCode).toBe(200);
    const data = (probe.json() as {
      data: { posts: Array<{ id: string }>; totalPosts: number };
    }).data;
    expect(data.totalPosts).toBeGreaterThanOrEqual(1);
    expect(data.posts.some((p) => p.id === postData.id)).toBe(true);
  });
});
