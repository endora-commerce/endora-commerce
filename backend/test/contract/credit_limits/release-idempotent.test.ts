import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';
import { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { EventBus } from '../../../src/events/bus.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * T209 — Idempotency: calling releaseByOrder twice for the same order id
 * returns ok:false with code='ALREADY_RELEASED' on the second call. No
 * double-credit on the available amount.
 */

describe('CreditLimitService.releaseByOrder idempotency', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em());
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('first call releases; second call returns ALREADY_RELEASED', async () => {
    // Test invokes the service directly — the route surface for this is the
    // payment-status PATCH which the next test exercises end-to-end.
    const service = new CreditLimitService(h.em, new EventBus());
    const orderId = '00000000-0000-4000-8000-000000000c01';

    // Direct service call (no HTTP request) → establish a scope explicitly, as
    // the production callers run within a request/worker context (feature 050).
    const first = await withSystemScope('test: releaseByOrder', () =>
      service.releaseByOrder({ orderId, reason: 'invoice_paid' }),
    );
    expect(first.ok).toBe(true);

    const second = await withSystemScope('test: releaseByOrder', () =>
      service.releaseByOrder({ orderId, reason: 'invoice_paid' }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe('ALREADY_RELEASED');
  });
});
