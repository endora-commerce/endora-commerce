import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('admin Blog Posts CRUD contract (T030)', () => {
  let h: BackendServerHandle;
  let defaultChannelId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    const channel = await h.em().findOneOrFail(SalesChannel, { systemDefault: true });
    defaultChannelId = channel.id;
    // The plugin's reconciler runs on first registration; the seeded
    // Default Category may or may not be attached to the system-default
    // channel depending on creation order. Make sure the attachment
    // exists so the auto-fill happens.
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

  async function createPost(slug: string, overrides?: Record<string, unknown>) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': `Post ${slug}` },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        categoryIds: [],
        tagIds: [],
        ...overrides,
      }),
    });
    return res;
  }

  it('creates a Post with auto-fill of the seeded Default category when categoryIds is empty (FR-011)', async () => {
    const res = await createPost(`auto-default-${Date.now()}`);
    expect(res.statusCode).toBe(201);
    const data = (res.json() as { data: { id: string; status: string; categoryIds: string[]; version: number } })
      .data;
    expect(data.status).toBe('draft');
    expect(data.version).toBe(1);
    expect(data.categoryIds).toHaveLength(1);
  });

  it('refuses an invalid slug (literal "tag" reserved)', async () => {
    const res = await createPost('tag');
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('refuses zero salesChannelIds (BLOG_POST_NO_CHANNEL)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'X' },
        slug: `no-channel-${Date.now()}`,
        salesChannelIds: [],
        languages: ['en-US'],
      }),
    });
    expect(res.statusCode).toBe(400); // zod refuses min(1) before service code runs
  });

  it('flips through the lifecycle draft → published → archived', async () => {
    const created = await createPost(`lifecycle-${Date.now()}`);
    const id = (created.json() as { data: { id: string; version: number } }).data.id;

    const publish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${id}/publish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: 1 }),
    });
    expect(publish.statusCode).toBe(200);
    const pub = (publish.json() as {
      data: { status: string; publishedAt: string | null; version: number };
    }).data;
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).not.toBeNull();

    const unpublish = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${id}/unpublish`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: pub.version }),
    });
    expect(unpublish.statusCode).toBe(200);
    const unp = (unpublish.json() as {
      data: { status: string; publishedAt: string | null; version: number };
    }).data;
    expect(unp.status).toBe('draft');
    expect(unp.publishedAt).not.toBeNull(); // preserved per data-model

    const archive = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/blog/posts/${id}/archive`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: unp.version }),
    });
    expect(archive.statusCode).toBe(200);
    expect((archive.json() as { data: { status: string } }).data.status).toBe('archived');
  });

  it('PATCH with stale version returns 409 VERSION_CONFLICT', async () => {
    const created = await createPost(`stale-version-${Date.now()}`);
    const id = (created.json() as { data: { id: string } }).data.id;

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/blog/posts/${id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': 'Stale' }, version: 99 }),
    });
    expect(patch.statusCode).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });

  it('refuses a slug that collides with another Post in the same channel (BLOG_SLUG_TAKEN)', async () => {
    const slug = `collision-${Date.now()}`;
    const first = await createPost(slug);
    expect(first.statusCode).toBe(201);
    const second = await createPost(slug);
    expect(second.statusCode).toBe(409);
    expect((second.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_SLUG_TAKEN,
    );
  });
});
