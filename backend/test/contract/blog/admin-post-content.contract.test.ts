import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

describe('admin Blog Post content contract (T031)', () => {
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
    await teardownBackendServer(h);
  });

  async function createDraft(slug: string): Promise<{ id: string; version: number }> {
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
        categoryIds: [],
        tagIds: [],
      }),
    });
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; version: number } }).data;
    return data;
  }

  it('PUT /content saves a per-language Page Builder tree and reading back returns the same tree', async () => {
    const post = await createDraft(`content-roundtrip-${Date.now()}`);
    const tree = {
      schema_version: 1,
      languages: {
        'en-US': {
          type: 'root',
          children: [
            { type: 'heading', props: { level: 1, text: 'Hello' } },
            { type: 'text', props: { value: 'World' } },
          ],
        },
      },
    };
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${post.id}/content`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ content: tree, version: post.version }),
    });
    expect(put.statusCode).toBe(200);
    const reloaded = (put.json() as { data: { content: typeof tree; version: number } }).data;
    expect(reloaded.content).toEqual(tree);
    expect(reloaded.version).toBe(post.version + 1);
  });

  it('PUT /content with stale If-Match version returns 409 VERSION_CONFLICT', async () => {
    const post = await createDraft(`content-stale-${Date.now()}`);
    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${post.id}/content`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        content: { schema_version: 1, languages: { 'en-US': {} } },
        version: 99,
      }),
    });
    expect(put.statusCode).toBe(409);
    expect((put.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });
});
