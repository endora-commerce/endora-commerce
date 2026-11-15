import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Issue #470 (D-288, `specs/conventions/audit-state.md` §5) — a default ordering
 * preference is about an Organization or a customer account, and the platform-wide audit
 * screen, `GET /api/v1/admin/audit-log`, is read under `audit_log:read` without
 * Organization reach. So the entry the preference write leaves names the scope, the chosen
 * ids and what changed, never whose preference it is. The rows read are the ones this
 * test's own write produced, by the object id the audit screen reports for them.
 */
describe('default ordering preference entries in the platform audit log (#470)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a customer-scoped write leaves no customer or Organization id in GET /admin/audit-log', async () => {
    const payment = await h.em().fork().findOneOrFail(PaymentMethod, { status: 'active' });
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/quick-order/preferences',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: { scope: 'customer', scopeId: TEST_CUSTOMER_ID, defaultPaymentMethodId: payment.id },
    });
    expect(put.statusCode, put.body).toBe(200);

    const read = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-log?filter[action]=quick_order.default_preference.update',
      cookies: { b2b_session: 'stub-admin-session' },
    });
    expect(read.statusCode, read.body).toBe(200);
    const rows = (read.json() as { data: Array<{ objectId: string; stateBefore: unknown; stateAfter: unknown }> }).data;
    const own = rows.filter(
      (row) => (row.stateAfter as { defaultPaymentMethodId?: string } | null)?.defaultPaymentMethodId === payment.id,
    );
    expect(own.length).toBeGreaterThanOrEqual(1);
    const recorded = JSON.stringify(own.map((row) => [row.stateBefore, row.stateAfter]));
    for (const sentinel of [TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID]) {
      expect(recorded, sentinel).not.toContain(sentinel);
    }
    expect(own[0]!.stateAfter).toMatchObject({ scope: 'customer', defaultPaymentMethodId: payment.id });
  });
});
