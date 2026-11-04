import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CatalogBulkImportPort, ProductImportCell } from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';

/**
 * Feature 172, US4 (T084; `contracts/import-profiles-and-csv.md` §2–§3, FR-043, FR-114) — the
 * catalog side of the products import, `catalogBulkImportPort`:
 *
 * - `importProducts` writes the C and C×L cells of a row (name, description, URL key, attributes,
 *   multiselect included) and, for the products file, `minOrderQuantity` and `returnable` at G and C
 *   (coordinator decision, S1 block 2); each refused cell is a field error under its column, the
 *   row's other cells applying;
 * - `dryRun` reports the same refusals and writes nothing;
 * - a stored `''` Global description is none: re-importing `NULL` there writes nothing;
 * - `exportScopedValues` lists one column per (field, scope) holding an own value, the values as
 *   `{ kind: 'text' | 'value' | 'empty' }`, orphans left out.
 */
describe('172 US4 — the scoped products import and export port (T084)', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let channelCode: string;
  let tags: string;
  const port = () => (h.container.cradle as unknown as { catalogBulkImportPort: CatalogBulkImportPort }).catalogBulkImportPort;
  const run = <T>(fn: () => Promise<T>) => withSystemScope('172 scoped import port test', fn);
  const skuOf = async (id: string) => (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [id]))[0]!.sku;
  const audits = async (id: string) =>
    Number((await fx.sql<{ n: string }>(`select count(*)::text as n from audit_log_entries where object_id = ? and action = 'product.scoped_values.import'`, [id]))[0]!.n);

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL', 'en-US']);
    channelCode = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [channel]))[0]!.code;
    tags = await fx.attribute({ key: 'tags', valueType: 'multiselect', scopable: true, options: ['a', 'b'] });
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('writes C and C×L cells, MOQ and returnable at C, and reports refused cells per column', async () => {
    const id = await fx.product({ channels: [channel] });
    const CL = { level: 'channel_language', channelId: channel, languageCode: 'pl-PL' } as const;
    const C = { level: 'channel', channelId: channel } as const;
    const cells: ProductImportCell[] = [
      { scope: CL, field: 'name', op: { op: 'set', value: 'Wiertarka' }, column: 'name@x/pl-pl' },
      { scope: C, field: 'description', op: { op: 'empty' }, column: 'description@x' },
      { scope: C, field: `attribute:${tags}`, op: { op: 'set', value: ['a'] }, column: 'tags@x' },
      { scope: C, field: 'minOrderQuantity', op: { op: 'set', value: 6 }, column: 'minOrderQuantity@x' },
      { scope: C, field: 'returnable', op: { op: 'set', value: false }, column: 'returnable@x' },
      { scope: CL, field: 'minOrderQuantity', op: { op: 'set', value: 2 }, column: 'minOrderQuantity@x/pl-pl' },
      { scope: C, field: 'audience', op: { op: 'set', value: { visibility: 'public', allowedOrganizationIds: [] } }, column: 'audience@x' },
    ];
    const sku = await skuOf(id);
    const report = await run(() => port().importProducts([{ sku, cells }]));
    expect(report).toEqual({
      imported: 1,
      errors: [],
      fieldErrors: [
        { index: 0, column: 'minOrderQuantity@x/pl-pl', code: 'FIELD_NOT_AT_SCOPE' },
        { index: 0, column: 'audience@x', code: 'not_supported' },
      ],
    });
    const pl = await fx.read(id, { channelId: channel, languageCode: 'pl-PL' });
    expect(pl.fields.name.value).toBe('Wiertarka');
    expect(pl.fields.description).toMatchObject({ value: null, source: 'inherited_channel' });
    expect(pl.attributes.find((a) => a.key === tags)?.view.value).toEqual(['a']);
    const c = await fx.read(id, { channelId: channel });
    expect(c.fields.minOrderQuantity.value).toBe(6);
    expect(c.fields.returnable.value).toBe(false);
  });

  it('dryRun reports the same refusals and writes nothing', async () => {
    const id = await fx.product({ channels: [channel] });
    const before = await audits(id);
    const report = await run(async () =>
      port().importProducts(
        [
          {
            sku: await skuOf(id),
            cells: [{ scope: { level: 'channel', channelId: channel }, field: 'name', op: { op: 'empty' } }],
          },
        ],
        { dryRun: true },
      ),
    );
    expect(report.fieldErrors).toEqual([{ index: 0, column: `name@${channel}`, code: 'required_empty' }]);
    expect(await audits(id)).toBe(before);
    expect((await fx.read(id, { channelId: channel })).fields.name.source).toBe('inherited_global');
  });

  it("a stored '' Global description counts as none: NULL there writes nothing", async () => {
    const id = await fx.product({ channels: [channel], description: '' });
    const before = await audits(id);
    const report = await run(async () =>
      port().importProducts([{ sku: await skuOf(id), cells: [{ scope: { level: 'global' }, field: 'description', op: { op: 'empty' } }] }]),
    );
    expect(report).toEqual({ imported: 1, errors: [] });
    expect(await audits(id)).toBe(before);
  });

  it('exports one column per (field, scope) holding an own value, typed, without orphans', async () => {
    const id = await fx.product({ channels: [channel] });
    await fx.save(id, { channelId: channel, languageCode: 'pl-PL' }, { name: 'Eksport', description: null });
    await fx.save(id, { channelId: channel }, { minOrderQuantity: 4, returnable: true, attributes: { [tags]: ['b'] } });
    const left = await fx.channel(['pl-PL']);
    await fx.sql(
      `insert into product_value_overrides (id, product_id, attribute_key, channel_id, language_code, value, created_at, updated_at)
       values (gen_random_uuid(), ?, 'name', ?, 'pl-PL', '{"v":"Orphan"}'::jsonb, now(), now())`,
      [id, left],
    );
    const exported = await run(() => port().exportScopedValues());
    expect(exported.values[id]).toEqual({
      [`name@${channelCode}/pl-PL`]: { kind: 'text', text: 'Eksport' },
      [`description@${channelCode}/pl-PL`]: { kind: 'empty' },
      [`attribute:${tags}@${channelCode}`]: { kind: 'value', value: ['b'] },
      [`minOrderQuantity@${channelCode}`]: { kind: 'value', value: 4 },
      [`returnable@${channelCode}`]: { kind: 'value', value: true },
    });
    const mine = exported.columns.filter((col) => col.channelId === channel).map((col) => `${col.field}@${col.languageCode ?? ''}`);
    expect(mine).toEqual(expect.arrayContaining(['name@pl-PL', 'description@pl-PL', 'minOrderQuantity@', 'returnable@']));
    expect(exported.columns.some((col) => col.channelId === left)).toBe(false);
  });
});
