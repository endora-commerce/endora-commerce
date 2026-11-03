import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../helpers/package-entities.js';
import { createImportProfile } from '../../helpers/import-profile.js';

/**
 * T240 — products export/import.
 *
 * The seed catalog ships three example products under known SKUs. Export
 * MUST round-trip them as a CSV with the documented header. Import MUST
 * mutate the targeted rows.
 *
 * Feature 170 (`specs/170-product-editor-scope-switcher/contracts/import-profiles-and-csv.md`
 * §2–§3): the Global text columns are `name` and `description`, a products import runs with
 * a profile (`422 IMPORT_PROFILE_REQUIRED` without one), and each product row applies in its
 * own transaction — a refused row no longer rolls the others back.
 */

describe('Import/Export — products', () => {
  let h: BackendServerHandle;
  let profileId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    profileId = await createImportProfile(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('GET /admin/export/products.csv emits the documented header + rows', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/export/products.csv',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/products-\d{4}-\d{2}-\d{2}\.csv/);
    const body = res.body;
    const firstLine = body.split('\n')[0];
    // Feature 170 (`import-profiles-and-csv.md` §2.1, §3) — the fixed Global columns, then one
    // `<field>@<channel code>[/<language>]` column per (field, scope) holding an own value.
    const columns = firstLine!.split(',');
    expect(columns.slice(0, 10)).toEqual([
      'id', 'sku', 'slug', 'type', 'status', 'visibility', 'name', 'description', 'minOrderQuantity', 'returnable',
    ]);
    for (const column of columns.slice(10)) expect(column).toMatch(/^[A-Za-z]+(:[a-z0-9_]+)?@[^/]+(\/.+)?$/);
    expect(body).toContain('EXAMPLE-SIMPLE-001');
  });

  it('POST /admin/import/products updates an existing product when the row is valid', async () => {
    const csv = [
      'sku,status,visibility,name,description',
      'EXAMPLE-SIMPLE-001,active,public,Renamed example,An updated description.',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      headers: {
        'content-type': 'text/csv',
        cookie: 'b2b_session=stub-admin-session',
      },
      payload: csv,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { imported: number; errors: unknown[] } };
    expect(body.data.imported).toBe(1);
    expect(body.data.errors).toEqual([]);

    const reloaded = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-SIMPLE-001' });
    expect(reloaded.name).toBe('Renamed example');
    expect(reloaded.description).toBe('An updated description.');
  });

  it('applies each product row on its own: a refused row leaves the others applied (feature 170)', async () => {
    const csv = [
      'sku,status,visibility,name,description',
      'EXAMPLE-BLUE-002,active,public,Applied on its own,desc',
      'NO-SUCH-SKU,active,public,Will fail,desc',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/import/products?profileId=${profileId}`,
      headers: {
        'content-type': 'text/csv',
        cookie: 'b2b_session=stub-admin-session',
      },
      payload: csv,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { imported: number; errors: Array<{ rowNumber: number; reason: string }> };
    };
    expect(body.data.imported).toBe(1);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]?.rowNumber).toBe(3);
    expect(body.data.errors[0]?.reason).toContain('NO-SUCH-SKU');

    const reloaded = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-BLUE-002' });
    expect(reloaded.name).toBe('Applied on its own');
  });

  it('refuses a products import without a profile (IMPORT_PROFILE_REQUIRED)', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/products',
      headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
      payload: 'sku,name\nEXAMPLE-SIMPLE-001,Nope',
    });
    expect(res.statusCode, res.body).toBe(422);
    expect((res.json() as { error: { code: string } }).error.code).toBe('IMPORT_PROFILE_REQUIRED');
  });
});
