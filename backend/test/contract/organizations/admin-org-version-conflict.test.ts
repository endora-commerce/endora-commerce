import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * 003 — Optimistic concurrency on admin organization PATCH (FR-012).
 */

describe('PATCH /api/v1/admin/organizations/:id — version conflict', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('returns 409 VERSION_CONFLICT when expectedUpdatedAt does not match', async () => {
    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(get.statusCode).toBe(200);
    const detail = get.json() as { data: { updatedAt: string } };

    const stale = new Date(new Date(detail.data.updatedAt).getTime() - 60_000).toISOString();

    const patch = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}`,
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        name: 'Should Not Apply',
        expectedUpdatedAt: stale,
      },
    });
    expect(patch.statusCode).toBe(409);
    const err = patch.json() as { error: { code: string } };
    expect(err.error.code).toBe(ERROR_CODES.VERSION_CONFLICT);
  });
});
