import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type ScopedValuesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type Scope, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172 final QA (FR-010, FR-011, FR-017, FR-062, FR-110, FR-113, SC-009) — the deliberately
 * empty value, at EVERY level each field family supports, through the one save:
 *
 * - an optional scopable field written `null` is an empty override at C and C×L (`set_empty`,
 *   value `null`) and no value at all at Global (`absent`);
 * - an empty override stops the fallback for the levels below it, and `{ inherit: true }` removes it;
 * - a required field (name, URL key, a required attribute) refuses `null` at every level it has,
 *   `422 SCOPED_VALUE_INVALID`, and nothing is written.
 */
describe('172 QA — the empty override at each level for each field family', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  // A second fixture, so its attribute set (holding the required attribute) is not shared: a Global save
  // that carries attributes checks every required attribute of the set, staged or not.
  let fxRequired: ScopedValuesFixture;
  let channel: string;
  let text: string;
  let required: string;
  let numeric: string;
  let date: string;

  const G: Scope = {};
  const C = (): Scope => ({ channelId: channel });
  const CL = (): Scope => ({ channelId: channel, languageCode: 'pl-PL' });

  const attr = (d: ScopedValuesResponse['data'], key: string) => d.attributes.find((a) => a.key === key)!.view;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    text = await fx.attribute({ key: 'qtext', valueType: 'string', scopable: true });
    numeric = await fx.attribute({ key: 'qnum', valueType: 'number', scopable: true });
    date = await fx.attribute({ key: 'qdate', valueType: 'date', scopable: true });
    fxRequired = scopedValuesFixture(() => h);
    required = await fxRequired.attribute({ key: 'qreq', valueType: 'string', scopable: true, isRequired: true });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await fxRequired.cleanup();
      await teardownBackendServer(h);
    }
  });

  const LEVELS: Array<[string, () => Scope]> = [
    ['Global', () => G],
    ['Channel', C],
    ['Channel × language', CL],
  ];

  const expectEmptyAt = (view: { value: unknown; source: string }, level: string) =>
    expect(view, level).toMatchObject(level === 'Global' ? { value: null, source: 'absent' } : { value: null, source: 'set_empty' });

  describe.each(LEVELS)('at %s', (level, scope) => {
    it('description: null is the empty override (no value at Global)', async () => {
      const id = await fx.product({ channels: [channel] });
      await fx.save(id, scope(), { description: 'Seed' });
      const data = await fx.save(id, scope(), { description: null });
      expectEmptyAt(data.fields.description, level);
    });

    it('SEO title and description: null is the empty override (no value at Global)', async () => {
      const id = await fx.product({ channels: [channel] });
      await fx.save(id, scope(), { seo: { title: 'Seed title', description: 'Seed description' } });
      const data = await fx.save(id, scope(), { seo: { title: null, description: null } });
      expectEmptyAt(data.seo!.title, level);
      expectEmptyAt(data.seo!.description, level);
      await fx.sql(`delete from seo_meta_overrides where entity_id = ?`, [id]);
    });

    it('a text attribute: null is the empty override (no value at Global)', async () => {
      const id = await fx.product({ channels: [channel] });
      await fx.save(id, scope(), { attributes: { [text]: 'Seed' } });
      const data = await fx.save(id, scope(), { attributes: { [text]: null } });
      expectEmptyAt(attr(data, text), level);
    });

    it('name, URL key and a required attribute refuse null, and nothing is written', async () => {
      const id = await fxRequired.product({ channels: [channel] });
      await fxRequired.save(id, scope(), { name: 'Seed name', attributes: { [required]: 'Seed' } });
      const before = await fxRequired.read(id, scope());
      for (const [field, changes] of [
        ['name', { name: null }],
        ['urlKey', { urlKey: null }],
        [`attribute:${required}`, { attributes: { [required]: null } }],
      ] as const) {
        const res = await fxRequired.put(id, scope(), changes);
        expect(res.statusCode, `${field}: ${res.body}`).toBe(422);
        const body = res.json() as { error: { code: string; details: { fields: Array<{ field: string }> } } };
        expect(body.error.code, field).toBe(ERROR_CODES.SCOPED_VALUE_INVALID);
        expect(body.error.details.fields.map((f) => f.field), field).toContain(field);
      }
      const after = await fxRequired.read(id, scope());
      expect(after.fields.name).toEqual(before.fields.name);
      expect(attr(after, required)).toEqual(attr(before, required));
      expect(after.version).toBe(before.version);
    });

    it('INHERIT at Global is refused for every field family; below Global it removes the own value', async () => {
      const id = await fx.product({ channels: [channel] });
      const res = await fx.put(id, scope(), {
        description: { inherit: true },
        attributes: { [text]: { inherit: true } },
      });
      if (level === 'Global') {
        expect(res.statusCode, res.body).toBe(422);
        const body = res.json() as { error: { code: string; details: { fields: Array<{ field: string; reason: string }> } } };
        expect(body.error.code).toBe(ERROR_CODES.SCOPED_VALUE_INVALID);
        expect(body.error.details.fields.map((f) => f.reason)).toEqual(['inherit_at_global', 'inherit_at_global']);
      } else {
        expect(res.statusCode, res.body).toBe(200);
      }
    });
  });

  describe.each([
    ['a number attribute', () => numeric, 5],
    ['a date attribute', () => date, '2026-01-31'],
  ] as const)('%s (levels Global and Channel only)', (_name, key, seed) => {
    it.each(LEVELS.slice(0, 2))('null at %s is the empty override (no value at Global)', async (level, scope) => {
      const id = await fx.product({ channels: [channel] });
      await fx.save(id, scope(), { attributes: { [key()]: seed } });
      const data = await fx.save(id, scope(), { attributes: { [key()]: null } });
      expectEmptyAt(attr(data, key()), level);
    });

    it('is refused at Channel × language, naming the field', async () => {
      const id = await fx.product({ channels: [channel] });
      const res = await fx.put(id, CL(), { attributes: { [key()]: seed } });
      expect(res.statusCode, res.body).toBe(422);
      expect((res.json() as { error: { code: string } }).error.code).toBe(ERROR_CODES.FIELD_NOT_AT_SCOPE);
    });
  });

  it('an empty override at Channel stops the fallback below it; inherit removes it (description, text attribute, SEO)', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, G, { description: 'Global text', attributes: { [text]: 'Global attr' }, seo: { title: 'Global seo' } });
    await fx.save(id, C(), { description: null, attributes: { [text]: null }, seo: { title: null } });
    const below = await fx.read(id, CL());
    expect(below.fields.description).toMatchObject({ value: null, source: 'inherited_channel' });
    expect(attr(below, text)).toMatchObject({ value: null, source: 'inherited_channel' });
    expect(below.seo!.title).toMatchObject({ value: null, source: 'inherited_channel' });

    await fx.save(id, C(), { description: { inherit: true }, attributes: { [text]: { inherit: true } }, seo: { title: { inherit: true } } });
    const back = await fx.read(id, CL());
    expect(back.fields.description).toMatchObject({ value: 'Global text', source: 'inherited_global' });
    expect(attr(back, text)).toMatchObject({ value: 'Global attr', source: 'inherited_global' });
    expect(back.seo!.title).toMatchObject({ value: 'Global seo', source: 'inherited_global' });
    await fx.sql(`delete from seo_meta_overrides where entity_id = ?`, [id]);
  });
});
