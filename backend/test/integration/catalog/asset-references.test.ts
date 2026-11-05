import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { registerCatalogAssetReferences } from '../../../../packages/modules/catalog/src/backend/services/asset-references.js';
import { AssetReferenceRegistry } from '../../../../packages/modules/assets_library/src/backend/services/reference-registry.js';

/**
 * The six catalog asset-reference descriptors over the real schema
 * (`specs/166-asset-reference-visibility/` research R-6, tasks.md T011).
 *
 * Catalog had no reference-scanner test. What this pins is the batched
 * contract the library now depends on: a batch of assets is answered in **one
 * statement per descriptor** — the category-content one used to loop one
 * jsonpath query per asset — and every hit names the asset it points at, so
 * `findReferencesMany` attributes it (the recursive folder delete and the
 * visibility rescue both ask about many assets at once).
 */

/** Counts the statements a descriptor issues on the EntityManagers it is handed. */
function countingEmFactory(emFactory: () => EntityManager): { emFactory: () => EntityManager; statements: () => number } {
  let statements = 0;
  return {
    emFactory: () =>
      new Proxy(emFactory(), {
        get(target, prop) {
          const value: unknown = Reflect.get(target, prop, target);
          if (typeof value !== 'function') return value;
          const fn = value as (...args: unknown[]) => unknown;
          if (prop === 'execute') {
            return (...args: unknown[]) => {
              statements += 1;
              return fn.apply(target, args);
            };
          }
          return fn.bind(target);
        },
      }),
    statements: () => statements,
  };
}

describe('catalog asset references — attribution and batching (feature 166, R-6)', () => {
  let h: BackendServerHandle;
  const adminCookie = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function createProduct(suffix: string): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: `R6-REFS-${suffix}-${randomUUID().slice(0, 6)}`,
        type: 'simple',
        name: `R6 refs ${suffix}`,
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

  async function seedAsset(): Promise<string> {
    const id = randomUUID();
    await h.orm.em.getConnection().execute(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'image', 'r6.jpg', 'image/jpeg', 1024, ?, now(), now())`,
      [id, `https://cdn.test/${id}.jpg`],
    );
    return id;
  }

  it('answers a batch in one statement per descriptor, each hit tagged with its asset', async () => {
    const conn = h.orm.em.getConnection();
    const x = await seedAsset();
    const y = await seedAsset();
    const unused = randomUUID();

    // x: a gallery image and a category main image; y: a product attachment,
    // a virtual download and a category page's content.
    const galleryProduct = await createProduct('GALLERY');
    const attachmentProduct = await createProduct('ATTACH');
    const gallery = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${galleryProduct}/gallery`,
      payload: { assetId: x, labels: [] },
      cookies: adminCookie,
    });
    expect(gallery.statusCode).toBe(201);

    const typeId = randomUUID();
    await conn.execute(
      `insert into attachment_types (id, code, name, position, created_at, updated_at)
       values (?, ?, '{"en-US":"R6"}'::jsonb, 0, now(), now())`,
      [typeId, `r6-${typeId.slice(0, 8)}`],
    );
    await conn.execute(
      `insert into product_attachments (id, product_id, asset_id, attachment_type_id, name, position, created_at, updated_at)
       values (?, ?, ?, ?, 'Manual', 0, now(), now())`,
      [randomUUID(), attachmentProduct, y, typeId],
    );
    await conn.execute(`update products set download_asset_id = ? where id = ?`, [y, galleryProduct]);

    const mainImageCategory = randomUUID();
    const contentCategory = randomUUID();
    await conn.execute(
      `insert into categories (id, name, slug, main_image_asset_id, created_at, updated_at)
       values (?, '{"en-US":"R6 main"}'::jsonb, ?, ?, now(), now())`,
      [mainImageCategory, `r6-main-${mainImageCategory.slice(0, 8)}`, x],
    );
    await conn.execute(
      `insert into categories (id, name, slug, content, created_at, updated_at)
       values (?, '{"en-US":"R6 content"}'::jsonb, ?, ?::jsonb, now(), now())`,
      [
        contentCategory,
        `r6-content-${contentCategory.slice(0, 8)}`,
        JSON.stringify({
          schema_version: 1,
          languages: { 'en-US': { root: { props: {} }, content: [{ type: 'LibraryImage', props: { assetId: y } }] } },
        }),
      ],
    );

    const counted = countingEmFactory(() => h.em());
    const registry = new AssetReferenceRegistry();
    registerCatalogAssetReferences(registry, counted.emFactory);

    const out = await registry.findReferencesMany([x, y, unused]);

    expect(counted.statements(), 'one statement per descriptor, six descriptors').toBe(6);
    expect(out.get(x)).toHaveLength(2);
    expect(out.get(x)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'product_gallery', entityId: galleryProduct, assetId: x }),
        expect.objectContaining({ kind: 'category_main_image', entityId: mainImageCategory, assetId: x }),
      ]),
    );
    expect(out.get(y)).toHaveLength(3);
    expect(out.get(y)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'product_attachment', entityId: attachmentProduct, assetId: y }),
        expect.objectContaining({ kind: 'product_virtual_download', entityId: galleryProduct, assetId: y }),
        expect.objectContaining({ kind: 'category_content', entityId: contentCategory, assetId: y }),
      ]),
    );
    expect(out.get(unused)).toEqual([]);
  });

  it('every descriptor tags its hits on its own', async () => {
    const conn = h.orm.em.getConnection();
    const x = await seedAsset();
    const categoryId = randomUUID();
    await conn.execute(
      `insert into categories (id, name, slug, main_image_asset_id, content, created_at, updated_at)
       values (?, '{"en-US":"R6 both"}'::jsonb, ?, ?, ?::jsonb, now(), now())`,
      [
        categoryId,
        `r6-both-${categoryId.slice(0, 8)}`,
        x,
        JSON.stringify({ schema_version: 1, languages: { 'en-US': { root: { props: { image: x } }, content: [] } } }),
      ],
    );
    const registry = new AssetReferenceRegistry();
    registerCatalogAssetReferences(registry, () => h.em());

    const { unrestricted, restricted } = registry.partition();
    expect(restricted).toEqual([]);
    expect(unrestricted).toHaveLength(6);
    const hits = (await Promise.all(unrestricted.map((d) => d.findReferences([x, randomUUID()])))).flat();
    expect(hits).toHaveLength(2);
    for (const hit of hits) expect(hit.assetId).toBe(x);
  });

  // Feature 172 (`specs/172-product-content-attributes/`, FR-062, FR-063, US6 #5,
  // research R-17) — a library asset embedded in a product's Page Builder
  // content attribute is in use by that product.
  describe('product content (feature 172)', () => {
    async function contentAttributeOn(productId: string): Promise<string> {
      const conn = h.orm.em.getConnection();
      const key = `ar_content_${randomUUID().slice(0, 6)}`;
      const attribute = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attributes',
        payload: {
          key,
          label: { 'en-US': 'Asset guide' },
          labelDefault: 'Asset guide',
          type: 'page_builder',
          isSearchable: false,
          isFilterable: false,
          isVariantAxis: false,
        },
        cookies: adminCookie,
      });
      expect(attribute.statusCode, attribute.body).toBe(201);
      const attributeId = (attribute.json() as { data: { id: string } }).data.id;
      const set = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/catalog/attribute-sets',
        payload: { code: `ar_set_${key}`, name: { 'en-US': 'Asset set' } },
        cookies: adminCookie,
      });
      const setId = (set.json() as { data: { id: string } }).data.id;
      await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/catalog/attribute-sets/${setId}/attributes`,
        payload: { assignments: [{ attributeId, position: 0 }] },
        cookies: adminCookie,
      });
      await conn.execute(`update products set attribute_set_id = ? where id = ?`, [setId, productId]);
      return key;
    }

    async function embed(productId: string, key: string, assetId: string): Promise<void> {
      const put = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/products/${productId}/content/${key}`,
        payload: {
          content: {
            languages: {
              'en-US': { root: { props: {} }, content: [{ type: 'LibraryImage', props: { id: 'img', assetId } }] },
            },
          },
        },
        cookies: adminCookie,
      });
      expect(put.statusCode, put.body).toBe(200);
    }

    it('names the product, and blocks deleting the asset (FR-063, US6 #5)', async () => {
      const asset = await seedAsset();
      const productId = await createProduct('CONTENT');
      const key = await contentAttributeOn(productId);
      await embed(productId, key, asset);

      const registry = new AssetReferenceRegistry();
      registerCatalogAssetReferences(registry, () => h.em(), h.catalogAttributeRead);
      const hits = (await registry.findReferencesMany([asset])).get(asset);
      expect(hits).toEqual([
        expect.objectContaining({ kind: 'product_content', entityId: productId, assetId: asset }),
      ]);
      expect(hits![0]!.label).toContain('R6 refs CONTENT');
      expect(hits![0]!.label).toContain(key);

      const del = await h.app.inject({ method: 'DELETE', url: `/api/v1/admin/assets/${asset}`, cookies: adminCookie });
      expect(del.statusCode, del.body).toBe(409);
      expect(del.json()).toMatchObject({ error: { code: 'ASSET_REFERENCED' } });
      expect((del.json() as { error: { details: Array<{ path: string }> } }).error.details).toEqual([
        expect.objectContaining({ path: 'product_content' }),
      ]);
    });

    it('does not report a soft-deleted product’s content (FR-062)', async () => {
      const asset = await seedAsset();
      const productId = await createProduct('GONE');
      const key = await contentAttributeOn(productId);
      await embed(productId, key, asset);
      const deleted = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/catalog/products/${productId}`,
        cookies: adminCookie,
      });
      expect(deleted.statusCode, deleted.body).toBeLessThan(300);

      const registry = new AssetReferenceRegistry();
      registerCatalogAssetReferences(registry, () => h.em());
      expect((await registry.findReferencesMany([asset])).get(asset)).toEqual([]);
    });
  });
});

