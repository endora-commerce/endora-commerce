import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { createImportProfile } from '../../helpers/import-profile.js';
import { createMinimumProduct, minimumFixtureRun } from '../../helpers/order-minimum-fixture.js';
import { parseCsv, serializeCsv } from '../../../../packages/modules/import_export/src/backend/services/csv-codec.js';

/**
 * Feature 170 (`specs/170-product-editor-scope-switcher/` T081; FR-043, FR-114, FR-118) — export
 * then re-import of the unchanged file writes nothing: the export writes `INHERIT` where a scope
 * inherits, `NULL` for a deliberately empty value, escapes text equal to a token, and guards every
 * text that starts with `=`, `+`, `-`, `@`, TAB, CR or `'`; importing it back (with any profile)
 * decodes each cell to exactly what was exported, so no value and no scope version moves.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const TEXTS = ['=SUM(A1)', '+48 123', '-5 mm', '@home', '\tTabbed', '\rCarriage', "'quoted", 'NULL', 'INHERIT'];

describe('170 — products CSV export and re-import is a no-op [integration]', () => {
  let h: BackendServerHandle;
  const RUN = minimumFixtureRun();
  const skus: string[] = [];
  const ids: string[] = [];
  let profileId = '';

  const state = async () =>
    h
      .em()
      .getConnection()
      .execute<Array<{ sku: string; name: string; description: string | null; scope_version: string; status: string }>>(
        `select sku, name, description, scope_version::text, status from products where id in (${ids.map(() => '?').join(',')}) order by sku`,
        ids,
      );

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const vipId = (await em.findOneOrFail(SalesChannel, { code: 'pl_b2b_vip' })).id;
    for (const [i, text] of TEXTS.entries()) {
      const p = await createMinimumProduct(em, { sku: `S170-RT-${RUN}-${i}`, nameEn: text, namePl: text, channelIds: [vipId] });
      skus.push(p.sku);
      ids.push(p.id);
    }
    // No description is `null` in the 170 model (the fixture helper writes ''), and one product
    // carries a description that starts with a quote.
    await em.getConnection().execute(`update products set description = null where id in (${ids.map(() => '?').join(',')})`, ids);
    await em.getConnection().execute(`update products set description = ? where id = ?`, ["'= not a formula", ids[1]]);
    profileId = await createImportProfile(h);
  });

  afterAll(async () => {
    if (!h) return;
    await teardownBackendServer(h);
  });

  it('exports guarded and escaped text cells, NULL and INHERIT', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', ...ADMIN });
    expect(res.statusCode).toBe(200);
    const [header, ...rows] = parseCsv(res.body);
    const nameAt = header!.indexOf('name');
    const descriptionAt = header!.indexOf('description');
    const mine = rows.filter((row) => skus.includes(row[1]!));
    const names = Object.fromEntries(mine.map((row) => [row[1], row[nameAt]]));
    expect(names[skus[0]!]).toBe("'=SUM(A1)");
    expect(names[skus[4]!]).toBe("'\tTabbed");
    expect(names[skus[6]!]).toBe("''quoted");
    expect(names[skus[7]!]).toBe('\\NULL');
    expect(names[skus[8]!]).toBe('\\INHERIT');
    expect(mine.find((row) => row[1] === skus[0])![descriptionAt]).toBe('NULL');
    for (const row of mine) for (const cell of row.slice(header!.indexOf('description') + 1)) expect(cell).not.toBe('');
  });

  it('re-imports the unchanged file without writing a value or moving a scope version (FR-114)', async () => {
    const before = await state();
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/admin/export/products.csv', ...ADMIN });
    const [header, ...rows] = parseCsv(res.body);
    const csv = serializeCsv([header!, ...rows.filter((row) => skus.includes(row[1]!))]);
    const imported = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      ...ADMIN,
      headers: { 'content-type': 'text/csv' },
      payload: csv,
    });
    expect(imported.statusCode, imported.body).toBe(200);
    const report = (imported.json() as { data: { errors: unknown[]; fieldErrors?: unknown[] } }).data;
    expect(report.errors).toEqual([]);
    expect(report.fieldErrors ?? [], JSON.stringify(report.fieldErrors)).toEqual([]);
    expect(await state()).toEqual(before);
  });
});
