import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('storefront blog tag-by-code contract (T063)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  let defaultChannelCode: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    defaultChannelCode = channel.code;
    await h.em().getConnection().execute(
      `insert into blog_category_sales_channels (blog_category_id, sales_channel_id, slug)
         select id, ?, slug from blog_categories where is_system = true
         on conflict do nothing`,
      [defaultChannelId],
    );
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createTaggedPublishedPost(
    code: string,
    slug: string,
  ): Promise<{ tagId: string; postId: string; postSlug: string }> {
    const tag = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': code }, code }),
    });
    expect(tag.statusCode).toBe(201);
    const tagId = (tag.json() as { data: { id: string } }).data.id;

    const post = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        categoryIds: [],
      }),
    });
    expect(post.statusCode).toBe(201);
    const postData = (post.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${postData.id}/tags`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ tagIds: [tagId], version: postData.version }),
    });
    // Reload to pick up the bumped version after setTags.
    const reloaded = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${postData.id}`,
      cookies: adminCookie,
    });
    const reloadedVersion = (reloaded.json() as { data: { version: number } }).data.version;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${postData.id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: reloadedVersion }),
    });
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    return { tagId, postId: postData.id, postSlug: slug };
  }

  it('returns the tag metadata + paginated posts that carry the tag', async () => {
    const code = `t-${Date.now()}`;
    const created = await createTaggedPublishedPost(
      code,
      `t-post-${Date.now()}`,
    );

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/tag-by-code?code=${code}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: {
        tag: { code: string; name: string };
        posts: { data: Array<{ slug: string }>; pagination: { perPage: number } };
        breadcrumb: Array<{ name: string; url: string }>;
      };
    }).data;
    expect(body.tag.code).toBe(code);
    expect(body.tag.name).toBe(code);
    expect(body.posts.data.some((p) => p.slug === created.postSlug)).toBe(true);
    expect(body.posts.pagination.perPage).toBe(12);
    expect(body.breadcrumb).toEqual([
      { name: 'Blog', url: '/blog' },
      { name: code, url: `/blog/tag/${code}` },
    ]);
  });

  it('returns an empty data list with totalItems=0 when the tag has no published posts', async () => {
    const code = `empty-${Date.now()}`;
    await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/tags',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': code }, code }),
    });
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/tag-by-code?code=${code}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: { posts: { data: unknown[]; pagination: { totalItems: number } } };
    }).data;
    expect(body.posts.data).toEqual([]);
    expect(body.posts.pagination.totalItems).toBe(0);
  });

  it('returns 404 BLOG_TAG_NOT_FOUND for an unknown code', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/tag-by-code?code=does-not-exist-${Date.now()}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_TAG_NOT_FOUND,
    );
  });
});
