import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, US11 (T127; FR-095…FR-097; `contracts/scoped-values-api.md` §2.1) — what
 * `GET …/scoped-values` says is missing at the read's scope:
 *
 * - at Channel × language, the list of missing values there;
 * - at Channel, each missing field with the channel's languages that lack it;
 * - at Global, the number of (channel, language) pairs of the product's channels that are
 *   incomplete;
 * - a Global value satisfies every (C, L); an empty override at C does not (FR-095, FR-096).
 */
describe('170 US11 — the completeness summary per level (T127)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let a: string;
  let b: string;
  let spec: string;
  let id: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    a = await fx.channel(['pl-PL', 'en-US']);
    b = await fx.channel(['pl-PL']);
    spec = await fx.attribute({ key: 'cmpl_spec', valueType: 'string', scopable: true, isRequired: true });
    id = await fx.product({ channels: [a, b] });
    // Only the two channels of this test: the create also files the product under the default channel.
    await fx.sql(`delete from sales_channel_products where product_id = ? and sales_channel_id not in (?, ?)`, [id, a, b]);
    // The required attribute only at (a, pl-PL); a deliberately empty name at Channel b.
    await fx.sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, ?, ?, 'pl-PL', '{"v":"Stal"}'::jsonb, now(), now()),
              (gen_random_uuid(), ?, 'name', ?, null, '{"v":null}'::jsonb, now(), now())`,
      [id, spec, a, id, b],
    );
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('Channel × language: the values missing at that pair', async () => {
    expect((await fx.read(id, { channelId: a, languageCode: 'pl-PL' })).completeness).toEqual({
      level: 'channel_language',
      missing: [],
    });
    expect((await fx.read(id, { channelId: a, languageCode: 'en-US' })).completeness).toEqual({
      level: 'channel_language',
      missing: [`attribute:${spec}`],
    });
  });

  it('Channel: each missing field with the languages that lack it; an empty name override counts as missing', async () => {
    expect((await fx.read(id, { channelId: a })).completeness).toEqual({
      level: 'channel',
      missing: [{ field: `attribute:${spec}`, languages: ['en-US'] }],
    });
    expect((await fx.read(id, { channelId: b })).completeness).toEqual({
      level: 'channel',
      missing: [
        { field: 'name', languages: ['pl-PL'] },
        { field: `attribute:${spec}`, languages: ['pl-PL'] },
      ],
    });
  });

  it('Global: the number of incomplete (channel, language) pairs', async () => {
    expect((await fx.read(id)).completeness).toEqual({ level: 'global', incompleteScopes: 2 });
  });

  it('a Global value satisfies every (C, L) that does not override it', async () => {
    await fx.save(id, {}, { attributes: { [spec]: 'Stal (G)' } });
    expect((await fx.read(id, { channelId: a, languageCode: 'en-US' })).completeness).toEqual({
      level: 'channel_language',
      missing: [],
    });
    expect((await fx.read(id, { channelId: b })).completeness).toEqual({
      level: 'channel',
      missing: [{ field: 'name', languages: ['pl-PL'] }],
    });
    expect((await fx.read(id)).completeness).toEqual({ level: 'global', incompleteScopes: 1 });
  });
});
