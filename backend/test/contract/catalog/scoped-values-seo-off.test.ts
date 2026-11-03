import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, US10 (T122; FR-090…FR-092, Principle XVII) — the editor's SEO block on
 * `GET …/scoped-values`, and `seo` switched off:
 *
 * - with `seo` on, the read carries `seo`'s view of the five fields at the read's scope
 *   (`seoProductMetaPort.readScoped`), sources included;
 * - with `seo` off, the read answers `seo: null`, a save without SEO succeeds, and the rows `seo`
 *   holds come back unchanged when it is switched on again;
 * - a save **with** SEO while `seo` is off is `503 MODULE_DISABLED` and writes nothing (save
 *   step 8 resolves `seoProductMetaWritePort`, `refuses-without`).
 */
describe('170 US10 — the SEO block of the scoped read, and seo off (T122)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let id: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    id = await fx.product({ channels: [channel] });
    await fx.sql(
      `insert into seo_meta_overrides (id, entity_type, entity_id, sales_channel_id, locale, title, description, created_at, updated_at)
       values (?, 'product', ?, ?, 'pl-PL', 'Wiertarka SEO', null, now(), now()),
              (?, 'product', ?, ?, null, null, 'Opis kanału', now(), now())`,
      [randomUUID(), id, channel, randomUUID(), id, channel],
    );
  });

  afterAll(async () => {
    if (h) {
      await fx.sql(`delete from seo_meta_overrides where entity_id = ?`, [id]);
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it("carries seo's view at the read's scope while seo is on", async () => {
    const pl = await fx.read(id, { channelId: channel, languageCode: 'pl-PL' });
    expect(pl.seo).not.toBeNull();
    expect(pl.seo!.title).toMatchObject({ value: 'Wiertarka SEO', source: 'set' });
    expect(pl.seo!.description).toMatchObject({ value: 'Opis kanału', source: 'inherited_channel' });
    const atChannel = await fx.read(id, { channelId: channel });
    expect(atChannel.seo!.description).toMatchObject({ value: 'Opis kanału', source: 'set' });
    expect((await fx.read(id)).seo).not.toBeNull();
  });

  it('answers seo: null while seo is off; a save without SEO still succeeds; the rows come back', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).seo).toBeNull();
      const saved = await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka' });
      expect(saved.fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
      expect(saved.seo).toBeNull();
    });
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).seo!.title).toMatchObject({
      value: 'Wiertarka SEO',
      source: 'set',
    });
  });

  it('refuses a save with SEO while seo is off (503 MODULE_DISABLED) and writes nothing', async () => {
    await withModuleOff('seo', 'deactivated', async () => {
      const res = await fx.put(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Nowa', seo: { title: 'Nowy' } });
      expect(res.statusCode, res.body).toBe(503);
      expect(res.json()).toMatchObject({ error: { code: 'MODULE_DISABLED' } });
    });
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.name.value).not.toBe('Nowa');
  });
});
