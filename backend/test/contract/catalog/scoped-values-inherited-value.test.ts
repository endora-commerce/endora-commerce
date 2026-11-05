import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174 (owner decision 2026-11-03, round 8; `contracts/scoped-values-api.md` §2) — every
 * field view of `GET …/scoped-values` at Channel and Channel × language carries `inheritedValue`:
 * the value the field would have if it inherited at this scope (the parent's effective value) and
 * where that value comes from. The S3 editor shows it the moment "Use value from <parent>" is
 * ticked. At Global there is no parent, so there is no `inheritedValue`.
 */
describe('174 — inheritedValue on every scoped field view', () => {
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

  it('at Global there is no inheritedValue', async () => {
    const id = await fx.product({ channels: [channel] });
    const data = await fx.read(id);
    expect(data.fields.name).not.toHaveProperty('inheritedValue');
    expect(data.fields.window).not.toHaveProperty('inheritedValue');
  });

  it("at Channel it is Global's value, also while the channel holds its own", async () => {
    const id = await fx.product({ channels: [channel] });
    const { items } = await fx.media(id);
    let data = await fx.read(id, { channelId: channel });
    expect(data.fields.name).toMatchObject({ value: 'Drill X', source: 'inherited_global', inheritedValue: { value: 'Drill X', level: 'G' } });
    data = await fx.save(id, { channelId: channel }, { name: 'Kana\u0142', gallery: { items: { [items[0]]: { altText: 'Kana\u0142owy' } } } });
    expect(data.fields.name).toMatchObject({ value: 'Kana\u0142', source: 'set', inheritedValue: { value: 'Drill X', level: 'G' } });
    expect(data.gallery.items.find((item) => item.id === items[0])!.altText).toMatchObject({
      value: 'Kana\u0142owy',
      inheritedValue: { value: 'Alt 0', level: 'G' },
    });
    // A field with no value anywhere inherits nothing.
    expect(data.fields.minOrderQuantity).toMatchObject({ inheritedValue: { value: null, level: 'G' } });
  });

  it("at Channel \u00d7 language it is the channel's own value when the channel holds one", async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel }, { name: 'Kana\u0142' });
    const data = await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Polski' });
    expect(data.fields.name).toMatchObject({ value: 'Polski', source: 'set', inheritedValue: { value: 'Kana\u0142', level: 'C' } });
  });

  it("at Channel \u00d7 language it is Global's value (the grandparent) when the channel inherits", async () => {
    const id = await fx.product({ channels: [channel] });
    const data = await fx.save(id, { channelId: channel, languageCode: 'en-US' }, { description: 'English' });
    expect(data.fields.description).toMatchObject({
      value: 'English',
      source: 'set',
      inheritedValue: { value: 'Global description', level: 'G' },
    });
  });

  it('a deliberately empty parent is inherited as empty, not skipped to Global', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel }, { description: null });
    const data = await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { description: 'Opis' });
    expect(data.fields.description).toMatchObject({ value: 'Opis', source: 'set', inheritedValue: { value: null, level: 'C' } });
  });
});
