import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * T181 — An Admin User whose Role does not grant `catalog:write` must
 * receive 403 FORBIDDEN on a write to the catalog admin surface. A separate
 * stub cookie maps to a restricted admin role for this test.
 */

describe('Admin permission gating', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('restricted admin gets 403 on POST /admin/catalog/products', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: {
        sku: 'PERMISSION-TEST-001',
        type: 'simple',
        name: { 'en-US': 'X' },
        description: { 'en-US': 'X' },
        categoryIds: [],
        attributeValues: {},
        visibility: 'public',
      },
      cookies: { b2b_session: 'stub-restricted-admin-session' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.FORBIDDEN);
  });
});
