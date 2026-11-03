import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRODUCT_DESCRIPTION_MAX,
  PRODUCT_NAME_MAX,
  type CatalogProductScopeWritePort,
  type ProductScopedWriteCell,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 170, US4 (T077; `contracts/pim-locale-mapping.md` §4, R13a, R21; FR-044, US4 #6) — the
 * connector's scoped write, `catalogProductScopeWritePort.applyScopes` v2:
 *
 * - only the named (field, scope) cells are touched — a Global-only write keeps every operator
 *   override (US4 #6, FR-044);
 * - the allowlist: name, description, `attribute:*`, gallery alt text, attachment name /
 *   description, packaging-unit name, URL key, status, window; every other family — audience,
 *   `product.*`, `seo:*`, `galleryRole:*`, hidden, minimum order quantity, returnable — is refused
 *   `not_supported`, one test per family;
 * - every value is checked against its field's own schema (lengths, types, options) and
 *   `validateScopedWrite` (`required_empty`, `inherit_at_global`), per cell, the rest applied;
 * - every subject id must be the product's (`subject_not_found`), a channel the product's
 *   (`SCOPE_INVALID`), a level the field's (`FIELD_NOT_AT_SCOPE`);
 * - the call is refused whole for an unregistered `source`, more than 2 000 cells or a duplicate
 *   (field, scope);
 * - one audit entry per call (`product.scoped_values.import`, `source` in it), the version bumped,
 *   `product.updated.v1` once; a call that applies nothing audits and bumps nothing;
 * - a URL key goes through the URL-key service in `integration` mode: a held key is reported,
 *   never taken over.
 */
describe('170 US4 — catalogProductScopeWritePort v2 (T077)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let outsider: string;
  let note: string;
  let colour: string;
  const SOURCE = 'pim_connector';

  const port = () =>
    (h.container.cradle as unknown as { catalogProductScopeWritePort: CatalogProductScopeWritePort }).catalogProductScopeWritePort;
  const apply = (productId: string, cells: ProductScopedWriteCell[], source = SOURCE) =>
    withSystemScope('170 scope write port v2 test', () => port().applyScopes(productId, { cells }, { source }));

  const G = { level: 'global' } as const;
  const C = () => ({ level: 'channel', channelId: channel }) as const;
  const CL = (languageCode: string) => ({ level: 'channel_language', channelId: channel, languageCode }) as const;
  const set = (value: unknown) => ({ op: 'set', value }) as const;

  const audits = (productId: string) =>
    fx.sql<{ action: string; state_before: Record<string, unknown>; state_after: Record<string, unknown> }>(
      `select action, state_before, state_after from audit_log_entries
        where object_type = 'product' and object_id = ? and action = 'product.scoped_values.import' order by acted_at`,
      [productId],
    );
  const version = async (productId: string) =>
    (await fx.sql<{ v: string }>(`select scope_version::text as v from products where id = ?`, [productId]))[0]!.v;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    outsider = await fx.channel(['pl-PL']);
    note = await fx.attribute({ key: 'note', valueType: 'string', scopable: true });
    colour = await fx.attribute({ key: 'colour', valueType: 'select', scopable: true, options: ['red', 'blue'] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('US4 #6 — a Global-only write keeps every operator override; only the named cells change', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Wiertarka (operator)', description: 'Opis' });
    await fx.save(id, { channelId: channel }, { attributes: { [note]: 'Channel note' } });
    const before = await version(id);
    const events: string[][] = [];
    const off = h.eventBus.on('product.updated.v1', (payload) => {
      const p = payload as unknown as { productId: string; changedFields: string[] };
      if (p.productId === id) events.push(p.changedFields);
    });
    const result = await apply(id, [
      { scope: G, field: 'name', op: set('Drill X (PIM)') },
      { scope: G, field: 'description', op: set('From the PIM') },
    ]);
    off();
    expect(result).toEqual({ applied: 2, refused: [], urlKeys: [] });
    const pl = await fx.read(id, { channelId: channel, languageCode: 'pl-PL' });
    expect(pl.fields.name).toMatchObject({ value: 'Wiertarka (operator)', source: 'set' });
    expect(pl.fields.description).toMatchObject({ value: 'Opis', source: 'set' });
    expect(pl.attributes.find((a) => a.key === note)?.view).toMatchObject({ value: 'Channel note', source: 'inherited_channel' });
    expect((await fx.read(id)).fields.name).toMatchObject({ value: 'Drill X (PIM)', source: 'set' });
    // One audit entry naming the source, the version bumped, one event.
    const entries = await audits(id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.state_after).toMatchObject({ source: SOURCE });
    expect(entries[0]!.state_after['cells']).toMatchObject({ 'name@G': 'Drill X (PIM)', 'description@G': 'From the PIM' });
    expect(BigInt(await version(id))).toBe(BigInt(before) + 1n);
    expect(events).toHaveLength(1);
    expect([...events[0]!].sort()).toEqual(['description', 'name']);
  });

  it('writes every allowed family at its scopes in one Command', async () => {
    const id = await fx.product({ channels: [channel] });
    const { items, attachment, unit } = await fx.media(id);
    const result = await apply(id, [
      { scope: CL('pl-PL'), field: 'name', op: set('Wiertarka') },
      { scope: C(), field: 'description', op: { op: 'empty' } },
      { scope: CL('pl-PL'), field: `attribute:${note}`, op: set('Notatka') },
      { scope: C(), field: `attribute:${colour}`, op: set('blue') },
      { scope: CL('pl-PL'), field: `gallery:${items[0]}:altText`, op: set('Wiertarka, przód') },
      { scope: CL('pl-PL'), field: `attachment:${attachment}:name`, op: set('Karta katalogowa') },
      { scope: C(), field: `attachment:${attachment}:description`, op: set('Specyfikacja') },
      { scope: CL('pl-PL'), field: `packagingUnit:${unit}:name`, op: set('Karton') },
      { scope: C(), field: 'status', op: set('inactive') },
      { scope: CL('en-US'), field: 'status', op: set('active') },
      { scope: C(), field: 'window', op: set({ from: '2027-01-01T00:00:00.000Z', until: null }) },
      { scope: CL('pl-PL'), field: 'urlKey', op: set(`wiertarka-${fx.run}`) },
    ]);
    expect(result.refused).toEqual([]);
    expect(result.applied).toBe(12);
    expect(result.urlKeys).toEqual([{ written: true }]);
    const pl = await fx.read(id, { channelId: channel, languageCode: 'pl-PL' });
    expect(pl.fields.name.value).toBe('Wiertarka');
    expect(pl.fields.description).toMatchObject({ value: null, source: 'inherited_channel' });
    expect(pl.fields.urlKey.value).toBe(`wiertarka-${fx.run}`);
    expect(pl.fields.status.value).toBe('inactive');
    expect(pl.fields.window.value).toEqual({ from: '2027-01-01T00:00:00.000Z', until: null });
    expect(pl.attributes.find((a) => a.key === note)?.view.value).toBe('Notatka');
    expect(pl.attributes.find((a) => a.key === colour)?.view.value).toBe('blue');
    expect(pl.gallery.items.find((i) => i.id === items[0])?.altText.value).toBe('Wiertarka, przód');
    expect(pl.attachments[0]).toMatchObject({ name: { value: 'Karta katalogowa' }, description: { value: 'Specyfikacja' } });
    expect(pl.packagingUnits[0]!.name.value).toBe('Karton');
    expect((await fx.read(id, { channelId: channel, languageCode: 'en-US' })).fields.status.value).toBe('active');
    expect(await audits(id)).toHaveLength(1);
  });

  describe('refused not_supported, one family each (R13a), the rest applied', () => {
    const cases: Array<[string, (ids: { item: string; attachment: string }) => ProductScopedWriteCell]> = [
      ['audience', () => ({ scope: C(), field: 'audience', op: set({ visibility: 'public', allowedOrganizationIds: [] }) })],
      ['product.*', () => ({ scope: G, field: 'product.sku' as never, op: set('NEW-SKU') })],
      ['seo:*', () => ({ scope: CL('pl-PL'), field: 'seo:title', op: set('Tytuł') })],
      ['galleryRole:*', ({ item }) => ({ scope: C(), field: 'galleryRole:base_image', op: set(item) })],
      ['gallery hidden', ({ item }) => ({ scope: C(), field: `gallery:${item}:hidden`, op: set(true) })],
      ['attachment hidden', ({ attachment }) => ({ scope: C(), field: `attachment:${attachment}:hidden`, op: set(true) })],
      ['minOrderQuantity', () => ({ scope: C(), field: 'minOrderQuantity', op: set(5) })],
      ['returnable', () => ({ scope: C(), field: 'returnable', op: set(false) })],
    ];
    for (const [family, cell] of cases) {
      it(family, async () => {
        const id = await fx.product({ channels: [channel] });
        const { items, attachment } = await fx.media(id);
        const refusedCell = cell({ item: items[1], attachment });
        const result = await apply(id, [refusedCell, { scope: G, field: 'name', op: set(`Applied beside ${family}`) }]);
        expect(result.refused).toEqual([{ index: 0, scope: refusedCell.scope, field: refusedCell.field, code: 'not_supported' }]);
        expect(result.applied).toBe(1);
        expect((await fx.read(id)).fields.name.value).toBe(`Applied beside ${family}`);
      });
    }
  });

  it("validates each value against its field's schema and validateScopedWrite, per cell", async () => {
    const id = await fx.product({ channels: [channel] });
    const cells: ProductScopedWriteCell[] = [
      { scope: C(), field: 'name', op: { op: 'empty' } },
      { scope: G, field: 'description', op: { op: 'inherit' } },
      { scope: CL('pl-PL'), field: 'name', op: set('x'.repeat(PRODUCT_NAME_MAX + 1)) },
      { scope: C(), field: 'description', op: set('x'.repeat(PRODUCT_DESCRIPTION_MAX + 1)) },
      { scope: C(), field: `attribute:${colour}`, op: set('green') },
      { scope: C(), field: 'attribute:not_in_the_set', op: set('x') },
      { scope: C(), field: 'status', op: set('draft') },
      { scope: CL('pl-PL'), field: `attribute:${colour}`, op: set('red') },
      { scope: CL('pl-PL'), field: 'window', op: set({ from: null, until: null }) },
      { scope: CL('pl-PL'), field: 'description', op: set('Kept') },
    ];
    const result = await apply(id, cells);
    expect(result.refused.map((r) => [r.index, r.code])).toEqual([
      [0, 'required_empty'],
      [1, 'inherit_at_global'],
      [2, 'invalid'],
      [3, 'invalid'],
      [4, 'invalid'],
      [5, 'invalid'],
      [6, 'invalid'],
      [7, 'FIELD_NOT_AT_SCOPE'],
      [8, 'FIELD_NOT_AT_SCOPE'],
    ]);
    expect(result.applied).toBe(1);
    expect((await fx.read(id, { channelId: channel, languageCode: 'pl-PL' })).fields.description.value).toBe('Kept');
  });

  it('binds every subject and scope to the product: subject_not_found, SCOPE_INVALID', async () => {
    const id = await fx.product({ channels: [channel] });
    const other = await fx.product({ channels: [channel] });
    const theirs = await fx.media(other);
    const before = await version(id);
    const result = await apply(id, [
      { scope: C(), field: `gallery:${theirs.items[0]}:altText`, op: set('x') },
      { scope: C(), field: `attachment:${theirs.attachment}:name`, op: set('x') },
      { scope: C(), field: `packagingUnit:${theirs.unit}:name`, op: set('x') },
      { scope: { level: 'channel', channelId: outsider }, field: 'name', op: set('x') },
      { scope: CL('de-DE'), field: 'name', op: set('x') },
    ]);
    expect(result.refused.map((r) => [r.index, r.code])).toEqual([
      [0, 'subject_not_found'],
      [1, 'subject_not_found'],
      [2, 'subject_not_found'],
      [3, 'SCOPE_INVALID'],
      [4, 'SCOPE_INVALID'],
    ]);
    expect(result.applied).toBe(0);
    // Nothing applied: no audit entry, no version bump.
    expect(await audits(id)).toEqual([]);
    expect(await version(id)).toBe(before);
    expect((await fx.read(other)).gallery.items[0]!.altText.value).toBe('Alt 0');
  });

  it('refuses the whole call for an unregistered source, more than 2 000 cells or a duplicate cell', async () => {
    const id = await fx.product({ channels: [channel] });
    const name = { scope: G, field: 'name', op: set('Never') } as const;
    await expect(apply(id, [name], 'not_a_module')).rejects.toMatchObject({
      statusCode: 422,
      code: 'VALIDATION_FAILED',
      details: { field: 'source' },
    });
    await expect(apply(id, [name], 'Bad Source!')).rejects.toMatchObject({ statusCode: 422, details: { field: 'source' } });
    const many = Array.from({ length: 2001 }, (_, i) => ({ scope: CL('pl-PL'), field: `attribute:${note}`, op: set(String(i)) }) as const);
    await expect(apply(id, many)).rejects.toMatchObject({ statusCode: 422, details: { field: 'cells' } });
    await expect(apply(id, [name, { ...name, op: set('Twice') }])).rejects.toMatchObject({
      statusCode: 422,
      details: { field: 'cells' },
    });
    await expect(apply('00000000-0000-4000-8000-000000000000', [name])).rejects.toMatchObject({ statusCode: 404 });
    expect((await fx.read(id)).fields.name.value).toBe('Drill X');
    expect(await audits(id)).toEqual([]);
  });

  it('a URL key another product holds is reported in integration mode, never taken over', async () => {
    const holder = await fx.product({ channels: [channel] });
    const key = `held-${fx.run}`;
    await fx.save(holder, { channelId: channel, languageCode: 'pl-PL' }, { urlKey: key });
    const id = await fx.product({ channels: [channel] });
    const result = await apply(id, [
      { scope: CL('pl-PL'), field: 'urlKey', op: set(key) },
      { scope: G, field: 'name', op: set('Still applied') },
    ]);
    expect(result.urlKeys).toEqual([
      { written: false, issue: expect.objectContaining({ key, heldByProductId: holder, kind: 'current' }) },
    ]);
    expect(result.refused).toEqual([]);
    expect((await fx.read(id)).fields.name.value).toBe('Still applied');
    expect((await fx.read(holder, { channelId: channel, languageCode: 'pl-PL' })).fields.urlKey.value).toBe(key);
  });
});
