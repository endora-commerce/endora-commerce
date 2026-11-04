import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US7 (T144; FR-070, R7, spec *Edge Cases*) — immediate actions never move the
 * editor's version. Read the version; add / reorder / remove gallery items, add / remove an
 * attachment and a packaging unit, add a product link and a channel membership; the version is
 * unchanged and a Save sent with the version read **before** them succeeds with its staged cells.
 * A Save naming the alt text of a gallery item removed meanwhile is `422 SCOPED_VALUE_INVALID`
 * `subject_not_found`, nothing written. Scoped-value and product-row writes do move it.
 *
 * Variants, grouped items and bundle slots and options are exercised on their own product types.
 * Price-book rows (`price_lists`) and stock (`inventory`) cannot write `products` at all (they
 * own neither the table nor a catalog writer); they are not exercised here (T145 note).
 */
describe('172 US7 — immediate actions keep the version (T144)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let extraChannel: string;

  const inject = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    h.app.inject({ method, url, ...ADMIN, ...(payload ? { payload } : {}) });
  const asset = async (kind: string, mime: string) => {
    const id = randomUUID();
    await fx.sql(
      `insert into assets (id, kind, filename, mime_type, size_bytes, storage_url, created_at, updated_at)
       values (?, ?, 'f.bin', ?, 1, ?, now(), now())`,
      [id, kind, mime, `https://cdn.test/t144/${id}`],
    );
    return id;
  };
  const version = async (productId: string) => (await fx.read(productId)).version;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    extraChannel = await fx.channel(['pl-PL']);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('structural, link and membership actions leave the version; a Save with the old version succeeds', async () => {
    const id = await fx.product({ channels: [channel] });
    const target = await fx.product();
    const { items, attachment, unit } = await fx.media(id);
    const v0 = await version(id);
    const base = `/api/v1/admin/catalog/products/${id}`;

    const added = await inject('POST', `${base}/gallery`, { assetId: await asset('image', 'image/png'), labels: [] });
    expect(added.statusCode, added.body).toBe(201);
    const addedId = (added.json() as { data: { id: string } }).data.id;
    expect((await inject('PUT', `${base}/gallery/order`, { orderedGalleryItemIds: [addedId, items[1], items[0]] })).statusCode).toBeLessThan(300);
    expect((await inject('DELETE', `${base}/gallery/${addedId}`)).statusCode).toBeLessThan(300);

    const [type] = await fx.sql<{ id: string }>(`select attachment_type_id::text as id from product_attachments where id = ?`, [attachment]);
    const newAttachment = await inject('POST', `${base}/attachments`, { assetId: await asset('pdf', 'application/pdf'), attachmentTypeId: type!.id, name: 'Manual' });
    expect(newAttachment.statusCode, newAttachment.body).toBe(201);
    expect((await inject('DELETE', `${base}/attachments/${(newAttachment.json() as { data: { id: string } }).data.id}`)).statusCode).toBeLessThan(300);

    const newUnit = await inject('POST', `${base}/packaging-units`, { name: 'Pallet', baseQuantity: 48 });
    expect(newUnit.statusCode, newUnit.body).toBe(201);
    expect((await inject('DELETE', `${base}/packaging-units/${(newUnit.json() as { data: { id: string } }).data.id}`)).statusCode).toBeLessThan(300);

    expect((await inject('POST', `${base}/links`, { links: [{ targetProductId: target, kind: 'related' }] })).statusCode).toBe(201);
    const membership = (h.container.cradle as unknown as { salesChannelMembershipPort: { addToChannel: (c: string, t: string, e: string) => Promise<unknown> } })
      .salesChannelMembershipPort;
    await membership.addToChannel(extraChannel, 'product', id);

    expect(await version(id)).toBe(v0);
    const saved = await fx.put(
      id,
      { channelId: channel, languageCode: 'pl-PL' },
      { name: 'Wiertarka', gallery: { items: { [items[0]]: { altText: 'Bok' } } }, attachments: { [attachment]: { name: 'Karta' } }, packagingUnits: { [unit]: { name: 'Karton' } } },
      { version: v0 },
    );
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
    expect(await version(id)).not.toBe(v0);
  });

  it('variant, grouped-item and bundle-slot actions leave the version; a Save with the old version succeeds', async () => {
    const child = await fx.product();
    const check = async (id: string, actions: () => Promise<void>) => {
      const v0 = await version(id);
      await actions();
      expect(await version(id)).toBe(v0);
      const saved = await fx.put(id, { channelId: channel, languageCode: 'pl-PL' }, { name: `Zestaw ${id.slice(0, 4)}` }, { version: v0 });
      expect(saved.statusCode, saved.body).toBe(200);
      expect(await version(id)).not.toBe(v0);
    };

    // A configurable product: add, change and remove a variant.
    const configurable = await fx.product({ channels: [channel], type: 'configurable' });
    await check(configurable, async () => {
      const base = `/api/v1/admin/catalog/products/${configurable}/variants`;
      const created = await inject('POST', base, { sku: `T144-V-${fx.run}`, variantAttributeValues: { color: 'red' } });
      expect(created.statusCode, created.body).toBe(201);
      const variantId = (created.json() as { data: { id: string } }).data.id;
      expect((await inject('PATCH', `${base}/${variantId}`, { stockLevel: 3 })).statusCode).toBeLessThan(300);
      expect((await inject('DELETE', `${base}/${variantId}`)).statusCode).toBeLessThan(300);
    });

    // A grouped product: add, change and remove an item.
    const grouped = await fx.product({ channels: [channel], type: 'grouped' });
    await check(grouped, async () => {
      const base = `/api/v1/admin/catalog/products/${grouped}/grouped-items`;
      const created = await inject('POST', base, { childProductId: child, quantity: 1 });
      expect(created.statusCode, created.body).toBe(201);
      const itemId = (created.json() as { data: { id: string } }).data.id;
      expect((await inject('PATCH', `${base}/${itemId}`, { quantity: 2 })).statusCode).toBeLessThan(300);
      expect((await inject('DELETE', `${base}/${itemId}`)).statusCode).toBeLessThan(300);
    });

    // A bundle: add a slot and an option, change the slot, remove both.
    const bundle = await fx.product({ channels: [channel], type: 'bundle' });
    await check(bundle, async () => {
      const base = `/api/v1/admin/catalog/products/${bundle}/bundle-slots`;
      const slot = await inject('POST', base, { name: { 'en-US': 'Bit' }, maxQuantity: 2 });
      expect(slot.statusCode, slot.body).toBe(201);
      const slotId = (slot.json() as { data: { id: string } }).data.id;
      const option = await inject('POST', `${base}/${slotId}/options`, { optionProductId: child });
      expect(option.statusCode, option.body).toBe(201);
      const optionId = (option.json() as { data: { id: string } }).data.id;
      expect((await inject('PATCH', `${base}/${slotId}`, { maxQuantity: 3 })).statusCode).toBeLessThan(300);
      expect((await inject('DELETE', `${base}/${slotId}/options/${optionId}`)).statusCode).toBeLessThan(300);
      expect((await inject('DELETE', `${base}/${slotId}`)).statusCode).toBeLessThan(300);
    });
  });

  it('a Save naming a gallery item removed meanwhile is subject_not_found, nothing written', async () => {
    const id = await fx.product({ channels: [channel] });
    const { items } = await fx.media(id);
    const v0 = await version(id);
    expect((await inject('DELETE', `/api/v1/admin/catalog/products/${id}/gallery/${items[1]}`)).statusCode).toBeLessThan(300);
    const res = await fx.put(
      id,
      { channelId: channel },
      { name: 'Channel name', gallery: { items: { [items[1]]: { altText: 'Gone' } } } },
      { version: v0 },
    );
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({
      error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ field: `gallery:${items[1]}:altText`, reason: 'subject_not_found' }] } },
    });
    expect(await fx.sql(`select 1 from product_value_overrides where product_id = ?`, [id])).toEqual([]);
  });

  it('PATCH /products/:id compares the version it is sent: a stale one is 409, nothing written (contract §6)', async () => {
    const id = await fx.product({ channels: [channel] });
    const v0 = await version(id);
    const url = `/api/v1/admin/catalog/products/${id}`;
    const fresh = await inject('PATCH', url, { name: 'Fresh', version: v0 });
    expect(fresh.statusCode, fresh.body).toBe(200);
    const v1 = await version(id);
    expect(v1).not.toBe(v0);

    const stale = await inject('PATCH', url, { name: 'Stale', version: v0 });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
    expect((await fx.read(id)).fields.name).toMatchObject({ value: 'Fresh' });
    expect(await version(id)).toBe(v1);

    const outOfRange = await inject('PATCH', url, { name: 'Overflow', version: '9999999999999999999' });
    expect(outOfRange.statusCode, outOfRange.body).toBe(400);
  });

  it('a save with no cells and a URL-key write that changes nothing leave the version (code review warn)', async () => {
    const id = await fx.product({ channels: [channel] });
    const v0 = await version(id);
    const empty = await fx.put(id, { channelId: channel }, {}, { version: v0 });
    expect(empty.statusCode, empty.body).toBe(200);
    const blank = await fx.put(id, { channelId: channel }, { name: '' }, { version: v0 });
    expect(blank.statusCode, blank.body).toBe(200);
    expect(await version(id)).toBe(v0);

    const key = `t144-same-${fx.run}`;
    const url = `/api/v1/admin/catalog/products/${id}/url-keys`;
    expect((await inject('PUT', url, { channelKeys: [{ channelId: channel, languageCode: null, key }] })).statusCode).toBe(200);
    const v1 = await version(id);
    expect(v1).not.toBe(v0);
    const same = await inject('PUT', url, { channelKeys: [{ channelId: channel, languageCode: null, key }] });
    expect(same.statusCode, same.body).toBe(200);
    expect(await version(id)).toBe(v1);
  });

  it('scoped-value, scope-row, URL-key and product-row writes do move the version', async () => {
    const id = await fx.product({ channels: [channel] });
    let v = await version(id);
    const moved = async () => {
      const next = await version(id);
      expect(next).not.toBe(v);
      v = next;
    };
    await fx.save(id, { channelId: channel }, { description: 'C' });
    await moved();
    expect(
      (await inject('PATCH', `/api/v1/admin/catalog/products/${id}/scopes`, { channels: [{ channelId: channel, returnable: true }] })).statusCode,
    ).toBe(200);
    await moved();
    expect(
      (await inject('PUT', `/api/v1/admin/catalog/products/${id}/url-keys`, { channelKeys: [{ channelId: channel, languageCode: null, key: `t144-${fx.run}` }] })).statusCode,
    ).toBe(200);
    await moved();
    expect((await inject('PATCH', `/api/v1/admin/catalog/products/${id}`, { name: 'Renamed' })).statusCode).toBe(200);
    await moved();
  });
});
