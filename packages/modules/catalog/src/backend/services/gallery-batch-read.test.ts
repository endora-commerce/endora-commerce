import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReadPort } from '@endora-commerce/contracts';
import { GalleryService } from './gallery.service.js';

/**
 * Feature 075 / D-87 — the batch gallery read `catalog` owes the two modules
 * that were reading its tables directly.
 *
 * `product_feeds` ran `select product_id, asset_id, position from gallery_items
 * where product_id in (…)` over a whole hydration batch, and `comparisons` ran
 * a three-table join through `gallery_item_labels` into `assets_library`'s
 * `assets`. Neither statement names an import specifier, so both compiled and
 * returned rows across a boundary nothing could gate.
 *
 * `list(productId)` is not the replacement, and the cost is the point of the
 * last case rather than something asserted in prose: it verifies the product
 * exists and then runs two more queries, so the batch a feed run walks costs
 * three round-trips per product.
 */

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const ASSET_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ASSET_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CHANNEL = '44444444-4444-4444-8444-444444444444';

interface Recorded {
  readonly statements: string[];
  readonly entityReads: string[];
  readonly params?: unknown[][];
}

function roundTrips(recorded: Recorded): number {
  return recorded.statements.length + recorded.entityReads.length;
}

/**
 * An `EntityManager` that answers `execute` from `rowsFor` and records every
 * statement and every entity read, so a case can count round-trips.
 *
 * It refuses a statement naming `assets` — that table belongs to
 * `assets_library`, and the whole reason `baseImageUrls` lives on this side of
 * the boundary is that `catalog` answers it from its own two tables plus the
 * asset read port it already holds.
 *
 * The entity reads answer with one row each, so `list`'s three-query shape is
 * measured as it actually runs rather than short-circuited on an empty gallery.
 */
function fakeEm(recorded: Recorded, rowsFor: (sql: string) => unknown[]): () => EntityManager {
  const em = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (/\bassets\b/i.test(sql)) {
        throw new Error(`catalog must not join assets_library's table: ${sql}`);
      }
      recorded.statements.push(sql);
      recorded.params?.push(params);
      return rowsFor(sql);
    },
    find: async (entity: { name?: string }) => {
      const name = entity.name ?? '(anonymous)';
      recorded.entityReads.push(name);
      return name === 'GalleryItem'
        ? [
            {
              id: 'item-1',
              productId: PRODUCT_A,
              assetId: ASSET_A,
              position: 0,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ]
        : [{ galleryItemId: 'item-1', productId: PRODUCT_A, label: 'base_image' }];
    },
    findOne: async (entity: { name?: string }) => {
      const name = entity.name ?? '(anonymous)';
      recorded.entityReads.push(name);
      return name === 'Product' ? { id: PRODUCT_A } : null;
    },
  };
  return () => em as unknown as EntityManager;
}

function assetPort(urls: Record<string, string>): AssetReadPort {
  return {
    findById: async () => null,
    findByIds: async (ids: readonly string[]) =>
      ids
        .filter((id) => urls[id] !== undefined)
        .map((id) => ({ id, storageUrl: urls[id]!, kind: 'image' })),
  } as unknown as AssetReadPort;
}

describe('catalog — listForProducts', () => {
  it('answers a whole batch in one statement, ordered by product then position', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(
      fakeEm(recorded, () => [
        { product_id: PRODUCT_A, asset_id: ASSET_A, position: 0 },
        { product_id: PRODUCT_A, asset_id: ASSET_B, position: 1 },
        { product_id: PRODUCT_B, asset_id: ASSET_B, position: 0 },
      ]),
      undefined,
      assetPort({}),
    );

    const items = await service.listForProducts([PRODUCT_A, PRODUCT_B, GONE], null);

    expect(roundTrips(recorded)).toBe(1);
    expect(recorded.statements[0]).toMatch(/order by\s+gi\.product_id,\s*gi\.position asc/i);
    expect(items).toEqual([
      { productId: PRODUCT_A, assetId: ASSET_A, position: 0 },
      { productId: PRODUCT_A, assetId: ASSET_B, position: 1 },
      { productId: PRODUCT_B, assetId: ASSET_B, position: 0 },
    ]);
  });

  it('does not assert that a product exists — an id that resolves to nothing yields no rows', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(fakeEm(recorded, () => []), undefined, assetPort({}));

    await expect(service.listForProducts([GONE], null)).resolves.toEqual([]);
    // `list` reaches for `Product` first; the batch read must not.
    expect(recorded.entityReads).toEqual([]);
  });

  it('reads nothing at all for an empty batch', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(fakeEm(recorded, () => []), undefined, assetPort({}));

    await expect(service.listForProducts([], null)).resolves.toEqual([]);
    expect(roundTrips(recorded)).toBe(0);
  });
});

describe('catalog — baseImageUrls', () => {
  it('resolves the base image through the asset port, never through a join on `assets`', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(
      fakeEm(recorded, () => [{ product_id: PRODUCT_A, asset_id: ASSET_A }]),
      undefined,
      assetPort({ [ASSET_A]: 'https://cdn.test/a.png' }),
    );

    const urls = await service.baseImageUrls([PRODUCT_A, PRODUCT_B], null);

    expect(recorded.statements).toHaveLength(1);
    expect(recorded.statements[0]).toMatch(/gallery_item_labels/i);
    expect(recorded.statements[0]).toMatch(/'base_image'/);
    expect([...urls]).toEqual([
      [PRODUCT_A, 'https://cdn.test/a.png'],
      [PRODUCT_B, null],
    ]);
  });

  it('holds one entry per requested id, null for a product that is gone', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(fakeEm(recorded, () => []), undefined, assetPort({}));

    const urls = await service.baseImageUrls([GONE, PRODUCT_A], null);

    expect([...urls.keys()]).toEqual([GONE, PRODUCT_A]);
    expect(urls.get(GONE)).toBeNull();
    expect(urls.get(PRODUCT_A)).toBeNull();
  });

  it('answers null when the label stands but the asset row no longer resolves', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(
      fakeEm(recorded, () => [{ product_id: PRODUCT_A, asset_id: ASSET_A }]),
      undefined,
      assetPort({}),
    );

    await expect(service.baseImageUrls([PRODUCT_A], null)).resolves.toEqual(
      new Map([[PRODUCT_A, null]]),
    );
  });

  it('takes no `thumbnail` fallback — spec FR-006 names the base image only', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const service = new GalleryService(
      fakeEm(recorded, () => []),
      undefined,
      assetPort({ [ASSET_A]: 'https://cdn.test/a.png' }),
    );

    // The statement filters on `label = 'base_image'`, so a product whose only
    // label is `thumbnail` contributes no row and reads as "no base image".
    await expect(service.baseImageUrls([PRODUCT_A], null)).resolves.toEqual(
      new Map([[PRODUCT_A, null]]),
    );
    expect(recorded.statements[0]).not.toMatch(/thumbnail/i);
  });

  it('asks the asset port once for the whole batch', async () => {
    const recorded: Recorded = { statements: [], entityReads: [] };
    const batches: string[][] = [];
    const service = new GalleryService(
      fakeEm(recorded, () => [
        { product_id: PRODUCT_A, asset_id: ASSET_A },
        { product_id: PRODUCT_B, asset_id: ASSET_B },
      ]),
      undefined,
      {
        findById: async () => null,
        findByIds: async (ids: readonly string[]) => {
          batches.push([...ids]);
          return ids.map((id) => ({ id, storageUrl: `https://cdn.test/${id}.png`, kind: 'image' }));
        },
      } as unknown as AssetReadPort,
    );

    await service.baseImageUrls([PRODUCT_A, PRODUCT_B], null);

    expect(batches).toEqual([[ASSET_A, ASSET_B]]);
  });
});

describe('catalog — the round-trip cost the batch read exists to remove', () => {
  it('costs one round-trip for 500 products where `list` costs 1500', async () => {
    const ids = Array.from({ length: 500 }, (_, i) => `product-${i}`);

    const batch: Recorded = { statements: [], entityReads: [] };
    await new GalleryService(fakeEm(batch, () => []), undefined, assetPort({})).listForProducts(
      ids,
      CHANNEL,
    );

    const perProduct: Recorded = { statements: [], entityReads: [] };
    const oneByOne = new GalleryService(fakeEm(perProduct, () => []), undefined, assetPort({}));
    for (const id of ids) await oneByOne.list(id);

    expect(roundTrips(batch)).toBe(1);
    // `#assertProductExists` + `find(GalleryItem)` + `find(GalleryItemLabel)` (feature 174: the
    // item's hidden flag is a column of the item now, no per-item channel read).
    expect(roundTrips(perProduct)).toBe(1500);
  });
});

/**
 * Feature 163 (FR-076, owner decision MED-1 = A) — an image hidden in a channel reaches
 * neither a feed of that channel (`listForProducts`) nor a comparison seen in it
 * (`baseImageUrls`). Still one statement per batch; the hidden set and the channel's
 * role holders are joined in it rather than read per product.
 */
describe('catalog — the batch reads in a channel', () => {
  it('listForProducts leaves out the items hidden in the channel, in the same one statement', async () => {
    const recorded: Recorded = { statements: [], entityReads: [], params: [] };
    const service = new GalleryService(fakeEm(recorded, () => []), undefined, assetPort({}));

    await service.listForProducts([PRODUCT_A], CHANNEL, 'pl-PL');

    expect(roundTrips(recorded)).toBe(1);
    // Feature 174 — the C×L → C → Global chain of `hidden` (`data-model.md` §6a).
    expect(recorded.statements[0]).toMatch(/gallery_item_scope_overrides[\s\S]*'hidden'[\s\S]*gi\.hidden/i);
    expect(recorded.params?.[0]).toContain(CHANNEL);
    expect(recorded.params?.[0]).toContain('pl-PL');
  });

  it('listForProducts naming no channel reads only the Global hidden flag (the global gallery)', async () => {
    const recorded: Recorded = { statements: [], entityReads: [], params: [] };
    const service = new GalleryService(fakeEm(recorded, () => []), undefined, assetPort({}));

    await service.listForProducts([PRODUCT_A], null);

    expect(recorded.statements[0]).not.toMatch(/gallery_item_scope_overrides/i);
    expect(recorded.statements[0]).toMatch(/gi\.hidden/i);
  });

  it('baseImageUrls takes the scoped holder of the role (C×L → C → Global), and none when it is hidden', async () => {
    const recorded: Recorded = { statements: [], entityReads: [], params: [] };
    const service = new GalleryService(
      fakeEm(recorded, () => [{ product_id: PRODUCT_A, asset_id: ASSET_B }]),
      undefined,
      assetPort({ [ASSET_B]: 'https://cdn.test/b.png' }),
    );

    const urls = await service.baseImageUrls([PRODUCT_A, PRODUCT_B], CHANNEL);

    expect(recorded.statements).toHaveLength(1);
    const sql = recorded.statements[0]!;
    expect(sql).toMatch(/gallery_role_scope_overrides/i);
    expect(sql).toMatch(/gallery_item_labels/i);
    expect(sql).toMatch(/gallery_item_scope_overrides[\s\S]*'hidden'/i);
    expect(sql).not.toMatch(/thumbnail/i);
    expect(recorded.params?.[0]).toContain(CHANNEL);
    expect([...urls]).toEqual([
      [PRODUCT_A, 'https://cdn.test/b.png'],
      [PRODUCT_B, null],
    ]);
  });
});
