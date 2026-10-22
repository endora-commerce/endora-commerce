import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrecedenceView } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T096, FR-021, FR-023) — the precedence is readable and not
 * yet changeable: `GET` answers version 1, the HY preset; every write under
 * `…/precedence` answers `409 PRECEDENCE_CHANGE_UNAVAILABLE` until P3.
 */
describe('admin precedence (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reads version 1, the HY preset', async () => {
    const res = await api.get<{ data: PrecedenceView }>('/api/v1/admin/price-books/precedence');
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data).toMatchObject({
      version: 1,
      preset: 'HY',
      categoryBeforeAttribute: true,
      depthMode: 'within_cell',
    });
    expect(res.body.data.cells).toHaveLength(12);
    expect(res.body.data.cells.slice(-2)).toEqual(['org.all', 'group.all']);
  });

  it('refuses every change until P3', async () => {
    for (const method of ['post', 'put'] as const) {
      for (const url of ['/api/v1/admin/price-books/precedence', '/api/v1/admin/price-books/precedence/versions']) {
        const res = await api[method](url, { preset: 'AF' });
        expect(res.status, `${method} ${url}`).toBe(409);
        expect((res.body as { error: { code: string } }).error.code).toBe('PRECEDENCE_CHANGE_UNAVAILABLE');
      }
    }
  });
});
