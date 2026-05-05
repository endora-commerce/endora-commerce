import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SalesChannel } from '../../../src/modules/sales_channels/entities/sales-channel.entity.js';

describe('admin Megamenu items contract (T022)', () => {
  let h: BackendServerHandle;
  let categoryId: string;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
    // Default channel reconciler runs in setupBackendServer; we don't
    // need its id directly here since none of these tests bind a menu.
    await h.em().findOneOrFail(SalesChannel, { systemDefault: true });

    // Seed a single category so the category-link path resolves.
    categoryId = randomUUID();
    const conn = h.em().getConnection();
    await conn.execute(
      `insert into categories
        (id, parent_category_id, name, slug, sort_order, created_at, updated_at, deleted_at)
       values (?, null, ?::jsonb, ?, 0, now(), now(), null)
       on conflict do nothing`,
      [categoryId, JSON.stringify({ 'en-US': 'Catalog' }), `cat-megamenu-${Date.now()}`],
    );
  });

  afterAll(async () => {
    await h.app.close();
    h.redis.disconnect();
    await h.orm.close(true);
  });

  async function createMenu(): Promise<{ id: string; version: number }> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Menu ${Date.now()}`, description: null }),
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string; version: number } }).data;
  }

  it('saves a 2-level tree of category-link items and returns it ordered', async () => {
    const menu = await createMenu();
    const childAId = randomUUID();
    const childBId = randomUUID();
    const rootAId = randomUUID();

    const put = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            id: rootAId,
            parentId: null,
            position: 0,
            kind: 'category-link',
            labels: { 'en-US': 'Catalog' },
            target: { categoryId },
          },
          {
            id: childAId,
            parentId: rootAId,
            position: 1,
            kind: 'external-link',
            labels: { 'en-US': 'B' },
            target: { url: 'https://example.com/b' },
          },
          {
            id: childBId,
            parentId: rootAId,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'A' },
            target: { url: 'https://example.com/a' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(put.statusCode).toBe(200);

    const fetched = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/megamenu/menus/${menu.id}`,
      cookies: adminCookie,
    });
    const body = fetched.json() as {
      data: { items: Array<{ id: string; parentId: string | null; position: number; labels: Record<string, string> }> };
    };
    expect(body.data.items).toHaveLength(3);

    const root = body.data.items.find((i) => i.parentId === null)!;
    const childA = body.data.items.find((i) => i.id === childAId)!;
    const childB = body.data.items.find((i) => i.id === childBId)!;
    expect(root.id).toBe(rootAId);
    // Server normalises positions to 0..N-1 per parent.
    expect(childB.position).toBe(0);
    expect(childA.position).toBe(1);
  });

  it('refuses an external-link with a javascript: URL', async () => {
    const menu = await createMenu();
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'XSS' },
            target: { url: 'javascript:alert(1)' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a parentId that does not exist anywhere in the payload', async () => {
    const menu = await createMenu();
    const orphanId = randomUUID();
    const missingParent = randomUUID();
    const res = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        items: [
          {
            id: orphanId,
            parentId: missingParent,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Orphan' },
            target: { url: 'https://example.com' },
          },
        ],
        version: menu.version,
      }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED } });
  });
});
