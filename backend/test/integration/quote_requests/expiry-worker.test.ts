import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { RfqExpiryWorker } from '../../../src/modules/quote_requests/services/rfq-expiry-worker.js';
import { RfqEventService } from '../../../src/modules/quote_requests/services/rfq-event-service.js';
import { RfqNotificationService } from '../../../src/modules/quote_requests/services/rfq-notification-service.js';
import { SalesRepAssignmentService } from '../../../src/modules/organizations/services/sales-rep-assignment-service.js';
import { EventBus } from '../../../src/events/bus.js';

/**
 * T074 — Expiry worker honours `quote_requests.expiryDays`.
 *
 * `expiryDays = 0` → no-op.
 * `expiryDays = N` → flips Pending / Created from admin past
 *   `now() - INTERVAL N days` to Expired with a `expired` event row.
 */
describe('RfqExpiryWorker (US7 / T074)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  function buildWorker(resolveExpiryDays: () => Promise<number>): RfqExpiryWorker {
    return new RfqExpiryWorker({
      emFactory: () => h.em(),
      events: new EventBus() as unknown as RfqExpiryWorker['deps' & 'events'] extends never ? never : never,
      eventService: new RfqEventService(() => h.em()),
      notificationService: new RfqNotificationService(() => h.em()),
      salesRepAssignment: new SalesRepAssignmentService(() => h.em()),
      resolveExpiryDays,
    } as never);
  }

  it('expiryDays=0 is a no-op', async () => {
    const worker = buildWorker(async () => 0);
    const result = await worker.sweep();
    expect(result.expiredCount).toBe(0);
  });

  it('flips Pending RFQs older than expiryDays to Expired', async () => {
    // Create a Pending RFQ
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: { b2b_session: 'stub-customer-session' },
      payload: {
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
      },
    });
    const id = (created.json() as { data: { id: string } }).data.id;

    // Backdate updatedAt by 30 days so it's past the threshold
    await h.em().nativeUpdate(
      (await import('../../../src/modules/quote_requests/entities/quote-request.entity.js'))
        .QuoteRequest,
      { id },
      { updatedAt: new Date(Date.now() - 30 * 86_400_000) },
    );

    const worker = buildWorker(async () => 14);
    const result = await worker.sweep();
    expect(result.expiredCount).toBeGreaterThanOrEqual(1);

    // Verify status flipped
    const after = await h.app.inject({
      method: 'GET',
      url: `/api/v1/quote-requests/${id}`,
      cookies: { b2b_session: 'stub-customer-session' },
    });
    const detail = (after.json() as { data: { status: string; events: Array<{ eventType: string }> } }).data;
    expect(detail.status).toBe('Expired');
    expect(detail.events.map((e) => e.eventType)).toContain('expired');
  });
});
