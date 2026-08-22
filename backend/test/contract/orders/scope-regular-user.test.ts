import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedRoleScopingFixture } from '../../helpers/seed-roles.js';

/**
 * T169 — A Regular User must NOT be able to read another member's Order.
 * Server returns 404 ORDER_NOT_FOUND (not 403) to avoid leaking existence.
 * Organization Admin sees both rows.
 */

describe('GET /api/v1/orders/:id — Regular User scoping', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedRoleScopingFixture(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('Regular User gets 404 on a sibling member\'s Order', async () => {
    const res = await h.app.inject({
      method: 'GET',
      // The "other" Customer's order id, seeded by seedRoleScopingFixture.
      url: '/api/v1/orders/00000000-0000-4000-8000-000000000401',
      cookies: { b2b_session: 'stub-regular-user-session' },
    });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { error: { code: string } };
    expect(body.error.code).toBe(ERROR_CODES.ORDER_NOT_FOUND);
  });

  it('Organization Admin sees the same Order successfully', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/v1/orders/00000000-0000-4000-8000-000000000401',
      cookies: { b2b_session: 'stub-customer-session' },
    });
    expect(res.statusCode).toBe(200);
  });
});
