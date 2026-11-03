import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Feature 171 (US3, FR-022 as amended, T043) — a published post exists in each of its
 * languages, so publishing requires every assigned language to be written: a name in
 * each, and — once the post has content in any language — content in each. A draft
 * may be incomplete. A category needs a name in each of its languages on every save.
 */
describe('blog publish guard (feature 171, T043)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };
  const run = `bg171-${randomUUID().slice(0, 8)}`;
  let channelId: string;
  const postIds: string[] = [];

  const tree = (text: string) => ({ type: 'root', children: [{ type: 'text', props: { value: text } }] });

  async function call(method: 'POST' | 'PATCH' | 'PUT' | 'GET', url: string, body?: unknown) {
    return h.app.inject({
      method,
      url,
      cookies: adminCookie,
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, payload: JSON.stringify(body) }),
    });
  }

  async function draft(name: Record<string, string>, content?: Record<string, unknown>) {
    const res = await call('POST', '/api/v1/admin/blog/posts', {
      name,
      slug: `${run}-${postIds.length}`,
      salesChannelIds: [channelId],
      languages: ['pl-PL', 'en-US'],
      categoryIds: [],
      ...(content ? { content: { schema_version: 1, languages: content } } : {}),
    });
    expect(res.statusCode, res.body).toBe(201);
    const post = (res.json() as { data: { id: string; version: number } }).data;
    postIds.push(post.id);
    return post;
  }

  function refusal(res: { statusCode: number; json: () => unknown }) {
    const body = res.json() as { error: { code: string; details?: Array<{ path: string }> } };
    return { status: res.statusCode, code: body.error?.code, paths: (body.error?.details ?? []).map((d) => d.path) };
  }

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const em = h.em();
    const channel = em.create(SalesChannel, {
      code: `${run}-ch`,
      name: { 'pl-PL': 'Publikacja' },
      languages: ['pl-PL', 'en-US'],
      defaultLanguage: 'pl-PL',
      currencies: ['PLN'],
      defaultCurrency: 'PLN',
      active: true,
      systemDefault: false,
      status: 'active',
    });
    await em.persistAndFlush(channel);
    channelId = channel.id;
  });

  afterAll(async () => {
    const connection = h.em().getConnection();
    for (const id of postIds) {
      for (const table of ['blog_post_categories', 'blog_post_languages', 'blog_post_sales_channels']) {
        await connection.execute(`delete from ${table} where blog_post_id = ?`, [id]);
      }
      await connection.execute('delete from blog_posts where id = ?', [id]);
    }
    await connection.execute('delete from sales_channels where id = ?', [channelId]);
    await teardownBackendServer(h);
  });

  it('saves an incomplete draft, and refuses to publish it without a name in every language', async () => {
    const post = await draft({ 'pl-PL': 'Tylko po polsku' });
    const res = await call('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
    expect(refusal(res)).toEqual({ status: 422, code: 'BLOG_LANGUAGE_INCOMPLETE', paths: ['name.en-US'] });
  });

  it('refuses to publish a post written in one language and assigned to two', async () => {
    const post = await draft({ 'pl-PL': 'Wpis', 'en-US': 'Post' }, { 'pl-PL': tree('Treść') });
    const res = await call('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
    expect(refusal(res)).toEqual({ status: 422, code: 'BLOG_LANGUAGE_INCOMPLETE', paths: ['content.en-US'] });
  });

  it('publishes a complete post, and refuses a patch that would leave it incomplete', async () => {
    const post = await draft({ 'pl-PL': 'Wpis', 'en-US': 'Post' }, { 'pl-PL': tree('Treść'), 'en-US': tree('Text') });
    const published = await call('POST', `/api/v1/admin/blog/posts/${post.id}/publish`, { version: post.version });
    expect(published.statusCode, published.body).toBe(200);
    const version = (published.json() as { data: { version: number } }).data.version;
    const res = await call('PATCH', `/api/v1/admin/blog/posts/${post.id}`, { name: { 'pl-PL': 'Wpis' }, version });
    expect(refusal(res)).toEqual({ status: 422, code: 'BLOG_LANGUAGE_INCOMPLETE', paths: ['name.en-US'] });
  });

  it('refuses a category without a name in every language it is assigned to', async () => {
    const res = await call('POST', '/api/v1/admin/blog/categories', {
      parentId: null,
      name: { 'pl-PL': 'Kategoria' },
      slug: `${run}-kat`,
      salesChannelIds: [channelId],
      languages: ['pl-PL', 'en-US'],
    });
    expect(refusal(res)).toEqual({ status: 422, code: 'BLOG_LANGUAGE_INCOMPLETE', paths: ['name.en-US'] });
  });
});
