import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import type { WebhookEventDescriptor } from '@endora-commerce/contracts';
import type { BackendServerHandle } from './test-server.js';
import { Webhook } from './package-entities.js';
import type { WebhookJobData } from '../../../packages/modules/webhooks/src/backend/services/webhook-queue.js';

/**
 * What a module's "my events reach webhooks" test needs, once.
 *
 * The observation point is the job the delivery bridge hands to its queue: the
 * composed queue's `add` is replaced for the file, so nothing reaches Redis and
 * nothing is posted anywhere. Everything in front of it is the composed
 * application — the owning module's real emit, the bus, the bridge's gated
 * subscription and the subscription lookup against the database.
 */

const ADMIN = { b2b_session: 'stub-admin-session' };

export interface WebhookJobCapture {
  /** Every job enqueued since the last `clear()`, in order. */
  readonly jobs: WebhookJobData[];
  clear(): void;
  restore(): void;
}

/** Record what the composed delivery bridge enqueues instead of enqueuing it. */
export function captureWebhookJobs(h: BackendServerHandle): WebhookJobCapture {
  const queue = (h.container.cradle as unknown as { webhookQueue: { add: (...args: unknown[]) => Promise<unknown> } })
    .webhookQueue;
  const original = queue.add;
  const jobs: WebhookJobData[] = [];
  queue.add = async (_name: unknown, data: unknown) => {
    jobs.push(data as WebhookJobData);
    return undefined;
  };
  return {
    jobs,
    clear: () => {
      jobs.length = 0;
    },
    restore: () => {
      queue.add = original;
    },
  };
}

/**
 * An active subscription written straight to the table — platform-wide unless
 * an Organization is named. Not through the API, so a test can also store a
 * name the API would refuse.
 */
export async function storeWebhookSubscription(
  h: BackendServerHandle,
  eventTypes: readonly string[],
  organizationId: string | null = null,
): Promise<string> {
  const em = h.em();
  const webhook = em.create(Webhook, {
    name: `Subscription ${randomUUID().slice(0, 8)}`,
    url: `https://example.invalid/${randomUUID()}`,
    secret: 'shhh',
    eventTypes: [...eventTypes],
    status: 'active',
    organizationId,
  });
  await em.flush();
  return webhook.id as string;
}

/**
 * Remove every stored subscription, so that "nobody is subscribed to this
 * type" is a fact about the table and not about the order the tests ran in.
 */
export async function clearWebhookSubscriptions(h: BackendServerHandle): Promise<void> {
  await h.em().nativeDelete(Webhook, {});
}

/** `POST /api/v1/admin/webhooks` — the write an operator makes, validation included. */
export function createWebhookSubscription(h: BackendServerHandle, eventTypes: readonly string[]) {
  return h.app.inject({
    method: 'POST',
    url: '/api/v1/admin/webhooks',
    cookies: ADMIN,
    payload: {
      name: `Subscription ${randomUUID().slice(0, 8)}`,
      url: 'https://receiver.example.com/hook',
      eventTypes: [...eventTypes],
    },
  });
}

/** `GET /api/v1/admin/webhooks/event-types` — what the subscription form offers beside the built-in types. */
export async function offeredWebhookEventTypes(h: BackendServerHandle): Promise<WebhookEventDescriptor[]> {
  const response = await h.app.inject({ method: 'GET', url: '/api/v1/admin/webhooks/event-types', cookies: ADMIN });
  expect(response.statusCode, response.body).toBe(200);
  return (response.json() as { data: WebhookEventDescriptor[] }).data;
}

/**
 * Run `act` and wait until every subscriber of the `eventName` it causes has
 * finished — the first event that satisfies `matches`.
 *
 * The bus dispatches to its handlers one after another and awaits each, so a
 * handler registered here, after the composed application's own, runs once the
 * delivery bridge has returned. That is what lets a test assert what the bridge
 * enqueued, or that it enqueued nothing, without sleeping.
 */
export async function whenEventDelivered<T>(
  h: BackendServerHandle,
  eventName: string,
  matches: (payload: Record<string, unknown>) => boolean,
  act: () => Promise<T>,
): Promise<T> {
  let off: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    off = h.eventBus.on(eventName as never, (payload: unknown) => {
      if (matches((payload ?? {}) as Record<string, unknown>)) resolve();
    });
  });
  try {
    const result = await act();
    await settled;
    return result;
  } finally {
    off();
  }
}

/**
 * Run `act` and report every `eventName` the bus dispatched within `settleMs`
 * of it returning — for the cases where the claim is that **nothing** was
 * announced, which no awaited event can show.
 */
export async function eventsDispatchedBy<T>(
  h: BackendServerHandle,
  eventName: string,
  act: () => Promise<T>,
  settleMs = 750,
): Promise<{ result: T; seen: Array<Record<string, unknown>> }> {
  const seen: Array<Record<string, unknown>> = [];
  const off = h.eventBus.on(eventName as never, (payload: unknown) => {
    seen.push((payload ?? {}) as Record<string, unknown>);
  });
  try {
    const result = await act();
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    return { result, seen };
  } finally {
    off();
  }
}

/**
 * Run `act` and answer what a reader with a connection of its own saw **at the
 * moment** each `eventName` was emitted.
 *
 * `read` is started synchronously inside `emit`, before any subscriber runs, so
 * its answer does not depend on how long the subscribers registered ahead of a
 * test's own take — the search indexer alone can outlast a commit. That is what
 * makes "the event is emitted after the write is saved" a measurement: emitted
 * too early, the read is on its way before the write is.
 */
export async function readAtEmit<T, R>(
  h: BackendServerHandle,
  eventName: string,
  read: (payload: Record<string, unknown>) => Promise<R>,
  act: () => Promise<T>,
): Promise<{ result: T; reads: R[] }> {
  const bus = h.eventBus as unknown as { emit: (name: string, payload: unknown) => void };
  const original = bus.emit;
  const pending: Array<Promise<R>> = [];
  bus.emit = function emit(this: unknown, name: string, payload: unknown): void {
    if (name === eventName) pending.push(read((payload ?? {}) as Record<string, unknown>));
    original.call(this, name, payload);
  };
  try {
    const result = await act();
    return { result, reads: await Promise.all(pending) };
  } finally {
    bus.emit = original;
  }
}

/**
 * Install a deferred constraint trigger on `table` for the length of `act`.
 *
 * A deferred constraint is checked by COMMIT, after every statement of the
 * transaction has succeeded, so `body` runs at the latest point a write can
 * still be slowed down (`perform pg_sleep(1); return null;`) or refused
 * (`raise exception '…';`).
 */
export async function atCommitOf<T>(
  h: BackendServerHandle,
  table: string,
  operation: 'insert' | 'update',
  body: string,
  act: () => Promise<T>,
): Promise<T> {
  const name = `webhook_test_at_commit_${table}`;
  await h.em().execute(`
    create function ${name}() returns trigger language plpgsql as $$
    begin
      ${body}
    end $$;
    create constraint trigger ${name}
      after ${operation} on "${table}"
      deferrable initially deferred
      for each row execute function ${name}();
  `);
  try {
    return await act();
  } finally {
    await h.em().execute(`
      drop trigger ${name} on "${table}";
      drop function ${name}();
    `);
  }
}
