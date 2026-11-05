import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogProductReadPort } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';

/**
 * Issue #416, review of #424 — the price surface's worker reads the catalogue
 * at the start of every whole build, so that read has to be cheap and fresh.
 * `listAll` hydrated 50 000 `Product` entities to use two fields (3.8 s a read
 * on the SC-005 fixture). `listPricingRefs` and `findPricingRefsByIds` are the
 * projection pricing resolves on — the id and the attribute values — answered
 * by `catalog` from its own table, and they answer for exactly the products
 * `listAll` and `findByIds` answer for: soft-deleted and inactive included.
 */
describe('catalogProductReadPort — the pricing projection', () => {
  let h: BackendServerHandle;
  let port: CatalogProductReadPort;
  const stamp = randomUUID().slice(0, 8);
  const ids: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    port = (h.container as unknown as { resolve<T>(n: string): T }).resolve<CatalogProductReadPort>('catalogProductReadPort');
    const sql = (statement: string, params: unknown[] = []) => h.em().getConnection().execute(statement, params);
    for (const [n, status, deleted, values] of [
      [1, 'active', false, { color: 'red', size: 3 }],
      [2, 'inactive', false, { color: 'blue' }],
      [3, 'active', true, {}],
      [4, 'active', false, { tags: ['a', 'b'], flag: true }],
    ] as const) {
      const id = randomUUID();
      ids.push(id);
      await sql(
        `insert into "products" ("id", "sku", "slug", "type", "status", "name", "description", "visibility", "attribute_values", "deleted_at", "created_at", "updated_at")
         values (?, ?, ?, 'simple', ?, 'x', 'x', 'public', ?::jsonb, ?, now(), now())`,
        [id, `PREF-${stamp}-${n}`, `pref-${stamp}-${n}`, status, JSON.stringify(values), deleted ? new Date() : null],
      );
    }
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('listPricingRefs answers every product listAll answers, with the same attribute values', async () => {
    const all = await port.listAll();
    const refs = await port.listPricingRefs();
    expect(refs.map((r) => r.id).sort()).toEqual(all.map((p) => p.id).sort());
    const byId = new Map(all.map((p) => [p.id, p.attributeValues]));
    for (const ref of refs) expect(ref.attributeValues, ref.id).toEqual(byId.get(ref.id));
    for (const id of ids) expect(refs.some((r) => r.id === id), id).toBe(true);
  });

  it('findPricingRefsByIds answers the products that exist, as findByIds does', async () => {
    const asked = [...ids, randomUUID()];
    const refs = await port.findPricingRefsByIds(asked);
    const found = await port.findByIds(asked);
    expect(refs.map((r) => r.id).sort()).toEqual(found.map((p) => p.id).sort());
    expect(refs.find((r) => r.id === ids[3])?.attributeValues).toEqual({ tags: ['a', 'b'], flag: true });
    expect(await port.findPricingRefsByIds([])).toEqual([]);
  });

  it('findPricingRefsByIds takes a set larger than a statement can bind one parameter per id (a candidate set of 70 000)', async () => {
    const asked = [...Array.from({ length: 70_000 }, () => randomUUID()), ...ids];
    const refs = await port.findPricingRefsByIds(asked);
    expect(refs.map((r) => r.id).sort()).toEqual([...ids].sort());
  }, 60_000);
});
