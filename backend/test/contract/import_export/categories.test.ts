import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category } from '../../helpers/package-entities.js';

/**
 * T240 — categories import creates new rows and updates existing ones,
 * resolving parents by slug. Categories listed before their parents fail
 * cleanly with a row-numbered reason.
 */

describe('Import/Export — categories', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('imports new categories with parent resolution by slug', async () => {
    const csv = [
      'slug,parent_slug,sort_order,name_en',
      'imported-root,,1,Imported root',
      'imported-child,imported-root,2,Imported child',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/categories',
      headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
      payload: csv,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { imported: number; errors: unknown[] } };
    expect(body.data.imported).toBe(2);

    const root = await h.em().findOneOrFail(Category, { slug: 'imported-root' });
    const child = await h.em().findOneOrFail(Category, { slug: 'imported-child' });
    expect(child.parentCategoryId).toBe(root.id);
    expect(child.sortOrder).toBe(2);
  });

  it('reports missing parent_slug per row without partial commits', async () => {
    const csv = [
      'slug,parent_slug,sort_order,name_en',
      'orphan,does-not-exist,0,Orphan',
    ].join('\n');

    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/import/categories',
      headers: { 'content-type': 'text/csv', cookie: 'b2b_session=stub-admin-session' },
      payload: csv,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: { imported: number; errors: Array<{ rowNumber: number; reason: string }> };
    };
    expect(body.data.imported).toBe(0);
    expect(body.data.errors[0]?.reason).toContain('does-not-exist');

    const orphan = await h.em().findOne(Category, { slug: 'orphan' });
    expect(orphan).toBeNull();
  });
});
