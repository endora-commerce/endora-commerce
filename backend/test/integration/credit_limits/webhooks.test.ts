import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CREDIT_LIMIT_WEBHOOK_EVENTS,
  CREDIT_LIMIT_WEBHOOK_EVENT_TYPES,
  CreditLimitAdjustedEventV1Schema,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { seedCreditLimitWithActiveReservation } from '../../helpers/seed-credit-limit.js';
import { seedOtherTestOrganization } from '../../helpers/seed-organizations.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { CreditLimit } from '../../helpers/package-entities.js';
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
import type { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';

const ADMIN = { b2b_session: 'stub-admin-session' };
const { ADJUSTED } = CREDIT_LIMIT_WEBHOOK_EVENTS;

/**
 * `credit_limits` offers one of its events to outbound webhooks:
 * `credit_limit.adjusted.v1`.
 *
 * It pushes the name into `webhookEventRegistry`; `webhooks` does not name it.
 * Every case causes the event the way it really happens — an administrator
 * adjusts a limit through the admin API, a settled return is credited through
 * the composed service — and observes the job the delivery bridge hands to its
 * queue.
 *
 * A credit limit is one Organization's financial data. The payload carries
 * `organizationId` and the new granted amount, and a subscription bound to
 * another Organization does not receive it.
 */
describe('credit_limits outbound webhooks — credit_limit.adjusted', () => {
  let h: BackendServerHandle;
  let capture: WebhookJobCapture;

  const jobsFor = (organizationId: string) =>
    capture.jobs.filter(
      (job) => (job.payload as { organizationId?: string }).organizationId === organizationId,
    );

  const adjust = (organizationId: string, payload: Record<string, unknown>) =>
    h.app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/organizations/${organizationId}/credit-limit`,
      payload,
      cookies: ADMIN,
    });

  const adjustAndSettle = async (organizationId: string, grantedAmount: number): Promise<void> => {
    const response = await whenEventDelivered(
      h,
      ADJUSTED,
      (payload) => payload['organizationId'] === organizationId,
      () => adjust(organizationId, { grantedAmount }),
    );
    expect(response.statusCode, response.body).toBe(200);
  };

  const grantedAmount = async (organizationId: string): Promise<string | undefined> =>
    (await h.em().findOne(CreditLimit, { organizationId }))?.grantedAmount;

  beforeAll(async () => {
    h = await setupBackendServer();
    await seedCreditLimitWithActiveReservation(h.em()); // grants 10000 to the test Organization, reserves 5000
    await seedOtherTestOrganization(h.em());
    capture = captureWebhookJobs(h);
  }, 60_000);

  beforeEach(async () => {
    await clearWebhookSubscriptions(h);
    capture.clear();
  });

  afterAll(async () => {
    capture?.restore();
    await teardownBackendServer(h);
  });

  it('contributes exactly its one event type, as its owner', async () => {
    const registry = h.container.resolve<WebhookEventRegistryPort>('webhookEventRegistry');
    expect(registry.owners()).toContain('credit_limits');
    expect(
      registry
        .list()
        .filter((descriptor) => descriptor.ownerModuleId === 'credit_limits')
        .map((descriptor) => descriptor.eventType),
    ).toEqual(['credit_limit.adjusted.v1']);
    expect(
      (await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'credit_limits'),
    ).toEqual(CREDIT_LIMIT_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'credit_limits', eventType })));
  });

  it('the API accepts a subscription to it', async () => {
    const response = await createWebhookSubscription(h, CREDIT_LIMIT_WEBHOOK_EVENT_TYPES);
    expect(response.statusCode, response.body).toBe(201);
  });

  it('an administrator adjusting a limit enqueues one delivery carrying the documented payload', async () => {
    const subscription = await storeWebhookSubscription(h, [ADJUSTED]);
    await adjustAndSettle(TEST_ORGANIZATION_ID, 8000);

    const delivered = jobsFor(TEST_ORGANIZATION_ID).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(ADJUSTED);
    const payload = CreditLimitAdjustedEventV1Schema.parse(delivered[0]?.payload);
    expect(payload).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      organizationId: TEST_ORGANIZATION_ID,
      amount: 8000,
    });
    expect(delivered[0]?.eventId).toBe(payload.eventId);
    CreditLimitAdjustedEventV1Schema.parse(JSON.parse(JSON.stringify(delivered[0]?.payload)));
  });

  it('a settled return credited to the limit enqueues one delivery carrying the new total, and a retry none', async () => {
    const subscription = await storeWebhookSubscription(h, [ADJUSTED]);
    await adjustAndSettle(TEST_ORGANIZATION_ID, 9000);
    capture.clear();
    const service = h.container.resolve<CreditLimitService>('creditLimitService');
    const credit = { organizationId: TEST_ORGANIZATION_ID, amount: 250.5, currency: 'PLN', returnCaseId: randomUUID() };

    const first = await whenEventDelivered(
      h,
      ADJUSTED,
      (payload) => payload['organizationId'] === TEST_ORGANIZATION_ID,
      () => withSystemScope('credit_limits webhooks test — return settlement', () => service.creditFromReturn(credit)),
    );
    expect(first).toMatchObject({ applied: true, alreadyApplied: false });

    const delivered = jobsFor(TEST_ORGANIZATION_ID).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(CreditLimitAdjustedEventV1Schema.parse(delivered[0]?.payload)).toMatchObject({
      organizationId: TEST_ORGANIZATION_ID,
      amount: 9250.5,
    });

    // The same return case again credits nothing, so it announces nothing.
    capture.clear();
    const retry = await eventsDispatchedBy(h, ADJUSTED, () =>
      withSystemScope('credit_limits webhooks test — return settlement retry', () => service.creditFromReturn(credit)),
    );
    expect(retry.result).toMatchObject({ applied: true, alreadyApplied: true });
    expect(retry.seen).toEqual([]);
    expect(capture.jobs).toEqual([]);
  });

  it('a subscription bound to an Organization receives only that Organization’s adjustments', async () => {
    const own = await storeWebhookSubscription(h, [ADJUSTED], TEST_ORGANIZATION_ID);
    const foreign = await storeWebhookSubscription(h, [ADJUSTED], OTHER_TEST_ORGANIZATION_ID);

    await adjustAndSettle(TEST_ORGANIZATION_ID, 7000);

    const receivers = jobsFor(TEST_ORGANIZATION_ID).map((job) => job.webhookId);
    expect(receivers).toContain(own);
    expect(receivers).not.toContain(foreign);
    // And nothing at all was enqueued for the foreign subscription.
    expect(capture.jobs.map((job) => job.webhookId)).not.toContain(foreign);
  });

  it('an adjustment that is refused announces nothing and enqueues nothing', async () => {
    await storeWebhookSubscription(h, [ADJUSTED]);
    capture.clear();
    const before = await grantedAmount(TEST_ORGANIZATION_ID);
    // 5000 is reserved; lowering the limit beneath it without the override is refused.
    const { result, seen } = await eventsDispatchedBy(h, ADJUSTED, () =>
      adjust(TEST_ORGANIZATION_ID, { grantedAmount: 1000 }),
    );
    expect(result.statusCode, result.body).toBe(409);
    expect(await grantedAmount(TEST_ORGANIZATION_ID)).toBe(before);
    expect(seen).toEqual([]);
    expect(capture.jobs).toEqual([]);
  });

  it('an adjustment that fails at commit announces nothing and enqueues nothing', async () => {
    await storeWebhookSubscription(h, [ADJUSTED]);
    capture.clear();
    const before = await grantedAmount(TEST_ORGANIZATION_ID);
    // A deferred constraint is checked by COMMIT, after every statement of the
    // transaction has succeeded — the latest point the write can still fail.
    await h.em().execute(`
      create function credit_limit_webhooks_fail_at_commit() returns trigger language plpgsql as $$
      begin
        raise exception 'credit_limits webhooks test: forced failure at commit';
      end $$;
      create constraint trigger credit_limit_webhooks_fail_at_commit
        after update on "credit_limits"
        deferrable initially deferred
        for each row execute function credit_limit_webhooks_fail_at_commit();
    `);
    try {
      const { result, seen } = await eventsDispatchedBy(h, ADJUSTED, () =>
        adjust(TEST_ORGANIZATION_ID, { grantedAmount: 6500 }),
      );
      expect(result.statusCode, result.body).toBe(500);
      expect(seen).toEqual([]);
    } finally {
      await h.em().execute(`
        drop trigger credit_limit_webhooks_fail_at_commit on "credit_limits";
        drop function credit_limit_webhooks_fail_at_commit();
      `);
    }
    expect(await grantedAmount(TEST_ORGANIZATION_ID)).toBe(before);
    expect(capture.jobs).toEqual([]);
  });

  it('an event type no subscription names enqueues nothing', async () => {
    // A subscription to another type only: the adjustment is emitted and bridged, and has no receiver.
    await storeWebhookSubscription(h, ['order.created.v1']);
    capture.clear();
    await adjustAndSettle(TEST_ORGANIZATION_ID, 7500);
    expect(capture.jobs.filter((job) => job.eventType === ADJUSTED)).toEqual([]);
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with webhooks %s the adjustment succeeds and nothing is enqueued',
    async (axis) => {
      await storeWebhookSubscription(h, [ADJUSTED]);
      capture.clear();
      await withModuleOff('webhooks', axis, async () => {
        await adjustAndSettle(TEST_ORGANIZATION_ID, 7600);
        expect(capture.jobs).toEqual([]);
      });
      // Not delivered later either: what was emitted meanwhile is gone.
      expect(capture.jobs).toEqual([]);
      // Back on, the next adjustment is delivered.
      await adjustAndSettle(TEST_ORGANIZATION_ID, 7700);
      expect(jobsFor(TEST_ORGANIZATION_ID).length).toBeGreaterThan(0);
    },
  );

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with credit_limits %s its type is not offered and not accepted, and is again after',
    async (axis) => {
      await withModuleOff('credit_limits', axis, async () => {
        expect(
          (await offeredWebhookEventTypes(h)).filter((descriptor) => descriptor.ownerModuleId === 'credit_limits'),
        ).toEqual([]);
        const refused = await createWebhookSubscription(h, [ADJUSTED]);
        expect(refused.statusCode, refused.body).toBe(422);
        expect((refused.json() as { error: { code: string } }).error.code).toBe('WEBHOOK_EVENT_TYPE_NOT_DELIVERABLE');
        // The module's own surface is gone with it, so nothing can cause the event.
        expect((await adjust(TEST_ORGANIZATION_ID, { grantedAmount: 7800 })).statusCode).toBe(503);
      });
      expect(
        (await offeredWebhookEventTypes(h))
          .filter((descriptor) => descriptor.ownerModuleId === 'credit_limits')
          .map((descriptor) => descriptor.eventType),
      ).toEqual([...CREDIT_LIMIT_WEBHOOK_EVENT_TYPES]);
      expect((await createWebhookSubscription(h, [ADJUSTED])).statusCode).toBe(201);
    },
  );
});
