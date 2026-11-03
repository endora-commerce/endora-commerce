import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { ADMIN, scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { serializeCsv } from '../../../../packages/modules/import_export/src/backend/services/csv-codec.js';

/**
 * Feature 170 (T079 / T084; `contracts/write-encoding.md`, `contracts/import-profiles-and-csv.md`
 * §2) — what catalog stores for the products file's minimum order quantity and multiselect cells
 * at Global and Channel: a number, an empty override (`NULL` = no minimum / nothing selected), and
 * the refusals of a value that is not a valid minimum. S2's encoding suite keeps these as `todo`
 * rows; this suite is catalog's acceptance of them.
 */
describe('170 — products CSV: minimum order quantity and multiselect at G and C [integration]', () => {
  let h: BackendServerHandle;
  let fx: ScopedValuesFixture;
  let channel: string;
  let code: string;
  let multi: string;
  let profileId: string;

  const importCsv = async (rows: string[][]) => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: serializeCsv(rows),
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as { data: { errors: unknown[]; fieldErrors?: Array<{ column: string; code: string }> } }).data;
  };
  const sku = async (id: string) => (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [id]))[0]!.sku;
  const attribute = async (id: string, scope: { channelId?: string } = {}) =>
    (await fx.read(id, scope)).attributes.find((a) => a.key === multi)!.view;

  beforeAll(async () => {
    h = await setupBackendServer();
    fx = scopedValuesFixture(() => h);
    channel = await fx.channel(['pl-PL']);
    code = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [channel]))[0]!.code;
    multi = await fx.attribute({ key: 'multi', valueType: 'multiselect', scopable: true, options: ['red', 'blue'] });
    profileId = await createImportProfile(h);
  });

  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await teardownBackendServer(h);
    }
  });

  it('stores a minimum at Global and at Channel, and NULL at Channel as "no minimum" there', async () => {
    const id = await fx.product({ channels: [channel] });
    const report = await importCsv([
      ['sku', 'minOrderQuantity', `minOrderQuantity@${code}`],
      [await sku(id), '5', '7'],
    ]);
    expect(report.fieldErrors ?? []).toEqual([]);
    expect((await fx.read(id)).fields.minOrderQuantity).toMatchObject({ value: 5, source: 'set' });
    expect((await fx.read(id, { channelId: channel })).fields.minOrderQuantity).toMatchObject({ value: 7, source: 'set' });

    await importCsv([
      ['sku', `minOrderQuantity@${code}`],
      [await sku(id), 'NULL'],
    ]);
    expect((await fx.read(id, { channelId: channel })).fields.minOrderQuantity).toMatchObject({ value: null, source: 'set_empty' });
    expect((await fx.read(id)).fields.minOrderQuantity).toMatchObject({ value: 5 });
  });

  it.each([
    ['a negative number', '-5'],
    ['a quoted number (the formula guard is for text columns)', "'5"],
    ['zero', '0'],
  ])('refuses %s as a minimum, nothing stored', async (_label, cell) => {
    const id = await fx.product({ channels: [channel] });
    const column = `minOrderQuantity@${code}`;
    const report = await importCsv([
      ['sku', column],
      [await sku(id), cell],
    ]);
    expect(report.fieldErrors).toEqual([expect.objectContaining({ column, code: 'invalid' })]);
    expect((await fx.read(id, { channelId: channel })).fields.minOrderQuantity.source).not.toBe('set');
  });

  it('stores multiselect options at Global and at Channel, and NULL at Global as nothing selected', async () => {
    const id = await fx.product({ channels: [channel] });
    const report = await importCsv([
      ['sku', `attribute:${multi}`, `attribute:${multi}@${code}`],
      [await sku(id), 'red|blue', 'blue'],
    ]);
    expect(report.fieldErrors ?? []).toEqual([]);
    expect(await attribute(id)).toMatchObject({ value: ['red', 'blue'], source: 'set' });
    expect(await attribute(id, { channelId: channel })).toMatchObject({ value: ['blue'], source: 'set' });

    await importCsv([
      ['sku', `attribute:${multi}`],
      [await sku(id), 'NULL'],
    ]);
    expect((await attribute(id)).value).toBeNull();
    expect(await attribute(id, { channelId: channel })).toMatchObject({ value: ['blue'] });
  });

  it('refuses an option the attribute does not offer', async () => {
    const id = await fx.product({ channels: [channel] });
    const column = `attribute:${multi}@${code}`;
    const report = await importCsv([
      ['sku', column],
      [await sku(id), 'red|green'],
    ]);
    expect(report.fieldErrors).toEqual([expect.objectContaining({ column, code: 'invalid' })]);
  });
});
