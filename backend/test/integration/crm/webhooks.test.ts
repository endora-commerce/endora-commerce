import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CRM_EVENTS,
  CRM_WEBHOOK_EVENT_SCHEMAS,
  CRM_WEBHOOK_EVENT_TYPES,
  OpportunityClosedEventV1Schema,
  OpportunityCreatedEventV1Schema,
  OpportunityStatusChangedEventV1Schema,
  type WebhookEventDescriptor,
  type WebhookEventRegistryPort,
} from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Webhook } from '../../helpers/package-entities.js';
import { CRM_SETTING_CODES } from '../../../../packages/modules/crm/src/manifest.js';
import type { WebhookJobData } from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';
import {
  changeOrderStatusAsOperator,
  CRM_ADMIN,
  createCrmOpportunity,
  linkCrmOrder,
  placeCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  seedCrmOrganization,
  setCrmMappings,
  setCrmSetting,
  transitionCrmOpportunity,
  whenCrmEventSettled,
} from '../../helpers/seed-crm.js';

/**
 * User Story 16 — other systems are told when an Opportunity changes status
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §6).
 *
 * CRM offers three of its events to the platform's webhooks through
 * `webhookEventRegistry`. What is observed is the job the delivery bridge hands
 * to its queue — the queue's `add` is replaced for the file, so nothing reaches
 * Redis and nothing is posted anywhere.
 */
describe('crm outbound webhooks (US16)', () => {
  let h: BackendServerHandle;
  let jobs: WebhookJobData[];
  let restoreQueue: () => void;
  let otherOrganizationId: string;

  const jobsFor = (opportunityId: string, eventType?: string) =>
    jobs.filter(
      (job) =>
        (job.payload as { opportunityId?: string }).opportunityId === opportunityId &&
        (eventType === undefined || job.eventType === eventType),
    );

  const subscribe = async (eventTypes: string[], organizationId: string | null = null) => {
    const em = h.em();
    const webhook = em.create(Webhook, {
      name: `CRM ${randomUUID().slice(0, 8)}`,
      url: `https://example.invalid/${randomUUID()}`,
      secret: 'shhh',
      eventTypes,
      status: 'active',
      organizationId,
    });
    await em.flush();
    return webhook.id as string;
  };

  /**
   * Move an Opportunity and wait until every subscriber of what it announces
   * last has finished: the close event for a closing status, the coarse status
   * event otherwise.
   */
  const transition = (opportunityId: string, to: string, reason?: string) =>
    whenCrmEventSettled(
      h,
      to === 'won' || to === 'lost' ? CRM_EVENTS.CLOSED : CRM_EVENTS.STATUS_CHANGED,
      (payload) => payload['opportunityId'] === opportunityId,
      async () => {
        const response = await transitionCrmOpportunity(h, opportunityId, to, CRM_ADMIN, reason);
        expect(response.statusCode, response.body).toBe(200);
      },
    );

  const offeredTypes = async (): Promise<WebhookEventDescriptor[]> => {
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/v1/admin/webhooks/event-types',
      cookies: CRM_ADMIN,
    });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: WebhookEventDescriptor[] }).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    otherOrganizationId = await seedCrmOrganization(h.em(), 'Webhooks other');
    const queue = (h.container.cradle as unknown as { webhookQueue: { add: (...args: unknown[]) => Promise<unknown> } })
      .webhookQueue;
    const original = queue.add;
    jobs = [];
    queue.add = async (_name: unknown, data: unknown) => {
      jobs.push(data as WebhookJobData);
      return undefined;
    };
    restoreQueue = () => {
      queue.add = original;
    };
  }, 60_000);

  beforeEach(() => {
    jobs.length = 0;
  });

  afterAll(async () => {
    restoreQueue?.();
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('contributes exactly its three event types, as their owner', async () => {
    const registry = h.container.resolve<WebhookEventRegistryPort>('webhookEventRegistry');
    expect(registry.owners()).toContain('crm');
    expect(
      registry
        .list()
        .filter((descriptor) => descriptor.ownerModuleId === 'crm')
        .map((descriptor) => descriptor.eventType),
    ).toEqual([...CRM_WEBHOOK_EVENT_TYPES]);
    expect((await offeredTypes()).filter((descriptor) => descriptor.ownerModuleId === 'crm')).toEqual(
      CRM_WEBHOOK_EVENT_TYPES.map((eventType) => ({ ownerModuleId: 'crm', eventType })),
    );
  });

  it('a manual transition enqueues exactly one status_changed delivery, whose payload parses under the strict schema', async () => {
    const subscription = await subscribe([CRM_EVENTS.STATUS_CHANGED]);
    const opportunity = await createCrmOpportunity(h);
    await transition(opportunity.id, 'qualified', 'Budget confirmed');

    const delivered = jobsFor(opportunity.id).filter((job) => job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe(CRM_EVENTS.STATUS_CHANGED);
    const payload = OpportunityStatusChangedEventV1Schema.parse(delivered[0]?.payload);
    expect(payload).toMatchObject({
      opportunityId: opportunity.id,
      number: opportunity.number,
      organizationId: TEST_ORGANIZATION_ID,
      from: 'new',
      to: 'qualified',
      fromKind: 'open',
      toKind: 'open',
      actor: { kind: 'admin' },
      cause: 'manual',
      reason: 'Budget confirmed',
    });
    expect(delivered[0]?.eventId).toBe(payload.eventId);
    // What is posted is the JSON of the payload: it parses after the round trip too.
    OpportunityStatusChangedEventV1Schema.parse(JSON.parse(JSON.stringify(delivered[0]?.payload)));
  });

  it('a transition caused by an Order enqueues one delivery naming the cause and the Order', async () => {
    const mapped = await setCrmMappings(h, [
      { direction: 'order_to_opportunity', orderStatusCode: 'paid', opportunityStatusCode: 'qualified' },
    ]);
    expect(mapped.statusCode, mapped.body).toBe(200);
    try {
      const subscription = await subscribe([CRM_EVENTS.STATUS_CHANGED]);
      const opportunity = await createCrmOpportunity(h);
      const order = await seedCrmOrder(h.em());
      expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
      await whenCrmEventSettled(
        h,
        CRM_EVENTS.STATUS_CHANGED,
        (payload) => payload['opportunityId'] === opportunity.id,
        () => changeOrderStatusAsOperator(h, order.id, 'paid'),
      );

      const delivered = jobsFor(opportunity.id, CRM_EVENTS.STATUS_CHANGED).filter(
        (job) => job.webhookId === subscription,
      );
      expect(delivered).toHaveLength(1);
      expect(OpportunityStatusChangedEventV1Schema.parse(delivered[0]?.payload)).toMatchObject({
        to: 'qualified',
        actor: { kind: 'system' },
        cause: 'order_status',
        causeOrderId: order.id,
        reason: null,
      });
    } finally {
      await restoreDefaultCrmWorkflow(h.em());
    }
  });

  it('creating and closing enqueue theirs — closed carries the outcome', async () => {
    const subscription = await subscribe([CRM_EVENTS.CREATED, CRM_EVENTS.CLOSED]);
    const opportunity = await whenCrmEventSettled(h, CRM_EVENTS.CREATED, () => true, () =>
      createCrmOpportunity(h, { manualValue: '1500.00' }),
    );

    const created = jobsFor(opportunity.id, CRM_EVENTS.CREATED).filter((job) => job.webhookId === subscription);
    expect(created).toHaveLength(1);
    expect(OpportunityCreatedEventV1Schema.parse(created[0]?.payload)).toMatchObject({
      opportunityId: opportunity.id,
      number: opportunity.number,
      organizationId: TEST_ORGANIZATION_ID,
      source: 'manual',
    });

    await transition(opportunity.id, 'lost');
    const closed = jobsFor(opportunity.id, CRM_EVENTS.CLOSED).filter((job) => job.webhookId === subscription);
    expect(closed).toHaveLength(1);
    expect(OpportunityClosedEventV1Schema.parse(closed[0]?.payload)).toEqual({
      eventId: expect.any(String),
      occurredAt: expect.any(String),
      opportunityId: opportunity.id,
      organizationId: TEST_ORGANIZATION_ID,
      outcome: 'lost',
      value: '1500.00',
      currency: 'PLN',
    });
    // Not subscribed to status changes: none was delivered to this subscription.
    expect(jobsFor(opportunity.id, CRM_EVENTS.STATUS_CHANGED).filter((job) => job.webhookId === subscription)).toEqual([]);
  });

  it('a subscription bound to one Organization receives only that Organization’s Opportunities', async () => {
    const bound = await subscribe([CRM_EVENTS.CREATED], otherOrganizationId);
    const foreign = await whenCrmEventSettled(h, CRM_EVENTS.CREATED, () => true, () => createCrmOpportunity(h));
    expect(jobsFor(foreign.id).map((job) => job.webhookId)).not.toContain(bound);
    const own = await whenCrmEventSettled(h, CRM_EVENTS.CREATED, () => true, () =>
      createCrmOpportunity(h, { organizationId: otherOrganizationId }),
    );
    expect(jobsFor(own.id).map((job) => job.webhookId)).toContain(bound);
  });

  it('every offered event the module emits parses under its strict schema', async () => {
    const seen: Array<{ eventType: string; payload: unknown }> = [];
    const offs = CRM_WEBHOOK_EVENT_TYPES.map((eventType) =>
      h.eventBus.on(eventType as never, (payload: unknown) => {
        seen.push({ eventType, payload });
      }),
    );
    await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, true);
    await h.em().execute(`update "stock_levels" set "on_hand" = 10000`);
    try {
      // By hand, with and without a value; moved, reopened, won, lost; and
      // created by the system for a placed Order.
      const withValue = await createCrmOpportunity(h, { manualValue: '10.00', description: 'Never in a payload' });
      const computed = await createCrmOpportunity(h, { valueMode: 'computed' });
      const bare = await createCrmOpportunity(h);
      await transition(withValue.id, 'qualified', 'A reason');
      await transition(withValue.id, 'proposal');
      await transition(withValue.id, 'won');
      await transition(computed.id, 'lost');
      await transition(computed.id, 'new');
      await transition(bare.id, 'lost');
      await whenCrmEventSettled(h, 'order.created.v1', () => true, () => placeCrmOrder(h));
    } finally {
      offs.forEach((off) => off());
      await setCrmSetting(h, CRM_SETTING_CODES.AUTO_CREATE_FROM_ORDERS, false);
    }

    const real = seen;
    const byType = (eventType: string) => real.filter((event) => event.eventType === eventType);
    expect(byType(CRM_EVENTS.CREATED).length).toBeGreaterThanOrEqual(4);
    expect(byType(CRM_EVENTS.STATUS_CHANGED).length).toBeGreaterThanOrEqual(6);
    expect(byType(CRM_EVENTS.CLOSED).length).toBeGreaterThanOrEqual(3);
    for (const { eventType, payload } of real) {
      const schema = CRM_WEBHOOK_EVENT_SCHEMAS[eventType as keyof typeof CRM_WEBHOOK_EVENT_SCHEMAS];
      const parsed = schema.safeParse(payload);
      expect(parsed.success, `${eventType}: ${JSON.stringify(parsed.error?.issues)} — ${JSON.stringify(payload)}`).toBe(true);
      expect(JSON.stringify(payload)).not.toContain('Never in a payload');
    }
    expect(
      byType(CRM_EVENTS.CREATED).map((event) => (event.payload as { source: string }).source),
    ).toContain('order');
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with webhooks %s the transition succeeds and nothing is enqueued',
    async (axis) => {
      await subscribe([...CRM_WEBHOOK_EVENT_TYPES]);
      const opportunity = await createCrmOpportunity(h);
      jobs.length = 0;
      await withModuleOff('webhooks', axis, async () => {
        await transition(opportunity.id, 'lost');
        expect(jobs).toEqual([]);
      });
      // Not delivered later either: what was emitted meanwhile is gone.
      expect(jobsFor(opportunity.id)).toEqual([]);
      // Back on, the next change is delivered.
      await transition(opportunity.id, 'new');
      expect(jobsFor(opportunity.id, CRM_EVENTS.STATUS_CHANGED).length).toBeGreaterThan(0);
    },
  );

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with crm %s its three types are not offered, and are offered again after',
    async (axis) => {
      await withModuleOff('crm', axis, async () => {
        expect((await offeredTypes()).filter((descriptor) => descriptor.ownerModuleId === 'crm')).toEqual([]);
        // A subscription naming one stays stored, and is neither refused nor removed.
        const stored = await subscribe([CRM_EVENTS.STATUS_CHANGED]);
        expect((await h.em().findOne(Webhook, { id: stored }))?.eventTypes).toEqual([CRM_EVENTS.STATUS_CHANGED]);
      });
      expect(
        (await offeredTypes()).filter((descriptor) => descriptor.ownerModuleId === 'crm').map((d) => d.eventType),
      ).toEqual([...CRM_WEBHOOK_EVENT_TYPES]);
    },
  );
});
