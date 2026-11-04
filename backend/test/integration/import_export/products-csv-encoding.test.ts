import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { ScopedValuesResponse } from '@endora-commerce/contracts';
import { SCOPED_WRITE_CASES, type ScopedWriteCase } from '../../../../packages/contracts/src/scoped-write-encoding.cases.js';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { scopedValuesFixture, type ScopedValuesFixture } from '../../helpers/scoped-values-fixture.js';
import { serializeCsv } from '../../../../packages/modules/import_export/src/backend/services/csv-codec.js';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/` T079; US4 #9; FR-110…FR-113, FR-118,
 * SC-014) — the products CSV import honours every CSV row of the shared case table
 * (`write-encoding.md` §4): an empty cell changes nothing, `NULL` is the empty value, `INHERIT`
 * removes the own value, escaped and formula-guarded text lands verbatim, and the refusals are
 * field errors that write nothing. Each case runs on a product of its own, holding an own value
 * `Seeded` at the case's scope, and is read back through `GET …/scoped-values` at that scope.
 *
 * The `minOrderQuantity`, `returnable` and multiselect columns (coordinator ruling 2026-11-03,
 * §2.1): their refusals run here, end to end; their parser side is
 * `packages/modules/import_export/src/backend/services/adapters/products.adapter.test.ts`. The
 * remaining rows are read back from catalog too. The encoding passes `-5` and `'5` through as a
 * value (`set`), and catalog then refuses them as a minimum order quantity (`invalid`): the
 * stored outcome is a field error, not a stored `-5`.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const FIELDS = new Set(['name', 'description', 'status']);
const SEED: Record<string, string> = { name: 'Seeded', description: 'Seeded', status: 'inactive' };

describe('172 — products CSV import, the shared encoding cases [integration]', () => {
  let h: BackendServerHandle;
  let vipId = '';
  let profileId = '';
  const run = randomUUID().slice(0, 8);
  let n = 0;

  beforeAll(async () => {
    h = await setupBackendServer();
    vipId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    profileId = await createImportProfile(h);
  });

  afterAll(async () => {
    if (!h) return;
    await teardownBackendServer(h);
  });

  const scopeOf = (c: ScopedWriteCase) =>
    c.level === 'G' ? {} : c.level === 'C' ? { channelId: vipId } : { channelId: vipId, languageCode: 'pl-PL' };
  const columnOf = (c: ScopedWriteCase) =>
    c.level === 'G' ? c.field : c.level === 'C' ? `${c.field}@pl_b2b_vip` : `${c.field}@pl_b2b_vip/pl-PL`;

  async function read(productId: string, scope: Record<string, string>) {
    const qs = new URLSearchParams(scope).toString();
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${productId}/scoped-values${qs ? `?${qs}` : ''}`,
      ...ADMIN,
    });
    expect(res.statusCode, res.body).toBe(200);
    return (res.json() as ScopedValuesResponse).data;
  }

  /** A product in the VIP channel holding `Seeded` (or `inactive`) at the case's scope. */
  async function seededProduct(c: ScopedWriteCase): Promise<{ id: string; sku: string }> {
    const sku = `S170-ENC-${run}-${n++}`;
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      ...ADMIN,
      payload: { sku, type: 'simple', name: 'Seeded', description: 'Seeded', categoryIds: [], attributeValues: {}, visibility: 'public', status: 'inactive' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await h.em().getConnection().execute(`insert into sales_channel_products (sales_channel_id, product_id) values (?, ?)`, [vipId, id]);
    if (c.level !== 'G') {
      const scope = scopeOf(c);
      const { version } = await read(id, scope);
      const save = await h.app.inject({
        method: 'PUT',
        url: `/api/v1/admin/catalog/products/${id}/scoped-values`,
        ...ADMIN,
        payload: { scope, version, changes: { [c.field]: SEED[c.field] } },
      });
      expect(save.statusCode, save.body).toBe(200);
    }
    return { id, sku };
  }

  const csvCases = SCOPED_WRITE_CASES.filter((c) => c.csv !== undefined);

  it.each(csvCases.filter((c) => FIELDS.has(c.field)).map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const product = await seededProduct(c);
    const column = columnOf(c);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: serializeCsv([
        ['sku', column],
        [product.sku, c.csv!],
      ]),
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = (res.json() as { data: { errors: unknown[]; fieldErrors?: Array<{ column: string; code: string }> } }).data;
    const view = (await read(product.id, scopeOf(c))).fields[c.field as 'name' | 'description' | 'status'];

    if (typeof c.expect === 'string' && c.expect !== 'no_change') {
      expect(report.fieldErrors).toEqual([{ rowNumber: 2, column, code: c.expect }]);
      expect(view.ownValue ?? view.value).toBe(SEED[c.field]);
      return;
    }
    expect(report.errors).toEqual([]);
    expect(report.fieldErrors ?? []).toEqual([]);
    if (c.expect === 'no_change') {
      expect(view.ownValue ?? view.value).toBe(SEED[c.field]);
    } else if (c.expect.op === 'set') {
      expect(view.source).toBe('set');
      expect(view.ownValue ?? view.value).toBe(c.expect.value);
    } else if (c.expect.op === 'empty') {
      expect(view.value).toBeNull();
    } else {
      expect(['inherited_channel', 'inherited_global']).toContain(view.source);
    }
  });

  const valueCases = csvCases.filter((c) => !FIELDS.has(c.field));
  const refusals = valueCases.filter((c) => typeof c.expect === 'string' && c.expect !== 'no_change');

  it.each(refusals.map((c) => [c.name, c] as const))('%s (a field error, nothing written)', async (_name, c) => {
    const product = await seededProduct({ ...c, level: 'G' });
    const column = columnOf(c);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: serializeCsv([
        ['sku', column],
        [product.sku, c.csv!],
      ]),
    });
    expect(res.statusCode, res.body).toBe(200);
    const report = (res.json() as { data: { fieldErrors?: Array<{ rowNumber: number; column: string; code: string }> } }).data;
    expect(report.fieldErrors).toEqual([{ rowNumber: 2, column, code: c.expect }]);
  });

  describe('the minimum order quantity and multiselect rows, read back from catalog', () => {
    let fx: ScopedValuesFixture;
    let channel = '';
    let code = '';
    let multi = '';

    beforeAll(async () => {
      fx = scopedValuesFixture(() => h);
      channel = await fx.channel(['pl-PL']);
      code = (await fx.sql<{ code: string }>(`select code from sales_channels where id = ?`, [channel]))[0]!.code;
      multi = await fx.attribute({ key: 'multi', valueType: 'multiselect', scopable: true, options: ['red', 'blue'] });
    });

    afterAll(async () => {
      if (fx) await fx.cleanup();
    });

    const stored = valueCases.filter((c) => !refusals.includes(c));

    it('covers every remaining CSV row of the shared table', () => {
      expect(stored.map((c) => c.name).sort()).toEqual([
        'csv: NULL minimum order quantity = no minimum',
        'csv: NULL multiselect = nothing selected',
        'csv: a numeric column keeps a quote',
        'csv: a numeric column keeps its minus',
      ]);
    });

    it.each(stored.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
      const isMulti = c.field === 'attribute:multi';
      const id = await fx.product({ channels: [channel] });
      const scope = c.level === 'C' ? { channelId: channel } : {};
      const seed = isMulti ? { attributes: { [multi]: ['red'] } } : { minOrderQuantity: 3 };
      await fx.save(id, scope, seed);
      const base = isMulti ? `attribute:${multi}` : 'minOrderQuantity';
      const column = c.level === 'C' ? `${base}@${code}` : base;
      const sku = (await fx.sql<{ sku: string }>(`select sku from products where id = ?`, [id]))[0]!.sku;
      const res = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/import/products?profileId=${profileId}`,
        ...ADMIN,
        headers: { 'content-type': 'text/csv' },
        payload: serializeCsv([
          ['sku', column],
          [sku, c.csv!],
        ]),
      });
      expect(res.statusCode, res.body).toBe(200);
      const report = (res.json() as { data: { fieldErrors?: Array<{ rowNumber: number; column: string; code: string }> } }).data;
      const data = await fx.read(id, scope);
      const view = isMulti ? data.attributes.find((a) => a.key === multi)!.view : data.fields.minOrderQuantity;

      if (typeof c.expect === 'object' && c.expect.op === 'set') {
        // The encoding hands catalog the value; catalog refuses it as a minimum.
        expect(report.fieldErrors).toEqual([expect.objectContaining({ rowNumber: 2, column, code: 'invalid' })]);
        expect(view).toMatchObject({ value: 3, source: 'set' });
        return;
      }
      expect(report.fieldErrors ?? []).toEqual([]);
      expect(view.value).toBeNull();
      // At Global an empty value is no value (`absent`); below it, an empty override (`set_empty`).
      expect(view.source).toBe(c.level === 'G' ? 'absent' : 'set_empty');
    });
  });
});
