import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { READ_ONLY_ROLE_ID } from '../../helpers/seed-admins.js';

/**
 * Feature 171 (US6, US7; T074, T075, T083, T084) — an administrator's author profile
 * (avatar, biography per language) and a post's author.
 *
 * - The profile is the administrator's own to edit, without `admin_users:manage`; an
 *   avatar must be a library asset, and the library counts it as a use of the asset.
 * - An editor with `blog.write` picks the author among active administrators and sees
 *   nothing else about them.
 * - The storefront shows the author's name, avatar and biography (request language,
 *   else the channel default); an inactive author is still shown, a deleted one is
 *   not; a profile edit is visible on the next request without any cache flush.
 */
describe('blog authors (feature 171, T074/T075/T083/T084)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };
  const blogManager = { b2b_session: 'stub-blog-manager-session' };
  const run = `ba171-${randomUUID().slice(0, 8)}`;
  let channel: { id: string; code: string };
  let authorId: string;
  let otherAuthorId: string;
  let postId: string;
  let assetId: string;
  const postIds: string[] = [];

  async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    cookies: Record<string, string> = admin,
  ) {
    return h.app.inject({
      method,
      url,
      cookies,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
  }

  async function createAdmin(suffix: string, firstName: string) {
    const res = await call('POST', '/api/v1/admin/admin-users', {
      email: `${run}-${suffix}@example.com`,
      password: 'super-strong-pass-123!',
      firstName,
      lastName: 'Kowalska',
      adminRoleId: READ_ONLY_ROLE_ID,
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function storefrontPost(language: string) {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/by-slug?slug=${run}-wpis`,
      headers: { 'x-sales-channel': channel.code, 'x-blog-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { post: { author: Record<string, unknown> | null } } }).data.post;
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const created = em.create(SalesChannel, {
      code: `${run}-ch`,
      name: { 'pl-PL': 'Autorzy' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(created);
    channel = { id: created.id, code: created.code };

    assetId = randomUUID();
    await em.getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, label, visibility, created_at, updated_at)
       values (?, 'image', 'avatar.png', 'image/png', 1024, ?, 'Avatar', 'public', now(), now())`,
      [assetId, `https://example.test/${assetId}.png`],
    );

    authorId = await createAdmin('anna', 'Anna');
    otherAuthorId = await createAdmin('ola', 'Ola');
  });

  beforeEach(async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of postIds) {
      for (const table of ['blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
        await connection.execute(`delete from ${table} where blog_post_id = ?`, [id]);
      }
      await connection.execute('delete from blog_posts where id = ?', [id]);
    }
    await connection.execute('update admin_users set avatar_asset_id = null where avatar_asset_id = ?', [assetId]);
    await connection.execute('delete from assets where id = ?', [assetId]);
    await connection.execute('delete from blog_url_prefixes where sales_channel_id = ?', [channel.id]);
    await connection.execute('delete from sales_channels where id = ?', [channel.id]);
    await teardownBackendServer(h);
  });

  it('lets an administrator set their author profile, and refuses an avatar that is no asset', async () => {
    const unknown = await call('PATCH', `/api/v1/admin/admin-users/${authorId}`, { avatarAssetId: randomUUID() });
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('ADMIN_USER_AVATAR_NOT_FOUND');

    const res = await call('PATCH', `/api/v1/admin/admin-users/${authorId}`, {
      avatarAssetId: assetId,
      bio: { 'pl-PL': 'Piszę o narzędziach.', 'en-US': 'I write about tools.' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as { data: Record<string, unknown> }).data).toMatchObject({
      avatarAssetId: assetId,
      bio: { 'pl-PL': 'Piszę o narzędziach.', 'en-US': 'I write about tools.' },
    });

    const own = await call('PATCH', '/api/v1/admin/me', { bio: { 'pl-PL': 'O mnie' } });
    expect(own.statusCode, own.body).toBe(200);
    expect((own.json() as { data: { bio: unknown } }).data.bio).toEqual({ 'pl-PL': 'O mnie' });
  });

  it('counts the avatar as a use of the asset', async () => {
    const res = await call('DELETE', `/api/v1/admin/assets/${assetId}`);
    expect(res.statusCode, res.body).toBe(409);
    expect(res.body).toContain('admin_user_avatar');
  });

  it('offers an editor with blog.write the active administrators, by name and avatar only', async () => {
    const res = await call('GET', `/api/v1/admin/blog/author-candidates?q=Anna`, undefined, blogManager);
    expect(res.statusCode, res.body).toBe(200);
    const candidates = (res.json() as { data: Array<Record<string, unknown>> }).data;
    expect(candidates).toContainEqual({ id: authorId, name: 'Anna Kowalska', avatarUrl: expect.stringContaining(assetId) });
    for (const candidate of candidates) expect(Object.keys(candidate).sort()).toEqual(['avatarUrl', 'id', 'name']);
    expect(res.body).not.toContain('@example.com');
  });

  it('names the author on the post, and shows them on the storefront in the request language', async () => {
    const created = await call('POST', '/api/v1/admin/blog/posts', {
      name: { 'pl-PL': 'Wpis', 'en-US': 'Post' },
      slug: `${run}-wpis`,
      salesChannelIds: [channel.id],
      languages: ['pl-PL', 'en-US'],
      categoryIds: [],
      authorAdminUserId: authorId,
    });
    expect(created.statusCode, created.body).toBe(201);
    const post = (created.json() as { data: { id: string; version: number; author: unknown } }).data;
    postId = post.id;
    postIds.push(post.id);
    expect(post.author).toMatchObject({ id: authorId, name: 'Anna Kowalska', state: 'active' });
    const published = await call('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
    expect(published.statusCode, published.body).toBe(200);

    expect(await storefrontPost('en-US')).toMatchObject({
      authorId,
      author: { id: authorId, name: 'Anna Kowalska', bio: 'I write about tools.', avatarUrl: expect.stringContaining(assetId) },
    });
    const list = await h.app.inject({
      method: 'GET',
      url: `/api/v1/blog/posts?authorId=${authorId}`,
      headers: { 'x-sales-channel': channel.code, 'x-blog-language': 'pl-PL' },
    });
    const cards = (list.json() as { data: Array<{ id: string; author: unknown }> }).data;
    expect(cards.map((c) => c.id)).toEqual([postId]);
    expect(cards[0]!.author).toEqual({ id: authorId, name: 'Anna Kowalska', avatarUrl: expect.stringContaining(assetId) });
    expect(list.body).not.toContain('@example.com');
  });

  it('shows a profile edit on the next request, without a cache flush', async () => {
    if (h.blog.cache) await h.blog.cache.invalidateAll();
    const read = () =>
      h.app.inject({
        method: 'GET',
        url: `/api/v1/blog/by-slug?slug=${run}-wpis`,
        headers: { 'x-sales-channel': channel.code, 'x-blog-language': 'en-US' },
      });
    await read(); // warms the cache
    await call('PATCH', `/api/v1/admin/admin-users/${authorId}`, { bio: { 'en-US': 'Updated.' } });
    const after = (await read()).json() as { data: { post: { author: { bio: string | null } } } };
    expect(after.data.post.author.bio).toBe('Updated.');
  });

  it('refuses an author who is not an active administrator, and keeps one who became inactive', async () => {
    const fresh = (await call('GET', `/api/v1/admin/blog/posts/${postId}`)).json() as { data: { version: number } };
    const unknown = await call('PATCH', `/api/v1/admin/blog/posts/${postId}`, {
      authorAdminUserId: randomUUID(),
      version: fresh.data.version,
    });
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect((unknown.json() as { error: { code: string } }).error.code).toBe('BLOG_AUTHOR_NOT_FOUND');

    const deactivated = await call('PATCH', `/api/v1/admin/admin-users/${authorId}`, { status: 'inactive' });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect((await storefrontPost('en-US')).author).toMatchObject({ id: authorId, name: 'Anna Kowalska' });
    const detail = (await call('GET', `/api/v1/admin/blog/posts/${postId}`)).json() as {
      data: { version: number; author: { state: string } };
    };
    expect(detail.data.author.state).toBe('inactive');

    const naming = await call('PATCH', `/api/v1/admin/blog/posts/${postId}`, {
      authorAdminUserId: authorId,
      version: detail.data.version,
    });
    expect(naming.statusCode, naming.body).toBe(200);
  });

  it('shows no author once the administrator is deleted', async () => {
    const deleted = await call('DELETE', `/api/v1/admin/admin-users/${authorId}`);
    expect(deleted.statusCode, deleted.body).toBeLessThan(300);
    expect((await storefrontPost('en-US')).author).toBeNull();
    const detail = (await call('GET', `/api/v1/admin/blog/posts/${postId}`)).json() as { data: { author: { state: string } } };
    expect(detail.data.author.state).toBe('deleted');
    // The other administrator is still a candidate; the deleted one is not.
    const candidates = (await call('GET', '/api/v1/admin/blog/author-candidates')).json() as { data: Array<{ id: string }> };
    expect(candidates.data.map((c) => c.id)).toContain(otherAuthorId);
    expect(candidates.data.map((c) => c.id)).not.toContain(authorId);
  });
});
