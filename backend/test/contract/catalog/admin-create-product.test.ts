import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODES } from '@b2b/contracts';
import { setupTestServer } from '../../helpers/test-server.js';

/**
 * T047 — `POST /admin/catalog/products` with a duplicate SKU must return
 * `409 SKU_ALREADY_EXISTS` and must NOT create a row (catalog.contract.md).
 *
 * Uses a stub admin-session cookie minted by `setupTestServer`. Until the
 * admin auth plumbing lands (T186), the test exercises the 409 contract
 * path assuming a fixture admin is authenticated.
 */

describe('POST /api/v1/admin/catalog/products — duplicate SKU', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await setupTestServer();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const productPayload = {
    sku: 'TEST-DUPE-001',
    type: 'simple' as const,
    name: { 'en-US': 'Duplicate probe' },
    description: { 'en-US': 'Duplicate probe' },
    categoryIds: [],
    attributeValues: {},
    visibility: 'public' as const,
  };

  it('creates the first time, returns 409 SKU_ALREADY_EXISTS on the second', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: productPayload,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: productPayload,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.SKU_ALREADY_EXISTS);
  });
});
