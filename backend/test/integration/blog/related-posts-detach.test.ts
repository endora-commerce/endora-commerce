import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

/**
 * Integration test for the related-posts detach-on-delete contract
 * (T076 / R5 / FR-028). End-to-end through the HTTP layer:
 *
 *   - create three posts A, B, C
 *   - link A → [B, C] via PUT /posts/A/related-posts
 *   - DELETE /posts/B → response carries `detachedFromParents: [A]`
 *   - reload A → `relatedPostIds = [C]` (B detached, C order preserved)
 *   - link D → [B] (B already soft-deleted) — refused by the soft-delete
 *     filter inside `findRow` returning 404 BLOG_POST_NOT_FOUND.
 */
describe('blog related-posts detach-on-delete (T076)', () => {
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

  async function setRelated(
    postId: string,
    relatedIds: string[],
    version: number,
  ): Promise<void> {
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/blog/posts/${postId}/related-posts`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ relatedPostIds: relatedIds, version }),
    });
    expect(res.statusCode).toBe(200);
  }

  it('soft-deleting a related post atomically detaches every parent reference', async () => {
    const a = await createPost(`detach-a-${Date.now()}`);
    const b = await createPost(`detach-b-${Date.now()}`);
    const c = await createPost(`detach-c-${Date.now()}`);

    await setRelated(a.id, [b.id, c.id], a.version);

    // The pre-flight inbound-references probe is the friendly shape the
    // admin UI uses to render the confirmation dialog before commit.
    const probe = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/posts/${b.id}/inbound-references`,
      cookies: adminCookie,
    });
    expect(probe.statusCode).toBe(200);
    expect(
      (probe.json() as { data: { asRelatedPostBy: Array<{ id: string }> } })
        .data.asRelatedPostBy.map((p) => p.id),
    ).toContain(a.id);

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
    ).toEqual([a.id]);

    const reloaded = await getPost(a.id);
    expect(reloaded.relatedPostIds).toEqual([c.id]);
  });

  it('detach happens on every parent post (multi-parent fan-in)', async () => {
    const target = await createPost(`fanin-target-${Date.now()}`);
    const parents = await Promise.all([
      createPost(`fanin-p1-${Date.now()}-1`),
      createPost(`fanin-p2-${Date.now()}-2`),
      createPost(`fanin-p3-${Date.now()}-3`),
    ]);
    for (const p of parents) {
      await setRelated(p.id, [target.id], p.version);
    }

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/posts/${target.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: target.version }),
    });
    expect(del.statusCode).toBe(200);
    const detached = (
      del.json() as { data: { detachedFromParents: string[] } }
    ).data.detachedFromParents.sort();
    expect(detached).toEqual(parents.map((p) => p.id).sort());

    for (const p of parents) {
      const reloaded = await getPost(p.id);
      expect(reloaded.relatedPostIds).toEqual([]);
    }
  });
});
