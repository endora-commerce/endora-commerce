import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Feature 172 (C2/C3 code review 1, `product-global-field-rules.ts`) — the product `PATCH` holds
 * the same existence rules as the scoped save for the Global-only fields it carries: an attribute
 * set or a category that does not exist (or is deleted) is a `400 VALIDATION_FAILED` naming what
 * is missing, and nothing on the product changes. Before, both reached the database's foreign key
 * and answered 500.
 */
describe('172 — PATCH /products/:id checks attribute set and categories exist [contract]', () => {
  let h: BackendServerHandle;
  const cookies = { b2b_session: 'stub-admin-session' };
  const run = randomUUID().slice(0, 8);
  let n = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    if (h) await teardownBackendServer(h);
  });

  async function product(): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      cookies,
      payload: {
        sku: `P170-PATCH-${run}-${n++}`,
        type: 'simple',
        name: 'Patch rules',
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  const patch = (id: string, payload: object) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/products/${id}`, cookies, payload });

  const attributeSetOf = async (id: string) =>
    (
      await h.em().getConnection().execute<Array<{ attribute_set_id: string }>>(
        `select attribute_set_id from products where id = ?`,
        [id],
      )
    )[0]!.attribute_set_id;

  it('refuses an attribute set that does not exist, and keeps the current one', async () => {
    const id = await product();
    const before = await attributeSetOf(id);
    const missing = randomUUID();
    const res = await patch(id, { attributeSetId: missing, name: 'Changed' });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(res.body).toContain('unknown_attribute_set');
    expect(await attributeSetOf(id)).toBe(before);
  });

  it('refuses a category that does not exist, naming it, and writes no membership', async () => {
    const id = await product();
    const missing = randomUUID();
    const res = await patch(id, { categoryIds: [missing] });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(res.body).toContain(`unknown_category_ids: ${missing}`);
    const rows = await h.em().getConnection().execute(`select 1 from product_categories where product_id = ?`, [id]);
    expect(rows).toHaveLength(0);
  });

  it('refuses a deleted category', async () => {
    const id = await product();
    const category = randomUUID();
    await h
      .em()
      .getConnection()
      .execute(
        `insert into categories (id, parent_category_id, name, slug, sort_order, created_at, updated_at, deleted_at)
         values (?, null, '{"en-US":"Gone"}'::jsonb, ?, 0, now(), now(), now())`,
        [category, `p170-gone-${run}`],
      );
    const res = await patch(id, { categoryIds: [category] });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).toContain(`unknown_category_ids: ${category}`);
  });
});
