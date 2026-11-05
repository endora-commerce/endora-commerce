import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES, scopeOverviewResponseSchema, type ScopeOverviewResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 174, US2 (T045; FR-100 backend half, FR-101) — the scope overview on the three-level
 * model, and its orphan deletion.
 *
 * - FR-100: the overview names an override at a cell (C×L) or at the whole channel (C) only —
 *   there is no Language level (`scopeLevelSchema`), and a Channel name is listed at C;
 * - FR-101: every orphan the overview lists can still be removed. 163 removed a value-override
 *   orphan through `PATCH …/value-overrides`, retired by T043; in 174 the removal is an
 *   `{ inherit: true }` through `PUT …/scoped-values` at the orphan's own scope — accepted there
 *   for removal only (163 FR-015: removing is always allowed), while a value at that scope is
 *   still `422 SCOPE_INVALID` (FR-017). That covers a channel the product left (`not_a_member`), a
 *   language the channel dropped (`language_not_offered`), an attribute whose scope set lost the
 *   level (`attribute_scope_changed`) and a gallery role held at an orphaned scope.
 */
describe('174 US2 — scope overview and orphan removal (T045, FR-100, FR-101)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let left: string;
  let note: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US', 'de-DE']);
    left = await fx.channel(['pl-PL']);
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  async function overview(productId: string): Promise<ScopeOverviewResponse['data']> {
    const res = await h.app.inject({ method: 'GET', url: `/api/v1/admin/catalog/products/${productId}/scope-overview`, ...ADMIN });
    expect(res.statusCode, res.body).toBe(200);
    return scopeOverviewResponseSchema.parse(res.json()).data;
  }

  /** A save naming the version read at Global — the orphan's own scope cannot be read. */
  async function putAt(productId: string, scope: { channelId: string; languageCode?: string }, changes: unknown) {
    const { version } = await fx.read(productId);
    return fx.put(productId, scope, changes, { version });
  }

  const overrideRows = (productId: string) =>
    fx.sql<{ attribute_key: string; channel_id: string; language_code: string | null }>(
      `select attribute_key, channel_id::text as channel_id, language_code from product_value_overrides
        where product_id = ? order by attribute_key, channel_id, language_code nulls first`,
      [productId],
    );

  it('FR-100 — overrides sit at C or C×L; a Channel name is listed at the channel row and in its cells', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel }, { name: 'Channel name' });
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { description: 'Opis' });
    const data = await overview(id);
    expect(data.channelRows.find((row) => row.channelId === channel)?.overriddenFields).toContain('name');
    const pl = data.cells.find((cell) => cell.channelId === channel && cell.languageCode === 'pl-PL')!;
    expect(pl.overriddenFields).toEqual(
      expect.arrayContaining([
        { field: 'name', level: 'channel' },
        { field: 'description', level: 'channel_language' },
      ]),
    );
    const levels = new Set(data.cells.flatMap((cell) => cell.overriddenFields.map((field) => field.level)));
    expect([...levels].sort()).toEqual(['channel', 'channel_language']);
    expect(data.orphans).toEqual([]);
  });

  it('FR-101 — a value override at a channel the product left is listed and removed by inherit; a value there stays refused', async () => {
    const id = await fx.product({ channels: [channel, left] });
    await fx.save(id, { channelId: left, languageCode: 'pl-PL' }, { name: 'Left behind' });
    await fx.sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, id]);
    expect((await overview(id)).orphans).toEqual([
      { field: 'name', channelId: left, languageCode: 'pl-PL', reason: 'not_a_member' },
    ]);

    const write = await putAt(id, { channelId: left, languageCode: 'pl-PL' }, { name: 'Still here' });
    expect(write.statusCode).toBe(422);
    expect(write.json()).toMatchObject({ error: { code: ERROR_CODES.SCOPE_INVALID, details: { reason: 'not_a_member' } } });

    const removed = await putAt(id, { channelId: left, languageCode: 'pl-PL' }, { name: { inherit: true } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await overrideRows(id)).toEqual([]);
    expect((await overview(id)).orphans).toEqual([]);
  });

  it('FR-101 — a value override at a language the channel dropped is removed by inherit', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'description', ?, 'fr-FR', '{"v":"Orphelin"}'::jsonb, now(), now())`,
      [id, channel],
    );
    expect((await overview(id)).orphans).toEqual([
      { field: 'description', channelId: channel, languageCode: 'fr-FR', reason: 'language_not_offered' },
    ]);
    const removed = await putAt(id, { channelId: channel, languageCode: 'fr-FR' }, { description: { inherit: true } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await overrideRows(id)).toEqual([]);
  });

  it('FR-101 — an attribute override its scope set no longer allows is removed by inherit', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel, languageCode: 'de-DE' }, { attributes: { [note]: 'Notiz' } });
    const narrowed = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/attributes/${note}`,
      ...ADMIN,
      payload: { scopable: false },
    });
    expect(narrowed.statusCode, narrowed.body).toBe(200);
    try {
      expect((await overview(id)).orphans).toEqual([
        { field: `attribute:${note}`, channelId: channel, languageCode: 'de-DE', reason: 'attribute_scope_changed' },
      ]);
      // Writing it there is still refused…
      const write = await putAt(id, { channelId: channel, languageCode: 'de-DE' }, { attributes: { [note]: 'Neu' } });
      expect(write.statusCode).toBe(422);
      expect(write.json()).toMatchObject({ error: { code: ERROR_CODES.FIELD_NOT_AT_SCOPE } });
      // …removing it is not.
      const removed = await putAt(id, { channelId: channel, languageCode: 'de-DE' }, { attributes: { [note]: { inherit: true } } });
      expect(removed.statusCode, removed.body).toBe(200);
      expect(await overrideRows(id)).toEqual([]);
    } finally {
      await h.app.inject({ method: 'PATCH', url: `/api/v1/admin/catalog/attributes/${note}`, ...ADMIN, payload: { scopable: true } });
    }
  });

  it('FR-101 — a gallery role held at a channel the product left is removed by inherit', async () => {
    const id = await fx.product({ channels: [channel, left] });
    const { items } = await fx.media(id);
    await fx.save(id, { channelId: left }, { gallery: { roles: { thumbnail: items[1] } } });
    await fx.sql(`delete from sales_channel_products where sales_channel_id = ? and product_id = ?`, [left, id]);
    expect((await overview(id)).orphans).toEqual([
      { field: 'media:roles', channelId: left, languageCode: null, reason: 'not_a_member' },
    ]);
    const removed = await putAt(id, { channelId: left }, { gallery: { roles: { thumbnail: { inherit: true } } } });
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await overview(id)).orphans).toEqual([]);
  });
});
