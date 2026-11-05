import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174, US2 (T041; FR-011, FR-013, data-model §6–§7) — what the storefront serves of a
 * product's gallery, attachments and packaging units at (C, L), written through
 * `PUT …/scoped-values` and resolved C×L → C → G with empty overrides:
 *
 * - gallery: a role held at C or C×L, an empty role override (no image holds it), an item hidden
 *   at Global, at C and shown again at C×L; the alt text at the scope, `''` for an empty override
 *   (a decorative image) and the Global alt text otherwise; the listing card follows the same
 *   chain;
 * - attachments: name, description and hidden at the scope; an empty description is `null`;
 * - packaging units: the name at the scope; an empty override is `''`.
 *
 * Replaces 163's `media-scopes` and `attachment-packaging-translations` suites (per-language
 * columns and the retired `channel-roles` / per-channel PATCH writers).
 */
describe('174 US2 — gallery, attachments and packaging units at (C, L) on the storefront (T041)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let b2b: { id: string; code: string };
  let b2c: { id: string; code: string };
  let productId: string;
  let sku: string;
  let items: [string, string];
  let attachment: string;
  let unit: string;

  async function channel(): Promise<{ id: string; code: string }> {
    const id = await fx.channel(['en-US', 'pl-PL']);
    await fx.sql(`update sales_channels set active = true, currencies = '["PLN"]'::jsonb where id = ?`, [id]);
    const [row] = await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [id]);
    return { id, code: row!.code };
  }

  type Pdp = {
    gallery: Array<{ id: string; labels: string[]; asset: { url: string }; altText?: string | null }>;
    primaryAssetUrl: string | null;
    attachments: Array<{ id: string; name: string; description: string | null }>;
    packagingUnits?: Array<{ id: string; name: string }>;
  };

  async function pdp(at: { code: string }, language: string): Promise<Pdp> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products/${productId}`,
      headers: { 'x-sales-channel': at.code, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: Pdp }).data;
  }

  async function card(at: { code: string }, language: string): Promise<string | null> {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/catalog/products?q=${encodeURIComponent(sku)}&limit=50`,
      headers: { 'x-sales-channel': at.code, 'accept-language': language },
    });
    expect(res.statusCode, res.body).toBe(200);
    const found = (res.json() as { data: Array<{ id: string; primaryAssetUrl: string | null }> }).data.find((p) => p.id === productId);
    expect(found, 'the product is listed in the channel').toBeDefined();
    return found!.primaryAssetUrl;
  }

  const urlOf = async (itemId: string): Promise<string> => {
    const [row] = await fx.sql<{ url: string }>(
      `select a.storage_url as url from gallery_items gi join assets a on a.id = gi.asset_id where gi.id = ?`,
      [itemId],
    );
    return row!.url;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    b2b = await channel();
    b2c = await channel();
    productId = await fx.product({ channels: [b2b.id, b2c.id] });
    const [row] = await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [productId]);
    sku = row!.sku;
    // Item 0 holds base_image Globally, alt "Alt 0"; item 1 has alt "Alt 1".
    ({ items, attachment, unit } = await fx.media(productId));
  }, 60_000);

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('with no override every scope serves the Global gallery, attachment and unit', async () => {
    for (const at of [b2b, b2c]) {
      const page = await pdp(at, 'pl-PL');
      expect(page.gallery.map((g) => g.id)).toEqual(items);
      expect(page.gallery[0]!.labels).toEqual(['base_image']);
      expect(page.gallery.map((g) => g.altText)).toEqual(['Alt 0', 'Alt 1']);
      expect(page.attachments).toEqual([expect.objectContaining({ id: attachment, name: 'Data sheet', description: 'Specs' })]);
      expect(page.packagingUnits?.find((u) => u.id === unit)?.name).toBe('Carton');
    }
  });

  it('a role held at C moves the label there; an empty role at C×L leaves it to nobody', async () => {
    await fx.save(productId, { channelId: b2b.id }, { gallery: { roles: { baseImage: items[1], thumbnail: items[1] } } });
    const english = await pdp(b2b, 'en-US');
    expect(english.gallery.find((g) => g.id === items[1])?.labels).toEqual(['base_image', 'thumbnail']);
    expect(english.gallery.find((g) => g.id === items[0])?.labels).toEqual([]);
    expect(await card(b2b, 'en-US')).toBe(await urlOf(items[1]));

    await fx.save(productId, { channelId: b2b.id, languageCode: 'pl-PL' }, { gallery: { roles: { thumbnail: null } } });
    const polish = await pdp(b2b, 'pl-PL');
    expect(polish.gallery.find((g) => g.id === items[1])?.labels).toEqual(['base_image']);
    // The other channel keeps the Global holder.
    expect((await pdp(b2c, 'pl-PL')).gallery.find((g) => g.id === items[0])?.labels).toEqual(['base_image']);
    expect(await card(b2c, 'pl-PL')).toBe(await urlOf(items[0]));
  });

  it('an item hidden at Global is hidden everywhere unless a scope shows it again; C×L wins over C', async () => {
    await fx.save(productId, {}, { gallery: { items: { [items[0]]: { hidden: true } } } });
    expect((await pdp(b2c, 'en-US')).gallery.map((g) => g.id)).toEqual([items[1]]);
    await fx.save(productId, { channelId: b2c.id, languageCode: 'pl-PL' }, { gallery: { items: { [items[0]]: { hidden: false } } } });
    expect((await pdp(b2c, 'pl-PL')).gallery.map((g) => g.id)).toEqual(items);
    expect((await pdp(b2c, 'en-US')).gallery.map((g) => g.id)).toEqual([items[1]]);
    await fx.save(productId, { channelId: b2c.id }, { gallery: { items: { [items[1]]: { hidden: true } } } });
    expect((await pdp(b2c, 'en-US')).gallery.map((g) => g.id)).toEqual([]);
    // Back to visible for the cases below.
    await fx.save(productId, {}, { gallery: { items: { [items[0]]: { hidden: false } } } });
    await fx.save(productId, { channelId: b2c.id }, { gallery: { items: { [items[1]]: { hidden: { inherit: true } } } } });
    await fx.save(productId, { channelId: b2c.id, languageCode: 'pl-PL' }, { gallery: { items: { [items[0]]: { hidden: { inherit: true } } } } });
    expect((await pdp(b2c, 'en-US')).gallery.map((g) => g.id)).toEqual(items);
  });

  it("serves the alt text at the scope; an empty override is '' (decorative), never the asset's or the Global one", async () => {
    await fx.save(productId, { channelId: b2c.id }, { gallery: { items: { [items[0]]: { altText: 'Channel alt' } } } });
    await fx.save(productId, { channelId: b2c.id, languageCode: 'pl-PL' }, { gallery: { items: { [items[1]]: { altText: null } } } });
    const polish = await pdp(b2c, 'pl-PL');
    expect(polish.gallery.find((g) => g.id === items[0])?.altText).toBe('Channel alt');
    expect(polish.gallery.find((g) => g.id === items[1])?.altText).toBe('');
    const english = await pdp(b2c, 'en-US');
    expect(english.gallery.find((g) => g.id === items[1])?.altText).toBe('Alt 1');
    expect((await pdp(b2b, 'pl-PL')).gallery.find((g) => g.id === items[0])?.altText).toBe('Alt 0');
  });

  it('serves the attachment name, description and hidden flag at the scope; an empty description is null', async () => {
    await fx.save(productId, { channelId: b2c.id }, { attachments: { [attachment]: { name: 'Karta (kanal)' } } });
    await fx.save(productId, { channelId: b2c.id, languageCode: 'pl-PL' }, { attachments: { [attachment]: { description: null } } });
    expect((await pdp(b2c, 'pl-PL')).attachments).toEqual([
      expect.objectContaining({ id: attachment, name: 'Karta (kanal)', description: null }),
    ]);
    expect((await pdp(b2c, 'en-US')).attachments).toEqual([
      expect.objectContaining({ id: attachment, name: 'Karta (kanal)', description: 'Specs' }),
    ]);
    await fx.save(productId, { channelId: b2b.id, languageCode: 'en-US' }, { attachments: { [attachment]: { hidden: true } } });
    expect((await pdp(b2b, 'en-US')).attachments).toEqual([]);
    expect((await pdp(b2b, 'pl-PL')).attachments.map((a) => a.id)).toEqual([attachment]);
  });

  it("serves the packaging-unit name at the scope; an empty override is ''", async () => {
    await fx.save(productId, { channelId: b2b.id, languageCode: 'pl-PL' }, { packagingUnits: { [unit]: { name: 'Karton' } } });
    await fx.save(productId, { channelId: b2c.id }, { packagingUnits: { [unit]: { name: null } } });
    expect((await pdp(b2b, 'pl-PL')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('Karton');
    expect((await pdp(b2b, 'en-US')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('Carton');
    expect((await pdp(b2c, 'en-US')).packagingUnits?.find((u) => u.id === unit)?.name).toBe('');
  });
});
