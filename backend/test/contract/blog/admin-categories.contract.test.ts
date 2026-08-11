import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import { setupBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/kernel/sales-channels/sales-channel.entity.js';

describe('admin Blog Categories CRUD contract (T040)', () => {
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

  async function createCategory(
    slug: string,
    overrides?: Record<string, unknown>,
  ): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': slug },
        slug,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        enabled: true,
        ...overrides,
      }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('creates a top-level category and returns the seeded Default in the tree', async () => {
    const slug = `top-${Date.now()}`;
    const created = await createCategory(slug);
    expect(created.version).toBe(1);

    const tree = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/blog/categories',
      cookies: adminCookie,
    });
    expect(tree.statusCode).toBe(200);
    const data = (tree.json() as {
      tree: Array<{ id: string; isSystem: boolean; slug: string; children: unknown[] }>;
    }).tree;
    expect(data.some((c) => c.isSystem && c.slug === 'default')).toBe(true);
    expect(data.some((c) => c.id === created.id)).toBe(true);
  });

  it('refuses to create a category with zero salesChannelIds', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/categories',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        parentId: null,
        name: { 'en-US': 'X' },
        slug: `no-chan-${Date.now()}`,
        salesChannelIds: [],
        languages: ['en-US'],
        enabled: true,
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH with stale version returns 409 VERSION_CONFLICT', async () => {
    const created = await createCategory(`stale-${Date.now()}`);
    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/blog/categories/${created.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: { 'en-US': 'Stale' }, version: 99 }),
    });
    expect(patch.statusCode).toBe(409);
    expect((patch.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.VERSION_CONFLICT,
    );
  });

  it('refuses delete of a Category with children (BLOG_CATEGORY_HAS_CHILDREN)', async () => {
    const parent = await createCategory(`parent-${Date.now()}`);
    await createCategory(`child-${Date.now()}`, { parentId: parent.id });
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${parent.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: parent.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_HAS_CHILDREN,
    );
  });

  it('refuses delete of a Category referenced by Posts (BLOG_CATEGORY_IN_USE)', async () => {
    const cat = await createCategory(`used-${Date.now()}`);
    const post = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/blog/posts',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        name: { 'en-US': 'X' },
        slug: `using-${Date.now()}`,
        salesChannelIds: [defaultChannelId],
        languages: ['en-US'],
        categoryIds: [cat.id],
      }),
    });
    expect(post.statusCode).toBe(201);

    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${cat.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: cat.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_IN_USE,
    );
  });

  it('refuses delete of the seeded Default (BLOG_CATEGORY_PROTECTED)', async () => {
    const conn = h.em().getConnection();
    const rows = (await conn.execute(
      `select id::text as id, version from blog_categories where is_system = true limit 1`,
    )) as Array<{ id: string; version: number }>;
    const def = rows[0]!;
    const del = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/blog/categories/${def.id}`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ version: def.version }),
    });
    expect(del.statusCode).toBe(409);
    expect((del.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_PROTECTED,
    );
  });

  it('PUT /categories/tree reorders + reparents atomically', async () => {
    const a = await createCategory(`tree-a-${Date.now()}`);
    const b = await createCategory(`tree-b-${Date.now()}`);

    const move = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/blog/categories/tree',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        moves: [
          { id: b.id, parentId: a.id, position: 0 },
        ],
      }),
    });
    expect(move.statusCode).toBe(200);

    const reloaded = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/blog/categories/${b.id}`,
      cookies: adminCookie,
    });
    expect(reloaded.statusCode).toBe(200);
    expect((reloaded.json() as { data: { parentId: string | null } }).data.parentId).toBe(a.id);
  });

  it('refuses a tree move that would create a cycle (BLOG_CATEGORY_CYCLE)', async () => {
    const a = await createCategory(`cycle-a-${Date.now()}`);
    const b = await createCategory(`cycle-b-${Date.now()}`, { parentId: a.id });
    // Now try to make A a child of B → would create A → B → A cycle.
    const cycle = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/blog/categories/tree',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        moves: [{ id: a.id, parentId: b.id, position: 0 }],
      }),
    });
    expect(cycle.statusCode).toBe(422);
    expect((cycle.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.BLOG_CATEGORY_CYCLE,
    );
  });
});
