import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { createAttributeFixture } from '../../helpers/seed-catalog.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172 (C2/C3 code review 1, security review warn 1; `contracts/scoped-values-api.md` §3
 * step 3a) — the Global-only `product.*` family of the save runs the checks `PATCH /products/:id`
 * runs, before anything is written:
 *
 * - the SKU is free in the product **and** the variant namespace (`409 SKU_ALREADY_EXISTS`, not a 500);
 * - the attribute set exists, and attributes are checked against the set the save leaves (allowed
 *   keys and required values), also when the same save changes it;
 * - every category exists and is not deleted;
 * - the virtual-product download rules hold on the row the save leaves, and a download file is one
 *   the library shows.
 */
describe('172 — the save checks Global-only fields like PATCH (code review 1)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  const categories: string[] = [];
  const sets: string[] = [];
  const assets: string[] = [];
  const virtuals: string[] = [];

  const sku = async (productId: string) =>
    (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [productId]))[0]!.sku;
  const refusal = (field: string, reason: string) => ({
    error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [expect.objectContaining({ field, reason })] } },
  });
  const category = async (deleted = false) => {
    const id = randomUUID();
    await fx.sql(
      `insert into categories (id, parent_category_id, name, slug, sort_order, created_at, updated_at, deleted_at)
       values (?, null, ?::jsonb, ?, 0, now(), now(), ${deleted ? 'now()' : 'null'})`,
      [id, JSON.stringify({ 'en-US': 'Tools' }), `sv170-cat-${fx.run}-${categories.length}`],
    );
    categories.push(id);
    return id;
  };
  const asset = async () => {
    const id = randomUUID();
    await fx.sql(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, 'pdf', 'manual.pdf', 'application/pdf', 1, ?, now(), now())`,
      [id, `https://cdn.test/sv170-download/${id}`],
    );
    assets.push(id);
    return id;
  };
  const virtualProduct = async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...ADMIN,
      payload: {
        sku: `SV170-VIRT-${fx.run}-${randomUUID().slice(0, 4)}`,
        type: 'virtual',
        name: 'E-book',
        description: 'Global description',
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
        status: 'active',
        downloadUrl: 'https://cdn.test/sv170/ebook.pdf',
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json() as { data: { id: string } }).data.id;
    virtuals.push(id);
    return id;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    // The fixture's set (with one optional attribute) is the products' starting set.
    await fx.attribute({ key: 'colour', valueType: 'string' });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      for (const id of virtuals) await fx.sql(`delete from products where id = ?`, [id]);
      for (const id of categories) await fx.sql(`delete from categories where id = ?`, [id]);
      for (const id of sets) await fx.sql(`delete from attribute_sets where id = ?`, [id]);
      for (const id of assets) await fx.sql(`delete from assets where id = ?`, [id]);
      await teardownBackendServer(h);
    }
  });

  it('a SKU another product holds is 409 SKU_ALREADY_EXISTS, nothing written', async () => {
    const id = await fx.product();
    const other = await fx.product();
    const before = await sku(id);
    const res = await fx.put(id, {}, { name: 'Renamed', product: { sku: await sku(other) } });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.SKU_ALREADY_EXISTS } });
    expect(await sku(id)).toBe(before);
    expect((await fx.read(id)).fields.name).toMatchObject({ value: 'Drill X' });
  });

  it('a SKU a variant holds is 409 SKU_ALREADY_EXISTS (one namespace with variants)', async () => {
    const parent = await fx.product({ type: 'configurable' });
    const variantSku = `SV170-VAR-${fx.run}`;
    const created = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${parent}/variants`,
      ...ADMIN,
      payload: { sku: variantSku, variantAttributeValues: { color: 'red' } },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = await fx.product();
    const before = await sku(id);
    const res = await fx.put(id, {}, { product: { sku: variantSku } });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.SKU_ALREADY_EXISTS } });
    expect(await sku(id)).toBe(before);
  });

  it('a SKU is trimmed; one that is blank once trimmed is refused invalid', async () => {
    const id = await fx.product();
    const blank = await fx.put(id, {}, { product: { sku: '   ' } });
    expect(blank.statusCode, blank.body).toBe(422);
    expect(blank.json()).toMatchObject(refusal('product.sku', 'invalid'));
    const fresh = `SV170-NEW-${fx.run}`;
    const saved = await fx.put(id, {}, { product: { sku: `  ${fresh}  ` } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await sku(id)).toBe(fresh);
  });

  it('an attribute set that does not exist is subject_not_found, nothing written', async () => {
    const id = await fx.product();
    const res = await fx.put(id, {}, { name: 'Renamed', product: { attributeSetId: randomUUID() } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject(refusal('product.attributeSetId', 'subject_not_found'));
    expect((await fx.read(id)).fields.name).toMatchObject({ value: 'Drill X' });
  });

  it('a set change checks attributes against the new set: its required value is needed, its keys are allowed', async () => {
    // A second set holding one required attribute the first set does not have.
    const setId = randomUUID();
    await fx.sql(
      `insert into attribute_sets (id, code, name, is_system, created_at, updated_at)
       values (?, ?, '{"en-US":"SV170 B"}'::jsonb, false, now(), now())`,
      [setId, `sv170b_${fx.run}`],
    );
    sets.push(setId);
    const voltage = `voltage_${fx.run.replace(/-/g, '')}`;
    const created = await createAttributeFixture(h.em().fork(), {
      key: voltage,
      label: { 'en-US': 'Voltage' },
      labelDefault: 'Voltage',
      valueType: 'string' as never,
      scopable: false,
      isRequired: true,
    });
    await fx.sql(
      `insert into attribute_set_attributes (attribute_set_id, custom_field_definition_id, position) values (?, ?, 0)`,
      [setId, (created.definition as { id: string }).id],
    );

    const id = await fx.product();
    // Without the new set, the key is not the product's.
    const notInSet = await fx.put(id, {}, { attributes: { [voltage]: '230 V' } });
    expect(notInSet.statusCode, notInSet.body).toBe(422);
    expect(notInSet.json()).toMatchObject(refusal(`attribute:${voltage}`, 'invalid'));

    const missing = await fx.put(id, {}, { product: { attributeSetId: setId } });
    expect(missing.statusCode, missing.body).toBe(422);
    expect(missing.json()).toMatchObject(refusal(`attribute:${voltage}`, 'required_empty'));
    expect((await fx.sql<{ s: string }>(`select attribute_set_id::text as s from products where id = ?`, [id]))[0]!.s).not.toBe(setId);

    const saved = await fx.put(id, {}, { product: { attributeSetId: setId }, attributes: { [voltage]: '230 V' } });
    expect(saved.statusCode, saved.body).toBe(200);
    const [row] = await fx.sql<{ s: string; v: Record<string, unknown> }>(
      `select attribute_set_id::text as s, attribute_values as v from products where id = ?`,
      [id],
    );
    expect(row).toMatchObject({ s: setId, v: { [voltage]: '230 V' } });
  });

  it('a category that does not exist, or is deleted, is subject_not_found; existing ones are stored', async () => {
    const id = await fx.product();
    const live = await category();
    const deleted = await category(true);
    for (const ids of [[live, randomUUID()], [live, deleted]]) {
      const res = await fx.put(id, {}, { product: { categoryIds: ids } });
      expect(res.statusCode, res.body).toBe(422);
      expect(res.json()).toMatchObject(refusal('product.categoryIds', 'subject_not_found'));
    }
    expect(await fx.sql(`select 1 from product_categories where product_id = ?`, [id])).toEqual([]);
    const saved = await fx.put(id, {}, { product: { categoryIds: [live, live] } });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(await fx.sql(`select category_id::text as c from product_categories where product_id = ?`, [id])).toEqual([{ c: live }]);
  });

  it('download fields hold the virtual-product rules on the row the save leaves', async () => {
    const simple = await fx.product();
    const onSimple = await fx.put(simple, {}, { product: { downloadUrl: 'https://cdn.test/sv170/x.pdf' } });
    expect(onSimple.statusCode, onSimple.body).toBe(422);
    expect(onSimple.json()).toMatchObject(refusal('product.downloadUrl', 'invalid'));

    const virtual = await virtualProduct();
    const file = await asset();
    // Both set: the stored URL plus a new file.
    const both = await fx.put(virtual, {}, { product: { downloadAssetId: file } });
    expect(both.statusCode, both.body).toBe(422);
    expect(both.json()).toMatchObject(refusal('product.downloadAssetId', 'invalid'));
    // Neither set.
    const neither = await fx.put(virtual, {}, { product: { downloadUrl: null } });
    expect(neither.statusCode, neither.body).toBe(422);
    expect(neither.json()).toMatchObject(refusal('product.downloadUrl', 'invalid'));
    // A file the library does not have.
    const unknown = await fx.put(virtual, {}, { product: { downloadUrl: null, downloadAssetId: randomUUID() } });
    expect(unknown.statusCode, unknown.body).toBe(422);
    expect(unknown.json()).toMatchObject(refusal('product.downloadAssetId', 'subject_not_found'));

    const swapped = await fx.put(virtual, {}, { product: { downloadUrl: null, downloadAssetId: file } });
    expect(swapped.statusCode, swapped.body).toBe(200);
    const [row] = await fx.sql<{ a: string | null; u: string | null }>(
      `select download_asset_id::text as a, download_url as u from products where id = ?`,
      [virtual],
    );
    expect(row).toEqual({ a: file, u: null });
  });
});
