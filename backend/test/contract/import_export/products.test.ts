import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Product } from '../../../src/modules/catalog/entities/product.entity.js';

/**
 * T240 — products export/import.
 *
 * The seed catalog ships three example products under known SKUs. Export
 * MUST round-trip them as a CSV with the documented header. Import MUST
 * mutate the targeted rows and roll back the whole batch if any single row
 * fails (so re-uploads are deterministic).
 */

describe('Import/Export — products', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
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
    expect(firstLine).toBe('id,sku,slug,type,status,visibility,name_en,description_en');
    expect(body).toContain('EXAMPLE-SIMPLE-001');
  });

  it('POST /admin/import/products updates an existing product when the row is valid', async () => {
    const csv = [
      'sku,status,visibility,name_en,description_en',
      'EXAMPLE-SIMPLE-001,active,public,Renamed example,An updated description.',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/products',
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
    expect(reloaded.name['en-US']).toBe('Renamed example');
    expect(reloaded.description['en-US']).toBe('An updated description.');
  });

  it('rolls back the whole batch when any row fails validation', async () => {
    const before = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-BLUE-002' });
    const beforeName = before.name['en-US'];

    const csv = [
      'sku,status,visibility,name_en,description_en',
      'EXAMPLE-BLUE-002,active,public,About to be reverted,desc',
      'NO-SUCH-SKU,active,public,Will fail,desc',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/products',
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
    expect(body.data.imported).toBe(0);
    expect(body.data.errors).toHaveLength(1);
    expect(body.data.errors[0]?.rowNumber).toBe(3);
    expect(body.data.errors[0]?.reason).toContain('NO-SUCH-SKU');

    const reloaded = await h.em().findOneOrFail(Product, { sku: 'EXAMPLE-BLUE-002' });
    expect(reloaded.name['en-US']).toBe(beforeName);
  });
});
