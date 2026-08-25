import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { bridgeEventHandler } from '../../../../packages/modules/webhooks/src/backend/services/event-bridge.js';
import { BRIDGED_EVENT_TYPES } from '../../../../packages/modules/webhooks/src/backend/index.js';
import { WebhookService } from '../../../../packages/modules/webhooks/src/backend/services/webhook-service.js';
import type { WebhookJobData } from '../../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

/**
 * Feature 062 / T026 — org-scoped event-bridge fan-out (contracts/order-webhooks.md §2).
 *
 * The bridge extracts `organizationId` from the event payload and asks the
 * subscription lookup for active subscriptions matching the event type where
 * the subscription is platform-wide (`organizationId` NULL) OR bound to the
 * event's organization. An event WITHOUT an `organizationId` must never reach
 * an org-scoped subscription (fail closed — Principle XI).
 *
 * Uses the real `WebhookService` lookup over a stubbed EntityManager so the
 * filter under test is the production one, not a test double.
 */

const ORG_A = '00000000-0000-4000-8000-0000000000aa';
const ORG_B = '00000000-0000-4000-8000-0000000000bb';

interface WebhookRow {
  id: string;
  url: string;
  secret: string;
  status: 'active' | 'paused';
  eventTypes: string[];
  organizationId: string | null;
}

function makeRow(over: Partial<WebhookRow> & { id: string }): WebhookRow {
  return {
    url: `https://receiver.example.com/${over.id}`,
    secret: `secret-${over.id}`,
    status: 'active',
    eventTypes: ['order.created.v1', 'order.status_changed.v1'],
    organizationId: null,
    ...over,
  };
}

function makeHarness(rows: WebhookRow[]): {
  bus: EventBus;
  jobs: WebhookJobData[];
  unwire: () => void;
} {
  // Stub EM: the service queries `{ status: 'active' }` and filters
  // eventTypes + organization in application code.
  const fakeEm = {
    find: async (_entity: unknown, where: { status?: string }) =>
      rows.filter((r) => (where.status ? r.status === where.status : true)),
  };
  const service = new WebhookService(() => fakeEm as unknown as EntityManager);
  const bus = new EventBus();
  const jobs: WebhookJobData[] = [];
  const queue = {
    add: vi.fn(async (_name: string, data: WebhookJobData) => {
      jobs.push(data);
      return undefined as never;
    }),
  };
  const offs = BRIDGED_EVENT_TYPES.map((eventType) =>
    bus.on(eventType, bridgeEventHandler(eventType, { queue, subscriptionLookup: service })),
  );
  const unwire = (): void => offs.forEach((off) => off());
  return { bus, jobs, unwire };
}

async function emitAndSettle(
  bus: EventBus,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  // `run` buffers + awaits handler dispatch, giving deterministic settling.
  await bus.run(async () => {
    bus.emit(eventType, {
      eventId: `evt-${Math.random().toString(36).slice(2)}`,
      occurredAt: new Date().toISOString(),
      ...payload,
    });
  });
}

describe('event bridge — org-scoped subscription fan-out (062/T026)', () => {
  it('delivers an org event to platform-wide + matching-org subscriptions only', async () => {
    const { bus, jobs, unwire } = makeHarness([
      makeRow({ id: 'sub-org-a', organizationId: ORG_A }),
      makeRow({ id: 'sub-org-b', organizationId: ORG_B }),
      makeRow({ id: 'sub-platform', organizationId: null }),
    ]);
    await emitAndSettle(bus, 'order.created.v1', { orderId: 'o1', organizationId: ORG_A });
    unwire();

    const targets = jobs.map((j) => j.webhookId).sort();
    expect(targets).toEqual(['sub-org-a', 'sub-platform']);
  });

  it('fail closed: an event without organizationId never reaches org-scoped subscriptions', async () => {
    const { bus, jobs, unwire } = makeHarness([
      makeRow({ id: 'sub-org-a', organizationId: ORG_A }),
      makeRow({ id: 'sub-platform', organizationId: null }),
    ]);
    await emitAndSettle(bus, 'order.created.v1', { orderId: 'o2' });
    unwire();

    expect(jobs.map((j) => j.webhookId)).toEqual(['sub-platform']);
  });

  it('respects the eventTypes gate alongside the org filter', async () => {
    const { bus, jobs, unwire } = makeHarness([
      makeRow({ id: 'sub-status-only', organizationId: ORG_A, eventTypes: ['order.status_changed.v1'] }),
      makeRow({ id: 'sub-platform', organizationId: null }),
    ]);
    await emitAndSettle(bus, 'order.created.v1', { orderId: 'o3', organizationId: ORG_A });
    unwire();

    expect(jobs.map((j) => j.webhookId)).toEqual(['sub-platform']);
  });

  it('paused subscriptions are excluded even when the organization matches', async () => {
    const { bus, jobs, unwire } = makeHarness([
      makeRow({ id: 'sub-paused', organizationId: ORG_A, status: 'paused' }),
      makeRow({ id: 'sub-active', organizationId: ORG_A }),
    ]);
    await emitAndSettle(bus, 'order.created.v1', { orderId: 'o4', organizationId: ORG_A });
    unwire();

    expect(jobs.map((j) => j.webhookId)).toEqual(['sub-active']);
  });

  it('a non-uuid-string organizationId payload value is treated as absent (fail closed)', async () => {
    const { bus, jobs, unwire } = makeHarness([
      makeRow({ id: 'sub-org-a', organizationId: ORG_A }),
      makeRow({ id: 'sub-platform', organizationId: null }),
    ]);
    await emitAndSettle(bus, 'order.created.v1', { orderId: 'o5', organizationId: 42 });
    unwire();

    expect(jobs.map((j) => j.webhookId)).toEqual(['sub-platform']);
  });
});
