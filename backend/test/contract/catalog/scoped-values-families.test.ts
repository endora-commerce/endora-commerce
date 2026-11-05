import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174, US2 (T032; FR-011, FR-012, data-model §6–§7) — the family values through the one
 * save: gallery alt text and hide image, gallery roles (an empty role = no image holds it),
 * attachment name / description / hidden and the packaging-unit name, each at Global, Channel and
 * Channel × language; hidden at Global; a role holder hidden at (C, L) holds the role for nobody.
 */
describe('174 US2 — gallery, attachment and packaging values at G, C and C×L (T032)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  const C = () => ({ channelId: channel });
  const CL = (languageCode = 'pl-PL') => ({ channelId: channel, languageCode });

  it('alt text and hidden: G, C, C×L, the empty alt, and hidden at Global', async () => {
    const id = await fx.product({ channels: [channel] });
    const { items } = await fx.media(id);
    const [a, b] = items;
    await fx.save(id, {}, { gallery: { items: { [a]: { altText: 'Drill, side' } } } });
    await fx.save(id, C(), { gallery: { items: { [a]: { altText: 'Drill (channel)' } } } });
    await fx.save(id, CL(), { gallery: { items: { [a]: { altText: null }, [b]: { hidden: true } } } });

    const pl = await fx.read(id, CL());
    const plA = pl.gallery.items.find((i) => i.id === a)!;
    expect(plA.altText).toMatchObject({ value: null, source: 'set_empty' }); // alt="" — decorative
    expect(pl.gallery.items.find((i) => i.id === b)!.hidden).toMatchObject({ value: true, source: 'set' });
    const en = await fx.read(id, CL('en-US'));
    expect(en.gallery.items.find((i) => i.id === a)!.altText).toMatchObject({ value: 'Drill (channel)', source: 'inherited_channel' });
    expect(en.gallery.items.find((i) => i.id === b)!.hidden).toMatchObject({ value: false, source: 'inherited_global' });
    expect((await fx.read(id)).gallery.items.find((i) => i.id === a)!.altText).toMatchObject({ value: 'Drill, side', source: 'set' });

    await fx.save(id, {}, { gallery: { items: { [b]: { hidden: true } } } });
    expect((await fx.read(id, CL('en-US'))).gallery.items.find((i) => i.id === b)!.hidden).toMatchObject({
      value: true,
      source: 'inherited_global',
    });
    const [row] = await fx.sql<{ hidden: boolean }>(`select hidden from gallery_items where id = ?`, [b]);
    expect(row!.hidden).toBe(true);
  });

  it('gallery roles: the scoped holder, the empty role, and a holder hidden at (C, L) holding it for nobody', async () => {
    const id = await fx.product({ channels: [channel] });
    const { items } = await fx.media(id);
    const [a, b] = items;
    expect((await fx.read(id)).gallery.roles.baseImage).toMatchObject({ value: a, source: 'set' });

    await fx.save(id, C(), { gallery: { roles: { baseImage: b, thumbnail: null } } });
    const c = await fx.read(id, CL());
    expect(c.gallery.roles.baseImage).toMatchObject({ value: b, source: 'inherited_channel' });
    expect(c.gallery.roles.thumbnail).toMatchObject({ value: null, source: 'inherited_channel' });

    await fx.save(id, CL(), { gallery: { items: { [b]: { hidden: true } } } });
    expect((await fx.read(id, CL())).gallery.roles.baseImage).toMatchObject({ value: null });
    expect((await fx.read(id, CL('en-US'))).gallery.roles.baseImage).toMatchObject({ value: b });

    // At Global the role moves to another item; inherit at C brings the Global holder back.
    await fx.save(id, {}, { gallery: { roles: { smallImage: b } } });
    expect((await fx.read(id)).gallery.roles.smallImage).toMatchObject({ value: b, source: 'set' });
    await fx.save(id, C(), { gallery: { roles: { baseImage: { inherit: true } } } });
    expect((await fx.read(id, CL('en-US'))).gallery.roles.baseImage).toMatchObject({ value: a, source: 'inherited_global' });
  });

  it('attachments: name, description and hidden at G, C and C×L', async () => {
    const id = await fx.product({ channels: [channel] });
    const { attachment } = await fx.media(id);
    await fx.save(id, {}, { attachments: { [attachment]: { name: 'Data sheet v2', hidden: false } } });
    await fx.save(id, C(), { attachments: { [attachment]: { description: 'Specs (channel)', hidden: true } } });
    await fx.save(id, CL(), { attachments: { [attachment]: { name: 'Karta katalogowa', description: null, hidden: false } } });

    const pl = (await fx.read(id, CL())).attachments.find((x) => x.id === attachment)!;
    expect(pl.name).toMatchObject({ value: 'Karta katalogowa', source: 'set' });
    expect(pl.description).toMatchObject({ value: null, source: 'set_empty' });
    expect(pl.hidden).toMatchObject({ value: false, source: 'set' });
    const en = (await fx.read(id, CL('en-US'))).attachments.find((x) => x.id === attachment)!;
    expect(en.name).toMatchObject({ value: 'Data sheet v2', source: 'inherited_global' });
    expect(en.description).toMatchObject({ value: 'Specs (channel)', source: 'inherited_channel' });
    expect(en.hidden).toMatchObject({ value: true, source: 'inherited_channel' });
  });

  it('packaging-unit name at G, C and C×L, and an empty name override', async () => {
    const id = await fx.product({ channels: [channel] });
    const { unit } = await fx.media(id);
    await fx.save(id, {}, { packagingUnits: { [unit]: { name: 'Box' } } });
    await fx.save(id, C(), { packagingUnits: { [unit]: { name: 'Box (channel)' } } });
    await fx.save(id, CL(), { packagingUnits: { [unit]: { name: 'Karton' } } });
    await fx.save(id, CL('en-US'), { packagingUnits: { [unit]: { name: null } } });

    expect((await fx.read(id, CL())).packagingUnits[0]!.name).toMatchObject({ value: 'Karton', source: 'set' });
    expect((await fx.read(id, CL('en-US'))).packagingUnits[0]!.name).toMatchObject({ value: null, source: 'set_empty' });
    expect((await fx.read(id, C())).packagingUnits[0]!.name).toMatchObject({ value: 'Box (channel)', source: 'set' });
    expect((await fx.read(id)).packagingUnits[0]!.name).toMatchObject({ value: 'Box', source: 'set' });
  });

  it('refuses an empty attachment or packaging name at Global (the Global name is required there)', async () => {
    const id = await fx.product({ channels: [channel] });
    const { attachment, unit } = await fx.media(id);
    const res = await fx.put(id, {}, { attachments: { [attachment]: { name: null } }, packagingUnits: { [unit]: { name: null } } });
    expect(res.statusCode, res.body).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'SCOPED_VALUE_INVALID' } });
  });
});
