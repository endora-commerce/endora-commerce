import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@b2b/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';

/**
 * T208 — Lowering the granted amount below the sum of active reservations
 * without `allowOverAllocation` returns 409 ADJUSTMENT_BELOW_ACTIVE and
 * leaves the row unchanged. With `allowOverAllocation=true` the patch
 * succeeds; new reservations are then refused until the active sum drops
 * below the new cap.
 */

describe('PATCH /admin/organizations/:id/credit-limit — below active', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('refuses to lower below the sum of active reservations', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    // Active reservations sum to 5000 (see seed). Try to adjust to 1000 without override.
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 1000, reason: 'budget cut' },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: { code: string } }).error.code).toBe(
      ERROR_CODES.ADJUSTMENT_BELOW_ACTIVE,
    );
  });

  it('accepts the lower amount with allowOverAllocation=true', async () => {
    const orgId = '00000000-0000-4000-8000-0000000000aa';
    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${orgId}/credit-limit`,
      payload: { grantedAmount: 1000, allowOverAllocation: true },
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(res.statusCode).toBe(200);
  });
});
