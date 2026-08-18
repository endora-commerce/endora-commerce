import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #200 — a write inside `em.transactional(...)` has to roll back with it.
 *
 * `MegamenuItemService.setTree` is a full overwrite: it deletes the menu's
 * items and re-inserts the payload, and its own doc comment says the rewrite
 * happens "in one transaction". A payload that lists a child before its parent
 * passes normalisation (both ids are present) and is refused by
 * `megamenu_items_parent_fk` at insert time, so the transaction rolls back.
 *
 * The delete used to survive that rollback — every statement ran through
 * `tx.getConnection().execute(sql, params)`, which takes its own pooled
 * connection — and a rejected save wiped the operator's whole menu.
 */
describe('megamenu writes are atomic with their transaction (issue #200)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer({ seed: 'none' });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function countItems(menuId: string): Promise<number> {
    const rows = (await h
      .em()
      .execute(`select count(*)::int as n from megamenu_items where megamenu_id = ?`, [
        menuId,
      ])) as Array<{ n: number }>;
    const [row] = rows;
    // No `?? 0`: a count query that answered nothing is a broken query, not a
    // zero, and the difference is what `check:fixture-substitution` exists for.
    if (!row) throw new Error('count query returned no row');
    return row.n;
  }

  it('keeps the existing tree when the rewrite fails half-way', async () => {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/megamenu/menus',
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({ name: `Atomicity ${Date.now()}` }),
    });
    expect(create.statusCode).toBe(201);
    const menu = (create.json() as { data: { id: string; version: number } }).data;

    const seeded = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        version: menu.version,
        items: [
          {
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Kept' },
            target: { url: 'tel:+48123' },
          },
        ],
      }),
    });
    expect(seeded.statusCode).toBe(200);
    expect(await countItems(menu.id)).toBe(1);
    const version = (seeded.json() as { data: { version: number } }).data.version;

    // A child listed before its parent: normalisation accepts it (both ids are
    // in the payload) and the insert is refused by the parent foreign key.
    const parentId = randomUUID();
    const rejected = await h.app.inject({
      method: 'PUT',
      url: `/api/v1/admin/megamenu/menus/${menu.id}/items`,
      headers: { 'content-type': 'application/json' },
      cookies: adminCookie,
      payload: JSON.stringify({
        version,
        items: [
          {
            id: randomUUID(),
            parentId,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Child first' },
            target: { url: 'tel:+48124' },
          },
          {
            id: parentId,
            parentId: null,
            position: 0,
            kind: 'external-link',
            labels: { 'en-US': 'Parent second' },
            target: { url: 'tel:+48125' },
          },
        ],
      }),
    });

    expect(rejected.statusCode).toBeGreaterThanOrEqual(400);
    expect(await countItems(menu.id)).toBe(1);
  });
});
