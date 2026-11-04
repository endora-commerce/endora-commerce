import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('storefront blog by-slug contract (T049)', () => {
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

  it('returns kind=post for a published post slug', async () => {
    const slug = `post-slug-${Date.now()}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'Post' },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        categoryIds: [],
      }),
    });
    const data = (create.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${data.id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: data.version }),
    });
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${slug}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: { kind: string; post?: { slug: string } };
    }).data;
    expect(body.kind).toBe('post');
    expect(body.post?.slug).toBe(slug);
  });

  it('returns kind=category for a category slug, with paginated posts', async () => {
    const slug = `cat-slug-${Date.now()}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': 'Cat' },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
      }),
    });
    expect(create.statusCode).toBe(201);
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${slug}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(200);
    const body = (res.json() as {
      data: {
        kind: string;
        category?: { slug: string };
        posts?: { pagination: { perPage: number } };
      };
    }).data;
    expect(body.kind).toBe('category');
    expect(body.category?.slug).toBe(slug);
    expect(body.posts?.pagination.perPage).toBe(12); // documented default
  });

  it('404s a post in a language it is not written in (feature 171)', async () => {
    // Feature 171 (US3, OR-7) reverses the earlier rule that served a post in any
    // language: a post exists in the languages assigned to it, and the lists stop
    // showing it elsewhere too, so the list/detail disagreement this once guarded
    // against cannot recur.
    const slug = `foreign-lang-${Date.now()}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'pl-PL': 'Witaj' },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['pl-PL'],
        categoryIds: [],
      }),
    });
    expect(create.statusCode).toBe(201);
    const data = (create.json() as { data: { id: string; version: number } }).data;
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${data.id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: data.version }),
    });
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    // The default channel serves en-US only, so a post written only in pl-PL has no
    // language here to exist in.
    const english = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${slug}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(english.statusCode).toBe(404);
  });

  it('returns 404 for an unknown slug', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=nope-${Date.now()}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_POST_NOT_FOUND,
    );
  });

  it('omits a draft post from the by-slug resolution', async () => {
    const slug = `draft-only-${Date.now()}`;
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'Draft' },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
      }),
    });
    expect(create.statusCode).toBe(201);
    if (h.blog.cache) await h.blog.cache.invalidateAll();

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${slug}`,
      headers: { 'x-sales-channel': defaultChannelCode, 'x-blog-language': 'en-US' },
    });
    expect(res.statusCode).toBe(404);
  });
});
