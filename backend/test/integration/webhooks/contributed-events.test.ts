import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { WebhookEventDescriptor, WebhookEventRegistryPort } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Organization, Webhook } from '../../helpers/package-entities.js';
import { BRIDGED_EVENT_TYPES } from '../../../../packages/modules/webhooks/src/backend/index.js';
import type { WebhookJobData } from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

/**
 * The contribution seam for webhook event types
 * (`specs/143-crm-sales-opportunities/contracts/events-and-ports.md` §6;
 * research R-27).
 *
 * A module pushes the event types it offers into `webhookEventRegistry`; each
 * is then bridged to the delivery queue through `webhooks`' own gated
 * subscription — exactly as the two built-in types are — and offered on the
 * subscription form while its owner is present. `webhooks` names no
 * contributor's event.
 *
 * The contributor here is a stand-in: an event type no module emits, owned by a
 * module an operator can switch off. What is observed is the job handed to the
 * delivery queue — the queue's `add` is replaced for the file, so nothing
 * reaches Redis and nothing is posted anywhere.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };
/** An operator-switchable module to stand as the owner of the contributed type. */
const OWNER = 'quote_requests';
const CONTRIBUTED = 'webhooks_test.contributed.v1';
const OTHER_ORG_ID = '00000000-0000-4000-8000-000000143b01';

describe('webhooks — contributed event types [integration]', () => {
  let h: BackendServerHandle;
  let registry: WebhookEventRegistryPort;
  let jobs: WebhookJobData[];
  let restoreQueue: () => void;

  /** Emit on the bus and wait until every subscriber of the event has finished. */
  const emitAndSettle = async (eventType: string, payload: Record<string, unknown>): Promise<string> => {
    const eventId = randomUUID();
    let off: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      off = h.eventBus.on(eventType as never, (seen: unknown) => {
        if ((seen as { eventId?: string }).eventId === eventId) resolve();
      });
    });
    try {
      h.eventBus.emit(eventType as never, { eventId, occurredAt: new Date().toISOString(), ...payload } as never);
      await settled;
    } finally {
      off();
    }
    return eventId;
  };

  const subscribe = async (eventTypes: string[], organizationId: string | null = null) => {
    const em = h.em();
    const webhook = em.create(Webhook, {
      name: `Contributed ${randomUUID().slice(0, 8)}`,
      url: `https://example.invalid/${randomUUID()}`,
      secret: 'shhh',
      eventTypes,
      status: 'active',
      organizationId,
    });
    await em.flush();
    return webhook.id as string;
  };

  const offeredTypes = async (): Promise<WebhookEventDescriptor[]> => {
    const response = await h.app.inject({ method: 'GET', url: '/api/v1/admin/webhooks/event-types', cookies: ADMIN });
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { data: WebhookEventDescriptor[] }).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    registry = h.container.resolve<WebhookEventRegistryPort>('webhookEventRegistry');

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

    const em = h.em();
    if (!(await em.findOne(Organization, { id: OTHER_ORG_ID }))) {
      em.create(Organization, {
        id: OTHER_ORG_ID,
        name: 'Contributed events other',
        taxId: `PL${String(Date.now()).slice(-10)}`,
        status: 'active',
        vatStatus: 'vat_payer',
        registeredAddress: { street: 'ul. Testowa 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
      });
      await em.flush();
    }

    // The contribution, as a contributor's boot hook makes it — and here made
    // after the boot phase has ended, which is the latest a push can arrive.
    registry.register({ ownerModuleId: OWNER, eventType: CONTRIBUTED });
  }, 60_000);

  beforeEach(() => {
    jobs.length = 0;
  });

  afterAll(async () => {
    restoreQueue?.();
    await teardownBackendServer(h);
  });

  it('a contributed type is bridged: one job per active subscription, carrying the event whole', async () => {
    const first = await subscribe([CONTRIBUTED]);
    const second = await subscribe([CONTRIBUTED, 'order.created.v1']);
    await subscribe(['order.created.v1']);

    const eventId = await emitAndSettle(CONTRIBUTED, { organizationId: TEST_ORGANIZATION_ID, subject: 'probe' });

    const mine = jobs.filter((job) => job.eventId === eventId);
    expect(mine.map((job) => job.webhookId).sort()).toEqual([first, second].sort());
    for (const job of mine) {
      expect(job.eventType).toBe(CONTRIBUTED);
      expect(job.payload).toMatchObject({ eventId, organizationId: TEST_ORGANIZATION_ID, subject: 'probe' });
    }
  });

  it('a subscription bound to an Organization receives only that Organization’s events', async () => {
    const bound = await subscribe([CONTRIBUTED], OTHER_ORG_ID);

    const foreign = await emitAndSettle(CONTRIBUTED, { organizationId: TEST_ORGANIZATION_ID });
    expect(jobs.filter((job) => job.eventId === foreign).map((job) => job.webhookId)).not.toContain(bound);

    const own = await emitAndSettle(CONTRIBUTED, { organizationId: OTHER_ORG_ID });
    expect(jobs.filter((job) => job.eventId === own).map((job) => job.webhookId)).toContain(bound);

    // Fail closed: an event that names no Organization reaches no bound subscription.
    const anonymous = await emitAndSettle(CONTRIBUTED, {});
    expect(jobs.filter((job) => job.eventId === anonymous).map((job) => job.webhookId)).not.toContain(bound);
  });

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'nothing is enqueued while webhooks is %s, and bridging resumes after',
    async (axis) => {
      const subscription = await subscribe([CONTRIBUTED]);
      await withModuleOff('webhooks', axis, async () => {
        const eventId = await emitAndSettle(CONTRIBUTED, { organizationId: TEST_ORGANIZATION_ID });
        expect(jobs.filter((job) => job.eventId === eventId)).toEqual([]);
      });
      const eventId = await emitAndSettle(CONTRIBUTED, { organizationId: TEST_ORGANIZATION_ID });
      expect(jobs.filter((job) => job.eventId === eventId).map((job) => job.webhookId)).toContain(subscription);
    },
  );

  it('registering the same type twice does not deliver twice', async () => {
    registry.register({ ownerModuleId: OWNER, eventType: CONTRIBUTED });
    registry.register({ ownerModuleId: OWNER, eventType: CONTRIBUTED });
    const subscription = await subscribe([CONTRIBUTED]);
    const eventId = await emitAndSettle(CONTRIBUTED, { organizationId: TEST_ORGANIZATION_ID });
    expect(jobs.filter((job) => job.eventId === eventId && job.webhookId === subscription)).toHaveLength(1);
    expect(registry.list().filter((descriptor) => descriptor.eventType === CONTRIBUTED)).toHaveLength(1);
  });

  it('the two built-in types are bridged exactly as before — once each, contributed or not', async () => {
    expect([...BRIDGED_EVENT_TYPES]).toEqual(['order.created.v1', 'order.status_changed.v1']);
    // A contributor naming a built-in type changes nothing about its delivery.
    registry.register({ ownerModuleId: OWNER, eventType: 'order.created.v1' });
    const subscription = await subscribe(['order.created.v1', 'order.status_changed.v1']);

    const created = await emitAndSettle('order.created.v1', { orderId: randomUUID(), organizationId: TEST_ORGANIZATION_ID });
    expect(jobs.filter((job) => job.eventId === created && job.webhookId === subscription)).toHaveLength(1);

    const changed = await emitAndSettle('order.status_changed.v1', {
      orderId: randomUUID(),
      organizationId: TEST_ORGANIZATION_ID,
      from: 'new',
      to: 'paid',
    });
    const delivered = jobs.filter((job) => job.eventId === changed && job.webhookId === subscription);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.eventType).toBe('order.status_changed.v1');
  });

  describe('GET /api/v1/admin/webhooks/event-types', () => {
    it('lists a contributed type while its owner is present', async () => {
      expect(await offeredTypes()).toContainEqual({ ownerModuleId: OWNER, eventType: CONTRIBUTED });
    });

    it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
      'omits it while its owner is %s, and offers it again after',
      async (axis) => {
        await withModuleOff(OWNER, axis, async () => {
          expect((await offeredTypes()).map((descriptor) => descriptor.eventType)).not.toContain(CONTRIBUTED);
          // Presence-blind, for diagnostics: the contribution itself is not forgotten.
          expect(registry.owners()).toContain(OWNER);
        });
        expect((await offeredTypes()).map((descriptor) => descriptor.eventType)).toContain(CONTRIBUTED);
      },
    );

    it('is the module’s own route: gated like its neighbours, and gone with the module', async () => {
      const anonymous = await h.app.inject({ method: 'GET', url: '/api/v1/admin/webhooks/event-types' });
      expect(anonymous.statusCode).toBe(401);
      await withModuleOff('webhooks', 'deactivated', async () => {
        const off = await h.app.inject({ method: 'GET', url: '/api/v1/admin/webhooks/event-types', cookies: ADMIN });
        expect(off.statusCode, off.body).toBe(503);
        expect(off.json().error.code).toBe('MODULE_DISABLED');
      });
    });
  });

  it('an existing subscription to a type whose owner is off stays stored', async () => {
    const subscription = await subscribe([CONTRIBUTED]);
    await withModuleOff(OWNER, 'deactivated', async () => {
      const row = await h.em().findOne(Webhook, { id: subscription });
      expect(row?.eventTypes).toEqual([CONTRIBUTED]);
    });
  });
});
