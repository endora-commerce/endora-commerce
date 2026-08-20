import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('admin Blog Post inbound-references probe (T032)', () => {
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
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('returns the parent posts that reference :id as a Related Post', async () => {
    const a = await createDraft(`inbound-a-${Date.now()}`);
    const b = await createDraft(`inbound-b-${Date.now()}`);

    // a → b
    const setRel = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [b.id], version: a.version }),
    });
    expect(setRel.statusCode).toBe(200);

    const probe = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${b.id}/inbound-references`,
      cookies: adminCookie,
    });
    expect(probe.statusCode).toBe(200);
    const data = (probe.json() as {
      data: { asRelatedPostBy: Array<{ id: string }> };
    }).data;
    const ids = data.asRelatedPostBy.map((r) => r.id);
    expect(ids).toContain(a.id);
  });

  it('soft-deleting a post atomically detaches every inbound related-post reference', async () => {
    const a = await createDraft(`detach-a-${Date.now()}`);
    const b = await createDraft(`detach-b-${Date.now()}`);

    await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${a.id}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: [b.id], version: a.version }),
    });

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/posts/${b.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: b.version }),
    });
    expect(del.statusCode).toBe(200);
    expect(
      (del.json() as { data: { detachedFromParents: string[] } }).data.detachedFromParents,
    ).toContain(a.id);

    // a's relatedPostIds is now empty.
    const reloaded = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${a.id}`,
      cookies: adminCookie,
    });
    expect(reloaded.statusCode).toBe(200);
    expect(
      (reloaded.json() as { data: { relatedPostIds: string[] } }).data.relatedPostIds,
    ).toEqual([]);
  });
});
