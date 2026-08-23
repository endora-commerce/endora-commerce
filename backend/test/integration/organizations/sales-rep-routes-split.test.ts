import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { TEST_ADMIN_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * D-166 — the sales-rep routes split by owner, and the gate travels with them.
 *
 * The four endpoints used to be one file that `organizations` owned and
 * `quote_requests` **registered**, through a dynamic `import()` inside its own
 * `register`. So all four were gated by `quote_requests`' effective state and
 * all four were permissioned `rfqs:handle`, and three ledger entries — one in
 * `quote_requests`' shard, two in `organizations`' — asked which module's
 * activation ought to hide the screen.
 *
 * D-166 rules that the question was the wrong one, because the option those
 * notes offered is not available: `rfqs:handle` is declared
 * `module: 'quote_requests'`, so registering the whole file under
 * `organizations` — which is `nonDeactivatable` — leaves a permanently mounted
 * screen behind a permission that vanishes from `/admin-roles` the moment quote
 * requests is switched off. The gate has to travel with the routes, which makes
 * the split a consequence rather than a preference.
 *
 * This file measures the split at the only place it is observable: with
 * `quote_requests` deactivated, the three assignment endpoints must keep
 * answering (they are `organizations`', staff scoping, and that module cannot
 * be switched off) while the one endpoint that reads `QuoteRequest` must answer
 * the 503 `MODULE_DISABLED` envelope.
 *
 * The permission halves are in
 * `test/contract/organizations/sales-reps.test.ts`: each endpoint is opened by
 * the code its own owner declares and refused without it.
 */
describe('sales-rep routes split by owner (D-166)', () => {
  let h: BackendServerHandle;
  const admin = { b2b_session: 'stub-admin-session' };

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('keeps the three assignment endpoints answering while quote requests is off', async () => {
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const list = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
        cookies: admin,
      });
      expect(list.statusCode).toBe(200);

      const assign = await h.app.inject({
        method: 'POST',
        url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
        cookies: admin,
        payload: { adminUserId: TEST_ADMIN_ID },
      });
      expect(assign.statusCode).toBe(201);

      const unassign = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps/${TEST_ADMIN_ID}`,
        cookies: admin,
      });
      expect(unassign.statusCode).toBe(204);
    });
  });

  it('refuses the reverse listing while quote requests is off', async () => {
    await withModuleOff('quote_requests', 'deactivated', async () => {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
        cookies: admin,
      });
      expect(res.statusCode).toBe(503);
      expect((res.json() as { error: { code: string } }).error.code).toBe('MODULE_DISABLED');
    });
  });

  it('answers the reverse listing again once quote requests is back on', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/organizations/${TEST_ORGANIZATION_ID}/sales-reps`,
      cookies: admin,
      payload: { adminUserId: TEST_ADMIN_ID },
    });
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/sales-reps/${TEST_ADMIN_ID}/organizations`,
      cookies: admin,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ organizationId: string; openRfqCount: number }> };
    expect(body.data.find((o) => o.organizationId === TEST_ORGANIZATION_ID)).toBeTruthy();
  });
});
