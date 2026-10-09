import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  QUOTE_REQUEST_WEBHOOK_EVENTS,
  QUOTE_REQUEST_WEBHOOK_EVENT_TYPES,
  RfqCreatedEventV1Schema,
  RfqExpiredEventV1Schema,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import {
  captureWebhookJobs,
  clearWebhookSubscriptions,
  createWebhookSubscription,
  eventsDispatchedBy,
  offeredWebhookEventTypes,
  storeWebhookSubscription,
  whenEventDelivered,
  type WebhookJobCapture,
} from '../../helpers/webhook-deliveries.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const { CREATED, EXPIRED } = QUOTE_REQUEST_WEBHOOK_EVENTS;

/**
 * `quote_requests` offers two of its events to outbound webhooks:
 * `rfq.created.v1` and `rfq.expired.v1`.
 *
 * It pushes the names into `webhookEventRegistry`; `webhooks` names neither.
 * Every case causes the event the way it really happens — a customer submits a
 * Quote Request through the storefront API, the composed expiry worker sweeps —
 * and observes the job the delivery bridge hands to its queue.
 *
 * A Quote Request is one Organization's data. Both payloads carry
 * `organizationId` and nothing of the request's content, and a subscription
 * bound to another Organization receives neither.
 */
describe('quote_requests outbound webhooks — rfq.created / rfq.expired', () => {
  let h: BackendServerHandle;
  let capture: WebhookJobCapture;

  const jobsFor = (rfqId: string, eventType?: string) =>
    capture.jobs.filter(
      (job) =>
        (job.payload as { rfqId?: string }).rfqId === rfqId && (eventType === undefined || job.eventType === eventType),
    );

  const submit = (payload: Record<string, unknown>) =>
    h.app.inject({ method: 'POST', url: '/api/v1/quote-requests', cookies: CUSTOMER, payload });

  const submitQuoteRequest = async (): Promise<string> => {
    const response = await whenEventDelivered(h, CREATED, () => true, () =>
      submit({
        headerNote: 'Never in a payload',
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 3, lineNote: 'Never in a payload' }],
      }),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { data: { id: string } }).data.id;
  };

  /** Make the request overdue and run the composed expiry worker — the sweep the scheduler runs. */
  const expire = async (rfqId: string): Promise<void> => {
    await h.em().nativeUpdate(QuoteRequest, { id: rfqId }, { updatedAt: new Date(Date.now() - 400 * 86_400_000) });
    const worker = (
      h.container.cradle as unknown as {
        quoteRequests: { handle(): { expiryWorker: { sweep(): Promise<{ expiredCount: number }> } } };
      }
    ).quoteRequests.handle().expiryWorker;
    const swept = await whenEventDelivered(h, EXPIRED, (payload) => payload['rfqId'] === rfqId, () => worker.sweep());
    expect(swept.expiredCount).toBeGreaterThanOrEqual(1);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedOtherTestOrganization(h.em());
    // The sweep is a no-op until an expiry is configured.
    await h.settings.adminService.setValueForAllChannels(
      QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
      14,
      null,
      { actorAdminUserId: null },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    capture = captureWebhookJobs(h);
  }, 60_000);

  beforeEach(async () => {
    await clearWebhookSubscriptions(h);
    capture.clear();
  });

  afterAll(async () => {
    capture?.restore();
    await h.settings.adminService.setValueForAllChannels(
      QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS,
      0,
      null,
      { actorAdminUserId: null },
    );
    await teardownBackendServer(h);
  });

  it('contributes exactly its two event types, as their owner', async () => {
    const registry = h.container.resolve<WebhookEventRegistryPort>('webhookEventRegistry');
    expect(registry.owners()).toContain('quote_requests');
    expect(
      registry
        .list()
        .filter((descriptor) => descriptor.ownerModuleId === 'quote_requests')
        .map((descriptor) => descriptor.eventType),
    ).toEqual(['rfq.created.v1', 'rfq.expired.v1']);
    expect(
      (await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'quote_requests'),
    ).toEqual(QUOTE_REQUEST_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'quote_requests', eventType })));
  });

  it('the API accepts a subscription to each of the two', async () => {
    const response = await createWebhookSubscription(h, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES);
    expect(response.statusCode, response.body).toBe(201);
  });

  it('a customer submitting a Quote Request enqueues one rfq.created.v1 delivery carrying the documented payload', async () => {
    const subscription = await storeWebhookSubscription(h, [CREATED]);
    const rfqId = await submitQuoteRequest();

    const delivered = jobsFor(rfqId).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(CREATED);
    const payload = RfqCreatedEventV1Schema.parse(delivered[0]?.payload);
    expect(payload).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      rfqId,
      organizationId: TEST_ORGANIZATION_ID,
    });
    expect(delivered[0]?.eventId).toBe(payload.eventId);
    RfqCreatedEventV1Schema.parse(JSON.parse(JSON.stringify(delivered[0]?.payload)));
    expect(JSON.stringify(delivered[0]?.payload)).not.toContain('Never in a payload');
  });

  it('the expiry sweep enqueues one rfq.expired.v1 delivery carrying the documented payload', async () => {
    const rfqId = await submitQuoteRequest();
    const subscription = await storeWebhookSubscription(h, [EXPIRED]);
    capture.clear();

    await expire(rfqId);

    const delivered = jobsFor(rfqId).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(EXPIRED);
    const payload = RfqExpiredEventV1Schema.parse(delivered[0]?.payload);
    expect(payload).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      rfqId,
      organizationId: TEST_ORGANIZATION_ID,
    });
    expect(delivered[0]?.eventId).toBe(payload.eventId);
  });

  it('a subscription bound to an Organization receives only that Organization’s Quote Requests — created and expired', async () => {
    const own = await storeWebhookSubscription(h, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES, TEST_ORGANIZATION_ID);
    const foreign = await storeWebhookSubscription(h, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES, OTHER_TEST_ORGANIZATION_ID);

    const rfqId = await submitQuoteRequest();
    await expire(rfqId);

    const receivers = (eventType: string) => jobsFor(rfqId, eventType).map((job) => job.webhookId);
    expect(receivers(CREATED)).toContain(own);
    expect(receivers(EXPIRED)).toContain(own);
    expect(receivers(CREATED)).not.toContain(foreign);
    expect(receivers(EXPIRED)).not.toContain(foreign);
  });

  it('an event type no subscription names enqueues nothing', async () => {
    // Subscribed to expiry only: the submission is emitted and bridged, and has no receiver.
    await storeWebhookSubscription(h, [EXPIRED]);
    const rfqId = await submitQuoteRequest();
    expect(jobsFor(rfqId)).toEqual([]);
  });

  it('a submission that is refused announces nothing and enqueues nothing', async () => {
    await storeWebhookSubscription(h, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES);
    capture.clear();
    const { result, seen } = await eventsDispatchedBy(h, CREATED, () =>
      submit({ items: [{ productId: '00000000-0000-4000-8000-00000000dead', quantity: 1 }] }),
    );
    expect(result.statusCode, result.body).toBe(404);
    expect(seen).toEqual([]);
    expect(capture.jobs).toEqual([]);
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with webhooks %s the submission succeeds and nothing is enqueued',
    async (axis) => {
      await storeWebhookSubscription(h, QUOTE_REQUEST_WEBHOOK_EVENT_TYPES);
      capture.clear();
      let rfqId = '';
      await withModuleOff('webhooks', axis, async () => {
        rfqId = await submitQuoteRequest();
        expect(capture.jobs).toEqual([]);
      });
      // Not delivered later either: what was emitted meanwhile is gone.
      expect(jobsFor(rfqId)).toEqual([]);
      // Back on, the next submission is delivered.
      const next = await submitQuoteRequest();
      expect(jobsFor(next, CREATED).length).toBeGreaterThan(0);
    },
  );

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with quote_requests %s its two types are not offered and not accepted, and are again after',
    async (axis) => {
      await withModuleOff('quote_requests', axis, async () => {
        expect(
          (await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'quote_requests'),
        ).toEqual([]);
        const refused = await createWebhookSubscription(h, [CREATED]);
        expect(refused.statusCode, refused.body).toBe(422);
        expect((refused.json() as { error: { code: string } }).error.code).toBe('WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE');
        // The module's own surface is gone with it, so nothing can cause the event.
        expect((await submit({ items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] })).statusCode).toBe(503);
      });
      expect(
        (await offeredWebhookEventTypes(h))
          .filter((descriptor) => descriptor.ownerModuleId === 'quote_requests')
          .map((descriptor) => descriptor.eventType),
      ).toEqual([...QUOTE_REQUEST_WEBHOOK_EVENT_TYPES]);
      expect((await createWebhookSubscription(h, [CREATED])).statusCode).toBe(201);
    },
  );
});
