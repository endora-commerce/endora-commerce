import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { PaymentMethod } from '../../helpers/package-entities.js';

/**
 * Feature 039 (US2 / FR-018) — admin manages default preferences on behalf of
 * an organization. The stub admin has no sales-rep assignments → platform
 * admin → may manage any scope.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('Admin quick-order default preferences', () => {
  let h: BackendServerHandle;
  let paymentId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    paymentId = (await h.em().findOne(PaymentMethod, { status: 'active' }))!.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quick-order/preferences?scope=organization&scopeId=${TEST_ORGANIZATION_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets a platform admin set and read an organization-scope default', async () => {
    const put = await h.app.inject({
      method: 'PUT',
      url: '/api/v1/admin/quick-order/preferences',
      cookies: ADMIN_COOKIE,
      payload: {
        scope: 'organization',
        scopeId: TEST_ORGANIZATION_ID,
        defaultPaymentMethodId: paymentId,
      },
    });
    expect(put.statusCode).toBe(200);

    const get = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/quick-order/preferences?scope=organization&scopeId=${TEST_ORGANIZATION_ID}`,
      cookies: ADMIN_COOKIE,
    });
    expect(get.statusCode).toBe(200);
    expect(
      (get.json() as { data: { defaultPaymentMethodId: string } }).data.defaultPaymentMethodId,
    ).toBe(paymentId);
  });
});
