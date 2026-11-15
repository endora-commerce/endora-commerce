import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { shoppingListSchema } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID, SEED_PRODUCT_102_ID } from '../../helpers/seed-catalog.js';
import { deepStrict, disagreements } from '../../helpers/strict-schema.js';

/**
 * Issue #1251 — one *Save changes* for a list's name and every line quantity:
 * `PATCH /api/v1/shopping-lists/:id` takes `{ name?, items?: [{ id, quantity }] }`
 * and writes all of it or nothing. A line that is not on the list refuses the
 * whole write, so a half-applied save cannot happen. Every row this file writes
 * is a list it created itself.
 */
const strictList = deepStrict(shoppingListSchema);
const COOKIE = { b2b_session: 'stub-customer-session' };

interface ListView {
  id: string;
  name: string;
  items: Array<{ id: string; productId: string; quantity: number }>;
}

describe('shopping lists — one save for the name and the quantities (issue #1251)', () => {
  let h: BackendServerHandle;
  const created: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `/api/v1/shopping-lists/${id}`, cookies: COOKIE });
    }
    await teardownBackendServer(h);
  });

  async function listWithTwoLines(): Promise<ListView> {
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/v1/shopping-lists',
      cookies: COOKIE,
      payload: { name: `One save ${Date.now()} ${Math.random().toString(36).slice(2, 6)}` },
    });
    expect(create.statusCode, create.body).toBe(201);
    const id = (create.json() as { data: ListView }).data.id;
    created.push(id);
    let view: ListView | undefined;
    for (const [productId, quantity] of [
      [SEED_PRODUCT_101_ID, 2],
      [SEED_PRODUCT_102_ID, 5],
    ] as const) {
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/shopping-lists/${id}/items`,
        cookies: COOKIE,
        payload: { productId, quantity },
      });
      expect(res.statusCode, res.body).toBe(201);
      view = (res.json() as { data: ListView }).data;
    }
    return view!;
  }

  const save = (listId: string, payload: Record<string, unknown>) =>
    h.app.inject({ method: 'PATCH', url: `/api/v1/shopping-lists/${listId}`, cookies: COOKIE, payload });

  const read = async (listId: string): Promise<ListView> => {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/shopping-lists/${listId}`, cookies: COOKIE });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: ListView }).data;
  };

  const quantities = (view: ListView): Record<string, number> =>
    Object.fromEntries(view.items.map((item) => [item.productId, item.quantity]));

  it('writes the name and several quantities in one request', async () => {
    const list = await listWithTwoLines();
    const [first, second] = list.items;
    const res = await save(list.id, {
      name: 'Site B',
      items: [
        { id: first!.id, quantity: 7 },
        { id: second!.id, quantity: 11 },
      ],
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as { data: ListView }).data;
    expect(disagreements(strictList, data)).toEqual([]);
    expect(data.name).toBe('Site B');
    expect(quantities(data)).toEqual({ [first!.productId]: 7, [second!.productId]: 11 });
    const stored = await read(list.id);
    expect(stored.name).toBe('Site B');
    expect(quantities(stored)).toEqual({ [first!.productId]: 7, [second!.productId]: 11 });
  });

  it('writes the quantities alone and leaves the name', async () => {
    const list = await listWithTwoLines();
    const res = await save(list.id, { items: [{ id: list.items[1]!.id, quantity: 9 }] });
    expect(res.statusCode, res.body).toBe(200);
    const stored = await read(list.id);
    expect(stored.name).toBe(list.name);
    expect(quantities(stored)).toEqual({ [SEED_PRODUCT_101_ID]: 2, [SEED_PRODUCT_102_ID]: 9 });
  });

  it('still renames with a name alone', async () => {
    const list = await listWithTwoLines();
    const res = await save(list.id, { name: 'Renamed only' });
    expect(res.statusCode, res.body).toBe(200);
    expect((await read(list.id)).name).toBe('Renamed only');
  });

  it('writes nothing when one line is not on the list', async () => {
    const list = await listWithTwoLines();
    const other = await listWithTwoLines();
    const res = await save(list.id, {
      name: 'Never stored',
      items: [
        { id: list.items[0]!.id, quantity: 40 },
        { id: other.items[0]!.id, quantity: 41 },
      ],
    });
    expect(res.statusCode, res.body).toBe(404);
    const stored = await read(list.id);
    expect(stored.name).toBe(list.name);
    expect(quantities(stored)).toEqual({ [SEED_PRODUCT_101_ID]: 2, [SEED_PRODUCT_102_ID]: 5 });
    expect(quantities(await read(other.id))).toEqual({ [SEED_PRODUCT_101_ID]: 2, [SEED_PRODUCT_102_ID]: 5 });
  });

  it.each([
    ['an empty body', {}],
    ['a line twice', 'twice'],
  ])('refuses %s with 400', async (_label, body) => {
    const list = await listWithTwoLines();
    const payload =
      body === 'twice'
        ? { items: [{ id: list.items[0]!.id, quantity: 3 }, { id: list.items[0]!.id, quantity: 4 }] }
        : (body as Record<string, unknown>);
    const res = await save(list.id, payload);
    expect(res.statusCode, res.body).toBe(400);
    expect(quantities(await read(list.id))).toEqual({ [SEED_PRODUCT_101_ID]: 2, [SEED_PRODUCT_102_ID]: 5 });
  });
});
