import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';

/**
 * Default shopping list — every customer always has exactly one default:
 *   - GET /shopping-lists/default lazily creates a "Default" list;
 *   - the first explicitly-created list is flagged default;
 *   - POST /shopping-lists/default/items targets the default and reports the
 *     running item count;
 *   - POST /shopping-lists/:id/set-default moves the flag (clearing the rest).
 */
describe('Default shopping list', () => {
  let h: BackendServerHandle;
  const cookies = { b2b_session: 'stub-customer-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('lazily provisions a Default list and adds items to it', async () => {
    const def = await h.app.inject({
      method: 'GET',
      url: '/api/v1/shopping-lists/default',
      cookies,
    });
    expect(def.statusCode).toBe(200);
    const summary = (def.json() as { data: { id: string; name: string; itemCount: number } }).data;
    expect(summary.name).toBe('Default');
    expect(summary.itemCount).toBe(0);

    const add = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists/default/items',
      cookies,
      payload: { productId: SEED_PRODUCT_101_ID, quantity: 3 },
    });
    expect(add.statusCode).toBe(201);
    const added = (add.json() as { data: { id: string; itemCount: number } }).data;
    expect(added.id).toBe(summary.id);
    expect(added.itemCount).toBe(1);
  });

  it('moves the default flag with set-default', async () => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies,
      payload: { name: 'Second list' },
    });
    const second = (created.json() as { data: { id: string; isDefault: boolean } }).data;
    expect(second.isDefault).toBe(false);

    const setDef = await h.app.inject({
      method: 'POST',
      url: `/api/v1/shopping-lists/${second.id}/set-default`,
      cookies,
    });
    expect(setDef.statusCode).toBe(200);
    expect((setDef.json() as { data: { isDefault: boolean } }).data.isDefault).toBe(true);

    const all = await h.app.inject({ method: 'GET', url: '/api/v1/shopping-lists', cookies });
    const lists = (all.json() as { data: Array<{ id: string; isDefault: boolean }> }).data;
    const defaults = lists.filter((l) => l.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.id);
  });
});
