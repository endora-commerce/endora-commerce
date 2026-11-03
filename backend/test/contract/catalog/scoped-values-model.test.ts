import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, US2 (T029; FR-010…FR-018, SC-004) — one three-level model for every field, through
 * `GET|PUT …/products/:id/scoped-values`:
 * - #2 a value at C×L, C and G resolves C×L → C → G with its source;
 * - #4 a Language-only scope does not exist (422 `VALIDATION_FAILED`, `details.field = 'scope'`);
 * - #5 a Channel name is accepted and resolves for every language of the channel;
 * - #8 audience, window, minimum order quantity, returnable and a non-text attribute refuse C×L
 *   (`FIELD_NOT_AT_SCOPE` naming each field and its scope set);
 * - #9 an empty description override stops the fallback;
 * - FR-017 / FR-018 a non-member channel and an unoffered language are `SCOPE_INVALID`; an
 *   orphaned row is retained, never contributes, and does not block the read;
 * - SC-004 a C×L write changes that pair only.
 */
describe('170 US2 — the three-level scope model (T029)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let outsider: string;
  let colour: string;
  let note: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US', 'de-DE']);
    outsider = await fx.channel(['pl-PL']);
    colour = await fx.attribute({ key: 'colour', valueType: 'select', scopable: true, options: ['red', 'blue'] });
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  const overrideRows = (productId: string) =>
    fx.sql<{ attribute_key: string; language_code: string | null; value: unknown }>(
      `select attribute_key, language_code, value from product_value_overrides where product_id = ? order by attribute_key, language_code nulls first`,
      [productId],
    );

  it('#2 / #5 — C×L → C → G with sources; a Channel name resolves for every language', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel }, { name: 'Drill X (channel)' });
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka X' });

    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.name).toMatchObject({
      value: 'Wiertarka X',
      source: 'set',
      ownValue: 'Wiertarka X',
      levels: ['G', 'C', 'CL'],
      supportedHere: true,
      required: true,
    });
    for (const languageCode of ['en-US', 'DE-de']) {
      expect((await fx.read(id, { channelId: channel, languageCode })).fields.name).toMatchObject({
        value: 'Drill X (channel)',
        source: 'inherited_channel',
      });
    }
    expect((await fx.read(id, { channelId: channel })).fields.name).toMatchObject({ value: 'Drill X (channel)', source: 'set' });
    expect((await fx.read(id)).fields.name).toMatchObject({ value: 'Drill X', source: 'set' });
    // The language is stored in the channel's own spelling.
    expect((await overrideRows(id)).map((row) => row.language_code)).toEqual([null, 'pl-PL']);
  });

  it('#4 — a language without a channel is 422 VALIDATION_FAILED on the read and the save', async () => {
    const id = await fx.product({ channels: [channel] });
    const read = await fx.readRaw(id, { languageCode: 'pl-PL' });
    expect(read.statusCode).toBe(422);
    expect(read.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED, details: { field: 'scope' } } });
    const save = await fx.put(id, { languageCode: 'pl-PL' }, { name: 'x' });
    expect(save.statusCode).toBe(422);
    expect(save.json()).toMatchObject({ error: { code: ERROR_CODES.VALIDATION_FAILED, details: { field: 'scope' } } });
  });

  it('#8 — fields without a C×L level are refused there, naming each field and its scope set', async () => {
    const id = await fx.product({ channels: [channel] });
    const res = await fx.put(
      id,
      { channelId: channel, languageCode: 'pl-PL' },
      {
        audience: { visibility: 'public', allowedOrganizationIds: [] },
        window: { from: null, until: null },
        minOrderQuantity: 3,
        returnable: true,
        attributes: { [colour]: 'red' },
      },
    );
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details: { fields: Array<{ field: string; levels: string[] }> } } };
    expect(body.error.code).toBe(ERROR_CODES.FIELD_NOT_AT_SCOPE);
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        { field: 'audience', levels: ['G', 'C'] },
        { field: 'window', levels: ['G', 'C'] },
        { field: 'minOrderQuantity', levels: ['G', 'C'] },
        { field: 'returnable', levels: ['G', 'C'] },
        { field: `attribute:${colour}`, levels: ['G', 'C'] },
      ]),
    );
    expect(await overrideRows(id)).toEqual([]);
    // …and the same fields are accepted at the Channel.
    await fx.save(id, { channelId: channel }, { returnable: true, attributes: { [colour]: 'blue' } });
    const data = await fx.read(id, { channelId: channel, languageCode: 'pl-PL' });
    expect(data.fields.returnable).toMatchObject({ value: true, source: 'inherited_channel', supportedHere: false });
    expect(data.attributes.find((a) => a.key === colour)?.view).toMatchObject({ value: 'blue', source: 'inherited_channel' });
  });

  it('#9 — an empty description override stops the fallback', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel }, { description: 'Channel text' });
    await fx.save(id, { channelId: channel, languageCode: 'en-US' }, { description: null });
    expect((await fx.read(id, { channelId: channel, languageCode: 'en-US' })).fields.description).toMatchObject({
      value: null,
      source: 'set_empty',
      ownValue: null,
    });
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.description).toMatchObject({
      value: 'Channel text',
      source: 'inherited_channel',
    });
    // `inherit` removes the own value again.
    await fx.save(id, { channelId: channel, languageCode: 'en-US' }, { description: { inherit: true } });
    expect((await fx.read(id, { channelId: channel, languageCode: 'en-US' })).fields.description).toMatchObject({
      value: 'Channel text',
      source: 'inherited_channel',
    });
  });

  it('FR-017 — a non-member channel and an unoffered language are SCOPE_INVALID', async () => {
    const id = await fx.product({ channels: [channel] });
    const notMember = await fx.readRaw(id, { channelId: outsider });
    expect(notMember.statusCode).toBe(422);
    expect(notMember.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'not_a_member' } } });
    const notOffered = await fx.put(id, { channelId: channel, languageCode: 'fr-FR' }, { name: 'Perceuse' });
    expect(notOffered.statusCode).toBe(422);
    expect(notOffered.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'language_not_offered' } } });
  });

  it('FR-018 — an orphaned row is retained and never contributes', async () => {
    const id = await fx.product({ channels: [channel] });
    // A row at a channel the product is not (or no longer) a member of, and one at a language the
    // channel does not offer: both orphans.
    await fx.sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'name', ?, 'pl-PL', '{"v":"Orphan channel"}'::jsonb, now(), now()),
              (gen_random_uuid(), ?, 'name', ?, 'fr-FR', '{"v":"Orphan language"}'::jsonb, now(), now())`,
      [id, outsider, id, channel],
    );
    const data = await fx.read(id);
    const valid = data.validScopes.channels.map((c) => c.channelId);
    expect(valid).toContain(channel);
    expect(valid).not.toContain(outsider);
    expect(data.validScopes.channels.find((c) => c.channelId === channel)?.languages.map((l) => l.code)).not.toContain('fr-FR');
    expect(data.fields.name).toMatchObject({ value: 'Drill X', source: 'set' });
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.name).toMatchObject({
      value: 'Drill X',
      source: 'inherited_global',
    });
    // A save elsewhere keeps both orphans.
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka' });
    expect((await overrideRows(id)).map((row) => (row.value as { v: string }).v).sort()).toEqual([
      'Orphan channel',
      'Orphan language',
      'Wiertarka',
    ]);
  });

  it('SC-004 — a C×L write changes that pair only', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { attributes: { [note]: 'PL' } });
    await fx.save(id, { channelId: channel, languageCode: 'de-DE' }, { attributes: { [note]: 'DE' } });
    const before = await overrideRows(id);
    await fx.save(id, { channelId: channel, languageCode: 'en-US' }, { attributes: { [note]: 'EN' } });
    const after = await overrideRows(id);
    expect(after.filter((row) => row.language_code !== 'en-US')).toEqual(before);
    expect(after.find((row) => row.language_code === 'en-US')).toMatchObject({ value: { v: 'EN' } });
  });
});
