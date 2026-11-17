import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import { NewsletterSubscriberAdminService } from '../services/subscriber-admin.service.js';
import { NewsletterSubscriberService } from '../services/subscriber.service.js';
import { makeConfirmSubscriberCommand } from './confirm-subscriber.command.js';
import { makeDeactivateSubscriberCommand } from './deactivate-subscriber.command.js';
import { makeDeleteSubscriberCommand } from './delete-subscriber.command.js';
import { makeSubscribeSubscriberCommand, type SubscribeSubscriberPlan } from './subscribe-subscriber.command.js';
import { makeSuppressSubscriberCommand } from './suppress-subscriber.command.js';
import { makeUnsubscribeSubscriberCommand } from './unsubscribe-subscriber.command.js';

/**
 * Issue #1381 (Principle XIII): every subscriber write runs a Command on the
 * real {@link CommandBus}, so the write and its one audit entry share a
 * transaction. The fake ORM holds subscribers and suppressions in memory and a
 * recording audit port captures what the bus hands the audit log. The entries
 * keep the D-288 shape the module was swept to in #1024: names, statuses and
 * codes, never the address or a free-text reason.
 */

const SUB = '00000000-0000-4000-8000-000000138101';
const NEW_ID = '00000000-0000-4000-8000-000000138102';
const SUPPRESSION_ID = '00000000-0000-4000-8000-000000138103';
const UNKNOWN = '00000000-0000-4000-8000-0000001381ff';
const EMAIL = 's1381-person@example.test';
const REASON = 'S1381 too many mails';

type Row = Record<string, unknown> & { id: string; email: string };

function subscriber(overrides: Partial<NewsletterSubscriber> = {}): Row {
  return {
    id: SUB,
    email: EMAIL,
    status: 'active',
    source: 'footer',
    salesChannelId: null,
    customerAccountId: null,
    organizationId: null,
    customFields: {},
    consentAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: new Date('2026-01-01T00:00:00Z'),
    unsubscribedAt: null,
    unsubscribeReason: null,
    deactivatedAt: null,
    version: 2,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as Row;
}

function harness(options: { subscribers?: Row[]; suppressions?: Row[]; failFlush?: boolean } = {}) {
  const tables = new Map<unknown, Row[]>([
    [NewsletterSubscriber, [...(options.subscribers ?? [])]],
    [NewsletterSuppression, [...(options.suppressions ?? [])]],
  ]);
  const audits: Array<Record<string, unknown>> = [];
  const pendingCreates: Array<[unknown, Row]> = [];
  const pendingRemoves: Array<[unknown, Row]> = [];
  let flushes = 0;
  const rows = (entity: unknown): Row[] => tables.get(entity) ?? [];
  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const em = {
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return rows(entity).find((row) => matches(row, where)) ?? null;
    },
    async find() {
      return [];
    },
    create(entity: unknown, data: Record<string, unknown>) {
      const row = {
        id: (data['id'] as string | undefined) ?? NEW_ID,
        customFields: {},
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as unknown as Row;
      pendingCreates.push([entity, row]);
      return row;
    },
    assign(row: Row, data: Record<string, unknown>) {
      Object.assign(row, data);
    },
    remove(row: Row) {
      for (const [entity, list] of tables) if (list.includes(row)) pendingRemoves.push([entity, row]);
    },
    async flush() {
      if (options.failFlush) throw new Error('flush failed');
      flushes += 1;
      for (const [entity, row] of pendingCreates.splice(0)) rows(entity).push(row);
      for (const [entity, row] of pendingRemoves.splice(0)) {
        const list = rows(entity);
        list.splice(list.indexOf(row), 1);
      }
    },
    async transactional<T>(cb: (inner: EntityManager) => Promise<T>): Promise<T> {
      return cb(em as unknown as EntityManager);
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, input: Record<string, unknown>) {
      audits.push(input);
      return {} as never;
    },
    async record() {
      throw new Error('a subscriber write recorded its entry outside the Command Bus');
    },
  } as unknown as AuditPort;
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>());
  return {
    audits,
    bus,
    em: em as unknown as EntityManager,
    subscribers: () => rows(NewsletterSubscriber),
    suppressions: () => rows(NewsletterSuppression),
    flushes: () => flushes,
  };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('newsletter unit test: subscriber commands', fn);

/** No entry carries the address or the free-text reason (#470, D-288). */
function expectNoValues(audits: unknown): void {
  const text = JSON.stringify(audits);
  expect(text).not.toMatch(/s1381-person/i);
  expect(text).not.toMatch(/S1381 too many/);
}

function plan(overrides: Partial<SubscribeSubscriberPlan> = {}): SubscribeSubscriberPlan {
  return {
    subscriberId: NEW_ID,
    isNew: true,
    email: EMAIL,
    salesChannelId: null,
    mode: 'double',
    owner: { kind: 'anonymous' },
    source: 'storefront',
    ...overrides,
  };
}

describe('newsletter_subscribe / newsletter_resubscribe (issue #1381)', () => {
  it('creates a pending subscriber with the planned id and records exactly one entry, status and source only', async () => {
    const h = harness();
    const result = await asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())));

    expect(result).toEqual({ subscriberId: NEW_ID, status: 'pending' });
    expect(h.subscribers()).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_subscribe',
      objectType: 'newsletter_subscriber',
      objectId: NEW_ID,
      stateBefore: null,
      stateAfter: { status: 'pending', source: 'storefront' },
    });
    expectNoValues(h.audits);
  });

  it('re-subscribes an unsubscribed address under its id and lifts the self-unsubscribe suppression', async () => {
    const h = harness({
      subscribers: [subscriber({ status: 'unsubscribed' })],
      suppressions: [{ id: SUPPRESSION_ID, email: EMAIL, reason: 'unsubscribe', detail: REASON }],
    });
    await asSystem(() =>
      h.bus.run(makeSubscribeSubscriberCommand(plan({ subscriberId: SUB, isNew: false, mode: 'single' }))),
    );

    expect(h.subscribers()[0]!['status']).toBe('active');
    expect(h.suppressions()).toHaveLength(0);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_resubscribe',
      objectId: SUB,
      stateAfter: { status: 'active', source: 'storefront' },
    });
    expectNoValues(h.audits);
  });

  it('refuses 409 and records nothing when the planned row is no longer the one the address has', async () => {
    const h = harness({ subscribers: [subscriber()] });
    await expect(asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(h.audits).toHaveLength(0);
  });

  it('records no entry when the write fails', async () => {
    const h = harness({ failFlush: true });
    await expect(asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())))).rejects.toThrow('flush failed');
    expect(h.audits).toHaveLength(0);
  });
});

describe('newsletter_confirm (issue #1381)', () => {
  it('activates a pending subscriber and records exactly one entry', async () => {
    const h = harness({ subscribers: [subscriber({ status: 'pending', confirmedAt: null })] });
    const result = await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })));

    expect(result).toEqual({ ok: true });
    expect(h.subscribers()[0]!['status']).toBe('active');
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_confirm',
      objectType: 'newsletter_subscriber',
      objectId: SUB,
      stateAfter: { status: 'active' },
    });
  });

  it('records nothing for a subscriber that is not pending, an unknown id or a malformed one', async () => {
    const h = harness({ subscribers: [subscriber()] });
    expect(await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })))).toEqual({ ok: true });
    for (const subscriberId of [UNKNOWN, 'not-a-uuid']) {
      expect(await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId })))).toEqual({ ok: false });
    }
    expect(h.audits).toHaveLength(0);
  });
});

describe('newsletter_unsubscribe (issue #1381)', () => {
  it('unsubscribes, writes the suppression and records whether a reason was given, never its text', async () => {
    const h = harness({ subscribers: [subscriber()] });
    const result = await asSystem(() =>
      h.bus.run(makeUnsubscribeSubscriberCommand({ subscriberId: SUB, reason: REASON })),
    );

    expect(result).toEqual({ ok: true, unsubscribed: { subscriberId: SUB, email: EMAIL } });
    expect(h.suppressions()).toMatchObject([{ email: EMAIL, reason: 'unsubscribe' }]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_unsubscribe',
      objectId: SUB,
      stateAfter: { status: 'unsubscribed', hasReason: true },
    });
    expectNoValues(h.audits);
  });

  it('records nothing for an already-unsubscribed subscriber or an unknown id', async () => {
    const h = harness({ subscribers: [subscriber({ status: 'unsubscribed' })] });
    expect(await asSystem(() => h.bus.run(makeUnsubscribeSubscriberCommand({ subscriberId: SUB })))).toEqual({
      ok: true,
      unsubscribed: null,
    });
    expect(await asSystem(() => h.bus.run(makeUnsubscribeSubscriberCommand({ subscriberId: UNKNOWN })))).toEqual({
      ok: false,
      unsubscribed: null,
    });
    expect(h.audits).toHaveLength(0);
  });
});

describe('newsletter_bounce / newsletter_complaint (issue #1381)', () => {
  it('deactivates the subscriber and files the entry under it, the reason code only', async () => {
    const h = harness({ subscribers: [subscriber()] });
    await asSystem(() =>
      h.bus.run(
        makeSuppressSubscriberCommand({
          email: EMAIL,
          reason: 'complaint',
          detail: REASON,
          target: { objectType: 'newsletter_subscriber', objectId: SUB },
        }),
      ),
    );

    expect(h.subscribers()[0]!['status']).toBe('deactivated');
    expect(h.suppressions()).toMatchObject([{ email: EMAIL, reason: 'complaint' }]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_complaint',
      objectType: 'newsletter_subscriber',
      objectId: SUB,
      stateAfter: { reason: 'complaint' },
    });
    expectNoValues(h.audits);
  });

  it('files an address with no subscriber under the suppression row it creates', async () => {
    const h = harness();
    await asSystem(() =>
      h.bus.run(
        makeSuppressSubscriberCommand({
          email: EMAIL,
          reason: 'bounce',
          target: { objectType: 'newsletter_suppression', objectId: SUPPRESSION_ID, exists: false },
        }),
      ),
    );

    expect(h.suppressions()).toMatchObject([{ id: SUPPRESSION_ID, email: EMAIL, reason: 'bounce' }]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_bounce',
      objectType: 'newsletter_suppression',
      objectId: SUPPRESSION_ID,
    });
    expectNoValues(h.audits);
  });

  it('refuses 409 and records nothing when a subscriber appeared after the plan', async () => {
    const h = harness({ subscribers: [subscriber()] });
    await expect(
      asSystem(() =>
        h.bus.run(
          makeSuppressSubscriberCommand({
            email: EMAIL,
            reason: 'bounce',
            target: { objectType: 'newsletter_suppression', objectId: SUPPRESSION_ID, exists: false },
          }),
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(h.audits).toHaveLength(0);
  });
});

describe('newsletter_deactivate (issue #1381)', () => {
  it('deactivates a subscriber at the expected version and records exactly one entry', async () => {
    const h = harness({ subscribers: [subscriber()] });
    const result = await asSystem(() =>
      h.bus.run(makeDeactivateSubscriberCommand({ subscriberId: SUB, expectedVersion: 2 })),
    );

    expect(result.status).toBe('deactivated');
    expect(result.version).toBe(3);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_deactivate',
      objectId: SUB,
      stateAfter: { status: 'deactivated' },
    });
  });

  it('refuses 409 for a stale version and 404 for an unknown or malformed id, recording nothing', async () => {
    const h = harness({ subscribers: [subscriber()] });
    await expect(
      asSystem(() => h.bus.run(makeDeactivateSubscriberCommand({ subscriberId: SUB, expectedVersion: 1 }))),
    ).rejects.toMatchObject({ statusCode: 409 });
    for (const subscriberId of [UNKNOWN, 'not-a-uuid']) {
      await expect(
        asSystem(() => h.bus.run(makeDeactivateSubscriberCommand({ subscriberId, expectedVersion: 2 }))),
      ).rejects.toMatchObject({ statusCode: 404 });
    }
    expect(h.subscribers()[0]!['status']).toBe('active');
    expect(h.audits).toHaveLength(0);
  });
});

describe('newsletter_delete (issue #1381)', () => {
  it('deletes the subscriber, keeps the address suppressed and records one entry, the status before only', async () => {
    const h = harness({ subscribers: [subscriber()] });
    await asSystem(() => h.bus.run(makeDeleteSubscriberCommand({ subscriberId: SUB })));

    expect(h.subscribers()).toHaveLength(0);
    expect(h.suppressions()).toMatchObject([{ email: EMAIL, reason: 'unsubscribe', detail: 'deleted' }]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_delete',
      objectType: 'newsletter_subscriber',
      objectId: SUB,
      stateBefore: { status: 'active' },
      stateAfter: null,
    });
    expectNoValues(h.audits);
  });

  it('answers 404 for an unknown id and records nothing', async () => {
    const h = harness();
    await expect(
      asSystem(() => h.bus.run(makeDeleteSubscriberCommand({ subscriberId: UNKNOWN }))),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(h.audits).toHaveLength(0);
  });

  it('records no entry when the delete fails — before #1381 the entry was written first', async () => {
    const h = harness({ subscribers: [subscriber()], failFlush: true });
    await expect(asSystem(() => h.bus.run(makeDeleteSubscriberCommand({ subscriberId: SUB })))).rejects.toThrow(
      'flush failed',
    );
    expect(h.audits).toHaveLength(0);
  });
});

describe('the services run every subscriber write on the bus (issue #1381)', () => {
  function services(h: ReturnType<typeof harness>, events: string[] = []) {
    const subscribers = new NewsletterSubscriberService({
      emFactory: () => h.em,
      optIn: {
        resolveMode: async () => 'single',
        mintConfirmToken: async () => 'token',
      } as never,
      resolveDefaultChannelId: async () => null,
      links: { confirm: (t) => `c?${t}`, unsubscribe: (t) => `u?${t}` },
      customerAccounts: { findById: async () => null } as never,
      commandBus: h.bus,
      emitEvent: (name) => events.push(name),
    });
    const admin = new NewsletterSubscriberAdminService(() => h.em, h.bus);
    return { subscribers, admin };
  }

  it('subscribe, unsubscribe, deactivate and delete each record one entry and never call the audit log by hand', async () => {
    const h = harness();
    const events: string[] = [];
    const { subscribers, admin } = services(h, events);

    await asSystem(() => subscribers.subscribe({ email: ` ${EMAIL.toUpperCase()} `, salesChannelId: null }));
    const id = h.subscribers()[0]!.id;
    await asSystem(() => subscribers.subscribe({ email: EMAIL, salesChannelId: null }));
    await asSystem(() => subscribers.unsubscribe(id, REASON));
    await asSystem(() => subscribers.unsubscribe(id, REASON));
    const sub = h.subscribers()[0]!;
    sub['status'] = 'active';
    await asSystem(() => admin.deactivate(id, sub['version'] as number));
    await asSystem(() => admin.remove(id));

    expect(h.audits.map((entry) => entry['action'])).toEqual([
      'newsletter_subscribe',
      'newsletter_resubscribe',
      'newsletter_unsubscribe',
      'newsletter_deactivate',
      'newsletter_delete',
    ]);
    expect(new Set(h.audits.map((entry) => entry['objectId']))).toEqual(new Set([id]));
    expect(events).toEqual(['newsletter.subscribed.v1', 'newsletter.subscribed.v1', 'newsletter.unsubscribed.v1']);
    expectNoValues(h.audits);
  });

  it('suppress files an address with no subscriber under a suppression id and no address', async () => {
    const h = harness();
    const { subscribers } = services(h);
    await asSystem(() => subscribers.suppress(EMAIL.toUpperCase(), 'bounce'));

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'newsletter_bounce',
      objectType: 'newsletter_suppression',
      objectId: h.suppressions()[0]!.id,
    });
    expectNoValues(h.audits);
  });
});
