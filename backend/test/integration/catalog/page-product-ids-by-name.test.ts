import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product, ProductVariant } from '../../helpers/package-entities.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { CatalogProductReadService } from '../../../../packages/modules/catalog/src/backend/services/catalog-product-read.service.js';

/**
 * Feature 161, G15 — `catalogProductReadPort.pageProductIdsByName`: given the
 * ids of the products a price book prices, one page of them ordered by the
 * name in the admin's language, then SKU, then id, optionally narrowed by a
 * name or SKU search (a variant's SKU finds its product), with the total. It is
 * how `price_lists` pages a book's product lines by label without reading the
 * catalogue's table (Principle I): the order and the search are the catalogue's.
 *
 * Structural like the port's other methods: soft-deleted and inactive products
 * answer like any other; ids that name no product are not counted.
 */
describe('CatalogProductReadService.pageProductIdsByName (161 G15)', () => {
  let h: BackendServerHandle;
  let port: CatalogProductReadService;
  const stamp = randomUUID().slice(0, 6).toUpperCase();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    port = new CatalogProductReadService(h.em);
    const em = h.em();
    const make = (key: string, sku: string, name: Record<string, string>, extra: Record<string, unknown> = {}) => {
      const p = em.create(Product, {
        sku: `${sku}-${stamp}`,
        slug: `g15-${key.toLowerCase()}-${stamp.toLowerCase()}`,
        type: 'simple',
        status: 'active',
        name,
        description: { 'en-US': '' },
        visibility: 'public',
        attributeValues: {},
        ...extra,
      });
      ids[key] = p.id;
      return p;
    };
    await em.persistAndFlush([
      make('anchor', 'G15-A', { 'en-US': 'Anchor' }),
      make('bolt2', 'G15-B2', { 'en-US': 'Bolt' }),
      make('bolt1', 'G15-B1', { 'en-US': 'Bolt' }),
      // In Polish it sorts as "Wkręt" (last), in English as "Brick" (fourth).
      make('brick', 'G15-C', { 'pl-PL': 'Wkręt', 'en-US': 'Brick' }),
      make('dowel', 'G15-D', { de: 'Dübel' }),
      make('empty', 'G15-E', {}),
      make('gone', 'G15-F', { 'en-US': 'Fastener' }, { deletedAt: new Date(), status: 'draft' }),
    ]);
    const variant = em.create(ProductVariant, { parentProductId: ids['anchor']!, sku: `G15-AV-${stamp}`, variantAttributeValues: {} });
    await em.persistAndFlush(variant);
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const all = () => Object.values(ids);

  it('orders by the English name, then SKU; a name in another language and no name fall back', async () => {
    const page = await port.pageProductIdsByName({ ids: [...all(), randomUUID()], language: 'en', offset: 0, limit: 50 });
    expect(page.total).toBe(7);
    // Anchor, Bolt (B1), Bolt (B2), Brick, Dübel (only name), Fastener (soft-deleted, still listed), then the
    // product with no name at all, labelled by its SKU.
    expect(page.ids).toEqual([ids['anchor'], ids['bolt1'], ids['bolt2'], ids['brick'], ids['dowel'], ids['gone'], ids['empty']]);
  });

  it('orders by the name in the asked language when the product has one', async () => {
    const page = await port.pageProductIdsByName({ ids: all(), language: 'pl', offset: 0, limit: 50 });
    // `pl` matches the `pl-PL` name by its language; the others fall back to English, then any name, then the SKU.
    expect(page.ids).toEqual([ids['anchor'], ids['bolt1'], ids['bolt2'], ids['dowel'], ids['gone'], ids['empty'], ids['brick']]);
  });

  it('pages by offset and limit, the total unchanged', async () => {
    const first = await port.pageProductIdsByName({ ids: all(), language: 'en', offset: 0, limit: 3 });
    const second = await port.pageProductIdsByName({ ids: all(), language: 'en', offset: 3, limit: 3 });
    const third = await port.pageProductIdsByName({ ids: all(), language: 'en', offset: 6, limit: 3 });
    expect(first.total).toBe(7);
    expect(second.total).toBe(7);
    expect([...first.ids, ...second.ids, ...third.ids]).toEqual(
      (await port.pageProductIdsByName({ ids: all(), language: 'en', offset: 0, limit: 50 })).ids,
    );
    expect(third.ids.length).toBe(1);
  });

  it('searches the name, the SKU and a variant’s SKU, case-insensitively', async () => {
    const byName = await port.pageProductIdsByName({ ids: all(), search: 'bolt', language: 'en', offset: 0, limit: 50 });
    expect(byName).toEqual({ ids: [ids['bolt1'], ids['bolt2']], total: 2 });
    const bySku = await port.pageProductIdsByName({ ids: all(), search: `g15-c-${stamp}`, language: 'en', offset: 0, limit: 50 });
    expect(bySku.ids).toEqual([ids['brick']]);
    const byVariantSku = await port.pageProductIdsByName({ ids: all(), search: `G15-AV`, language: 'en', offset: 0, limit: 50 });
    expect(byVariantSku.ids).toEqual([ids['anchor']]);
    const literal = await port.pageProductIdsByName({ ids: all(), search: '%', language: 'en', offset: 0, limit: 50 });
    expect(literal.total).toBe(0);
  });

  it('answers nothing for no ids, without a query', async () => {
    expect(await port.pageProductIdsByName({ ids: [], language: 'en', offset: 0, limit: 50 })).toEqual({ ids: [], total: 0 });
  });
});
