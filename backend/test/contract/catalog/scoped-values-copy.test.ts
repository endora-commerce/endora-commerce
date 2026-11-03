import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, type CopyScopedValueResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { seedProductScopesAdmins } from '../../helpers/product-scopes-admins.js';

/**
 * Feature 170, US9 (T114; FR-086, R21; `contracts/scoped-values-api.md` §4) —
 * `POST /api/v1/admin/catalog/products/:id/scoped-values/copy`, "Copy to other channels":
 *
 * - `dryRun` lists the targets whose own value the copy overwrites, writes nothing, bumps no
 *   version and audits nothing;
 * - a copy writes every target in one Command (`product.scoped_values.copy_to_channels`) and one
 *   audit entry, the version compare-and-set first (stale → `409 VERSION_CONFLICT`);
 * - the source's own value is copied, `set` or `empty`; `empty` only to an optional field
 *   (`required_empty`); a source without an own value is `source_inherits`;
 * - a target the product is not a member of, or one that does not offer the language, is
 *   `SCOPE_INVALID` and nothing is written (all-or-nothing);
 * - `toChannelIds` deduplicated (and the source channel itself skipped); `urlKey` and non-text
 *   fields are `not_supported`; `catalog:read` is 403.
 */
describe('170 US9 — copy a C×L value to other channels (T114)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let source: string;
  let b: string;
  let c: string;
  let noPolish: string;
  let outsider: string;
  let note: string;
  let colour: string;
  const url = (id: string) => `/api/v1/admin/catalog/products/${id}/scoped-values/copy`;

  const copy = (id: string, body: Record<string, unknown>, who = ADMIN) =>
    h.app.inject({ method: 'POST', url: url(id), ...who, payload: body });
  const versionOf = async (id: string) => (await fx.read(id)).version;
  const audits = (id: string) =>
    fx.sql<{ state_before: Record<string, unknown>; state_after: Record<string, unknown> }>(
      `select state_before, state_after from audit_log_entries
        where object_type = 'product' and object_id = ? and action = 'product.scoped_values.copy_to_channels' order by acted_at`,
      [id],
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    // The catalogue reader's stub session answers 403 only once its admin row exists.
    await seedProductScopesAdmins(h);
    source = await fx.channel(['pl-PL', 'en-US']);
    b = await fx.channel(['pl-PL']);
    c = await fx.channel(['pl-PL', 'de-DE']);
    noPolish = await fx.channel(['de-DE']);
    outsider = await fx.channel(['pl-PL']);
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
    colour = await fx.attribute({ key: 'colour', valueType: 'select', scopable: true, options: ['red'] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  async function seeded(): Promise<string> {
    const id = await fx.product({ channels: [source, b, c, noPolish] });
    await fx.save(id, { channelId: source, languageCode: 'pl-PL' }, { name: 'Wiertarka', description: null, attributes: { [note]: 'Notatka' } });
    await fx.save(id, { channelId: c, languageCode: 'pl-PL' }, { name: 'Stara nazwa' });
    return id;
  }

  it('dryRun lists the overwrites and is side-effect free', async () => {
    const id = await seeded();
    const version = await versionOf(id);
    const res = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b, c], version, dryRun: true });
    expect(res.statusCode, res.body).toBe(200);
    expect((res.json() as CopyScopedValueResponse).data).toEqual({
      overwrites: [{ channelId: c, currentValue: 'Stara nazwa' }],
      applied: 0,
      version,
    });
    expect(await versionOf(id)).toBe(version);
    expect(await audits(id)).toEqual([]);
    expect((await fx.read(id, { channelId: b, languageCode: 'pl-PL' })).fields.name.source).toBe('inherited_global');
  });

  it('copies to every target in one Command and one audit entry; the version moves', async () => {
    const id = await seeded();
    const version = await versionOf(id);
    const res = await copy(id, {
      field: 'name',
      from: { channelId: source, languageCode: 'PL-pl' },
      toChannelIds: [b, c, b, source],
      version,
    });
    expect(res.statusCode, res.body).toBe(200);
    const data = (res.json() as CopyScopedValueResponse).data;
    expect(data.applied).toBe(2);
    expect(data.overwrites).toEqual([{ channelId: c, currentValue: 'Stara nazwa' }]);
    expect(data.version).not.toBe(version);
    for (const target of [b, c]) {
      expect((await fx.read(id, { channelId: target, languageCode: 'pl-PL' })).fields.name).toMatchObject({ value: 'Wiertarka', source: 'set' });
    }
    const entries = await audits(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state_before['cells']).toEqual({ [`name@CL:${b}/pl-PL`]: { inherited: true }, [`name@CL:${c}/pl-PL`]: 'Stara nazwa' });
    expect(entries[0]!.state_after['cells']).toEqual({ [`name@CL:${b}/pl-PL`]: 'Wiertarka', [`name@CL:${c}/pl-PL`]: 'Wiertarka' });
  });

  it('copies an empty value to an optional field; an attribute value too', async () => {
    const id = await seeded();
    const res = await copy(id, { field: 'description', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b], version: await versionOf(id) });
    expect(res.statusCode, res.body).toBe(200);
    expect((await fx.read(id, { channelId: b, languageCode: 'pl-PL' })).fields.description).toMatchObject({ value: null, source: 'set_empty' });
    const attr = await copy(id, { field: `attribute:${note}`, from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [c], version: await versionOf(id) });
    expect(attr.statusCode, attr.body).toBe(200);
    expect((await fx.read(id, { channelId: c, languageCode: 'pl-PL' })).attributes.find((a) => a.key === note)?.view.value).toBe('Notatka');
  });

  it('refuses a source without an own value (source_inherits) and an empty value for a required field', async () => {
    const id = await seeded();
    const inherits = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'en-US' }, toChannelIds: [b], version: await versionOf(id) });
    expect(inherits.statusCode).toBe(422);
    expect(inherits.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ reason: 'source_inherits' }] } } });
    // An empty name cannot exist as a source (required), so the required rule is tested on a planted row.
    await fx.sql(`update product_value_overrides set value = '{"v":null}'::jsonb where product_id = ? and attribute_key = 'name' and channel_id = ?`, [id, source]);
    const required = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b], version: await versionOf(id) });
    expect(required.statusCode).toBe(422);
    expect(required.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ reason: 'required_empty' }] } } });
  });

  it('refuses a target outside the product or without the language, writing nothing (all-or-nothing)', async () => {
    const id = await seeded();
    for (const bad of [outsider, noPolish]) {
      const res = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b, bad], version: await versionOf(id) });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID, details: { channelId: bad } } });
    }
    const notMember = await copy(id, { field: 'name', from: { channelId: outsider, languageCode: 'pl-PL' }, toChannelIds: [b], version: await versionOf(id) });
    expect(notMember.statusCode).toBe(422);
    expect((await fx.read(id, { channelId: b, languageCode: 'pl-PL' })).fields.name.source).toBe('inherited_global');
    expect(await audits(id)).toEqual([]);
  });

  it('refuses urlKey and non-text fields as not_supported, a stale version with 409, catalog:read with 403', async () => {
    const id = await seeded();
    const version = await versionOf(id);
    for (const field of ['urlKey', `attribute:${colour}`, 'status']) {
      const res = await copy(id, { field, from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b], version });
      expect(res.statusCode, field).toBe(422);
      expect(res.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPED_VALUE_INVALID, details: { fields: [{ reason: 'not_supported' }] } } });
    }
    const stale = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b], version: '999999' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: ERROR_CODES.VERSION_CONFLICT } });
    const reader = { cookies: { b2b_session: 'stub-product-scopes-reader-session' } };
    const forbidden = await copy(id, { field: 'name', from: { channelId: source, languageCode: 'pl-PL' }, toChannelIds: [b], version }, reader);
    expect(forbidden.statusCode).toBe(403);
    expect(await audits(id)).toEqual([]);
  });
});
