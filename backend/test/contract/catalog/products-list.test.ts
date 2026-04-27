import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T043 — `GET /catalog/products` with a filter over a non-filterable attribute
 * must return `400 FILTER_NOT_ALLOWED` (catalog.contract.md, FR-005).
 *
 * This is the storefront read surface; no auth is required.
 */

describe('GET /api/v1/catalog/products — filter validation', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 400 FILTER_NOT_ALLOWED when filtering on a non-filterable attribute', async () => {
    // An attribute exists in the system but has isFilterable=false.
    // The contract forbids the endpoint from silently ignoring the filter.
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/catalog/products?filter%5Battr.internal_sku_notes%5D=foo',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.FILTER_NOT_ALLOWED);
  });

  it('returns 200 with { data, pagination } shape on a plain list call', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; pagination: { hasMore: boolean; limit: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.limit).toBeGreaterThan(0);
  });
});
