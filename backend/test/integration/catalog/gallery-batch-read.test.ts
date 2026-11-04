import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogGalleryPort } from '@endora-commerce/contracts';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Feature 075 / D-87 — the batch gallery read, against the real schema.
 *
 * `test/unit/catalog/gallery-batch-read.test.ts` measures the round-trip cost
 * and the absent-id semantics over a fake `EntityManager`, which cannot see a
 * column that is not there: `gallery_item_labels` carries its own denormalised
 * `product_id`, and both statements lean on it. So the two methods are also
 * exercised over rows this file creates, through the container registration the
 * consumers resolve (`galleryService`) rather than through a hand-built
 * instance.
 */

describe('catalog — the batch gallery read over the real schema', () => {
  let h: BackendServerHandle;
  let gallery: CatalogGalleryPort;

  beforeAll(async () => {
    h = await setupBackendServer();
    gallery = (h.container.cradle as unknown as { galleryService: CatalogGalleryPort })
      .galleryService;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const adminCookie = { b2b_session: 'stub-admin-session' };

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `GAL-BATCH-${suffix}`,
        type: 'simple',
        name: `Gallery batch ${suffix}`,
        description: 'desc',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: { id: string } }).data.id;
  }

  async function seedAsset(url: string): Promise<string> {
    const id = randomUUID();
    await h.orm.em.getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'test.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [id, url],
    );
    return id;
  }

  async function attach(productId: string, assetId: string, labels: string[]): Promise<void> {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${productId}/gallery`,
      payload: { assetId, labels },
      cookies: adminCookie,
    });
    expect(res.statusCode).toBe(201);
  }

  it('returns every product’s items in position order, and none for an id that is gone', async () => {
    const first = await createProduct('ORDER-1');
    const second = await createProduct('ORDER-2');
    const assetA = await seedAsset('https://cdn.test/batch-a.jpg');
    const assetB = await seedAsset('https://cdn.test/batch-b.jpg');
    const assetC = await seedAsset('https://cdn.test/batch-c.jpg');
    await attach(first, assetA, []);
    await attach(first, assetB, []);
    await attach(second, assetC, []);

    const gone = randomUUID();
    const items = await gallery.listForProducts([first, second, gone], null);

    expect(items.filter((i) => i.productId === first).map((i) => i.assetId)).toEqual([
      assetA,
      assetB,
    ]);
    expect(items.filter((i) => i.productId === first).map((i) => i.position)).toEqual([0, 1]);
    expect(items.filter((i) => i.productId === second).map((i) => i.assetId)).toEqual([assetC]);
    expect(items.some((i) => i.productId === gone)).toBe(false);
  });

  it('resolves the base image of each product, and null where there is none', async () => {
    const withBase = await createProduct('BASE');
    const withThumbOnly = await createProduct('THUMB-ONLY');
    const withoutGallery = await createProduct('NO-GALLERY');
    const baseAsset = await seedAsset('https://cdn.test/batch-base.jpg');
    const thumbAsset = await seedAsset('https://cdn.test/batch-thumb.jpg');
    await attach(withBase, baseAsset, ['base_image']);
    await attach(withThumbOnly, thumbAsset, ['thumbnail']);

    const gone = randomUUID();
    const urls = await gallery.baseImageUrls([withBase, withThumbOnly, withoutGallery, gone], null);

    // One entry per requested id, so a caller may index without re-checking.
    expect([...urls.keys()].sort()).toEqual(
      [withBase, withThumbOnly, withoutGallery, gone].sort(),
    );
    expect(urls.get(withBase)).toBe('https://cdn.test/batch-base.jpg');
    // No fallback to `thumbnail` (spec FR-006 names the base image only).
    expect(urls.get(withThumbOnly)).toBeNull();
    expect(urls.get(withoutGallery)).toBeNull();
    expect(urls.get(gone)).toBeNull();
  });

  /**
   * Feature 163 (FR-076, owner decision MED-1 = A), on feature 172's three levels
   * (`data-model.md` §6) — at (C, L) an item is left out when its effective `hidden`
   * (C×L → C → Global) is true; the base image is the effective holder of the role
   * (C×L → C → Global, an override with no item = no image holds it), and none when
   * that holder is effectively hidden there. `languageCode` omitted = the Channel level.
   */
  it('in a channel: hidden items are left out and the scoped holder of the base image wins', async () => {
    const product = await createProduct('CHANNEL');
    const globalBase = await seedAsset('https://cdn.test/batch-channel-global.jpg');
    const channelBase = await seedAsset('https://cdn.test/batch-channel-own.jpg');
    const extra = await seedAsset('https://cdn.test/batch-channel-extra.jpg');
    await attach(product, globalBase, ['base_image']);
    await attach(product, channelBase, []);
    await attach(product, extra, []);
    const conn = h.orm.em.getConnection();
    const [channel] = (await conn.execute(`select id::text as id from sales_channels order by created_at limit 1`)) as Array<{
      id: string;
    }>;
    const items = (await conn.execute(
      `select id::text as id, asset_id::text as asset_id from gallery_items where product_id = ? order by position`,
      [product],
    )) as Array<{ id: string; asset_id: string }>;
    const globalItem = items.find((i) => i.asset_id === globalBase)!.id;
    const channelItem = items.find((i) => i.asset_id === channelBase)!.id;
    const extraItem = items.find((i) => i.asset_id === extra)!.id;
    const role = (languageCode: string | null, itemId: string | null) =>
      conn.execute(
        `insert into gallery_role_scope_overrides (id, product_id, sales_channel_id, language_code, label, gallery_item_id)
         values (?, ?, ?, ?, 'base_image', ?)`,
        [randomUUID(), product, channel!.id, languageCode, itemId],
      );
    const hide = (itemId: string, languageCode: string | null, hidden: boolean) =>
      conn.execute(
        `insert into gallery_item_scope_overrides (id, gallery_item_id, product_id, sales_channel_id, language_code, field, value)
         values (?, ?, ?, ?, ?, 'hidden', ?::jsonb)`,
        [randomUUID(), itemId, product, channel!.id, languageCode, JSON.stringify({ v: hidden })],
      );

    // The channel's own base image: the second item; at C×L en-US the third.
    await role(null, channelItem);
    await role('en-US', extraItem);
    expect((await gallery.baseImageUrls([product], channel!.id)).get(product)).toBe('https://cdn.test/batch-channel-own.jpg');
    expect((await gallery.baseImageUrls([product], channel!.id, 'pl-PL')).get(product)).toBe(
      'https://cdn.test/batch-channel-own.jpg',
    );
    expect((await gallery.baseImageUrls([product], channel!.id, 'EN-us')).get(product)).toBe(
      'https://cdn.test/batch-channel-extra.jpg',
    );
    expect((await gallery.baseImageUrls([product], null)).get(product)).toBe('https://cdn.test/batch-channel-global.jpg');

    // Hide the channel holder at C: no base image at the Channel level, the feed loses it there.
    await hide(channelItem, null, true);
    expect((await gallery.baseImageUrls([product], channel!.id)).get(product)).toBeNull();
    expect((await gallery.listForProducts([product], channel!.id)).map((i) => i.assetId)).toEqual([globalBase, extra]);
    // …but shown again at C×L pl-PL by an own `false` there.
    await hide(channelItem, 'pl-PL', false);
    expect((await gallery.listForProducts([product], channel!.id, 'pl-PL')).map((i) => i.assetId)).toEqual([
      globalBase,
      channelBase,
      extra,
    ]);
    expect((await gallery.baseImageUrls([product], channel!.id, 'pl-PL')).get(product)).toBe(
      'https://cdn.test/batch-channel-own.jpg',
    );

    // An empty role override at C×L: no image holds the role there.
    await conn.execute(
      `update gallery_role_scope_overrides set gallery_item_id = null where product_id = ? and language_code = 'en-US'`,
      [product],
    );
    expect((await gallery.baseImageUrls([product], channel!.id, 'en-US')).get(product)).toBeNull();

    // Hidden at Global: left out everywhere no override shows it, the global answer included.
    await conn.execute(`update gallery_items set hidden = true where id = ?`, [extraItem]);
    expect((await gallery.listForProducts([product], null)).map((i) => i.assetId)).toEqual([globalBase, channelBase]);
    expect((await gallery.listForProducts([product], channel!.id)).map((i) => i.assetId)).toEqual([globalBase]);
    expect(globalItem).toBeDefined();
  });
});
