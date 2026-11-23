/**
 * Issue #1843 — `newsletter`'s three hookable actions on the subscriber
 * (`specs/176-command-hooks-outbox/`, `contracts/command-hooks-api.md` §6).
 *
 * Each Command is held to its ref with `expectHookableCommand`, and run on a
 * real `CommandBus` with a sealed hook registry, so what is checked is what a
 * hook author is handed: ids and codes only — never the address — on the
 * Command's own transaction; a hook module that is switched off is skipped;
 * a `beforeCommit` veto rolls the subscriber write back with its entry; and an
 * `afterCommit` handler gets one outbox row written in the same transaction.
 *
 * The fake ORM keeps its tables in memory and restores them when the
 * transaction callback throws, so "rolled back" is a measurement here; the
 * Postgres proof is `backend/test/integration/newsletter/hookable-actions.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import {
  defineModuleErrorCodes,
  NEWSLETTER_HOOKABLE_ACTIONS as NL,
  type NewsletterSubscriberHookData,
} from '@endora-commerce/contracts';
import { CommandBus, CommandHookRefusal, type CommandHookEntry } from '@endora-commerce/platform/commands';
import { EventBus, type EventBase } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { withSystemScope } from '@endora-commerce/platform/tenancy';
import { expectHookableCommand, recordingCommandHooks, sealedCommandHookRegistry } from '@endora-commerce/test-kit/command-hooks';
import { manifest } from '../../manifest.js';
import { NewsletterSubscriberTag } from '../entities/newsletter-subscriber-tag.entity.js';
import { NewsletterSubscriber } from '../entities/newsletter-subscriber.entity.js';
import { NewsletterSuppression } from '../entities/newsletter-suppression.entity.js';
import { NewsletterTag } from '../entities/newsletter-tag.entity.js';
import { makeConfirmSubscriberCommand } from './confirm-subscriber.command.js';
import { makeSubscribeSubscriberCommand, type SubscribeSubscriberPlan } from './subscribe-subscriber.command.js';

const ACME = defineModuleErrorCodes(['ACME_REWARDS_REFUSED']);
const SUB = '00000000-0000-4000-8000-000000184301';
const NEW_ID = '00000000-0000-4000-8000-000000184302';
const CHANNEL = '00000000-0000-4000-8000-000000184303';
const ACCOUNT = '00000000-0000-4000-8000-000000184304';
const ORG = '00000000-0000-4000-8000-000000184305';
const TAG_A = '00000000-0000-4000-8000-0000001843a1';
const TAG_B = '00000000-0000-4000-8000-0000001843b2';
const EMAIL = 's1843-person@example.test';
const HOOK_MODULE = 'acme_rewards';
/** The hook module's own veto code, as a deployment's module would declare it. */

type Row = Record<string, unknown>;

function subscriberRow(overrides: Row = {}): Row {
  return {
    id: SUB,
    email: EMAIL,
    status: 'pending',
    source: 'footer',
    salesChannelId: CHANNEL,
    customerAccountId: null,
    organizationId: null,
    customFields: {},
    consentAt: new Date('2026-01-01T00:00:00Z'),
    confirmedAt: null,
    version: 1,
    ...overrides,
  };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in (value as Record<string, unknown>)) {
      return ((value as { $in: unknown[] }).$in).includes(row[key]);
    }
    return row[key] === value;
  });
}

function harness(options: {
  subscribers?: Row[];
  hooks: ReadonlyArray<{ moduleId: string; entries: readonly CommandHookEntry[] }>;
  isPresent?: (moduleId: string) => boolean;
}) {
  const tables = new Map<unknown, Row[]>([
    [NewsletterSubscriber, [...(options.subscribers ?? [])]],
    [NewsletterSuppression, []],
    [NewsletterTag, [
      { id: TAG_A, code: 's1843-news' },
      { id: TAG_B, code: 's1843-offers' },
    ]],
    [NewsletterSubscriberTag, []],
  ]);
  const committedAudits: Row[] = [];
  const committedOutbox: Row[] = [];
  let audits: Row[] = [];
  let outbox: Row[] = [];
  let pendingCreates: Array<[unknown, Row]> = [];
  const rows = (entity: unknown): Row[] => tables.get(entity) ?? [];

  const em = {
    async findOne(entity: unknown, where: Record<string, unknown>) {
      return rows(entity).find((row) => matches(row, where)) ?? null;
    },
    async find(entity: unknown, where: Record<string, unknown>) {
      return rows(entity).filter((row) => matches(row, where));
    },
    create(entity: unknown, data: Row) {
      const row = { customFields: {}, version: 1, ...data };
      pendingCreates.push([entity, row]);
      return row;
    },
    assign(row: Row, data: Row) {
      Object.assign(row, data);
    },
    remove(row: Row) {
      for (const list of tables.values()) if (list.includes(row)) list.splice(list.indexOf(row), 1);
    },
    persist(row: Row) {
      outbox.push(row);
      return em;
    },
    async flush() {
      for (const [entity, row] of pendingCreates.splice(0)) rows(entity).push(row);
    },
    async transactional<T>(cb: (inner: EntityManager) => Promise<T>): Promise<T> {
      const snapshot = new Map([...tables].map(([entity, list]) => [entity, list.map((row) => ({ ...row }))]));
      audits = [];
      outbox = [];
      pendingCreates = [];
      try {
        const result = await cb(em as unknown as EntityManager);
        committedAudits.push(...audits);
        committedOutbox.push(...outbox);
        return result;
      } catch (error) {
        for (const [entity, list] of snapshot) tables.set(entity, list);
        throw error;
      }
    },
  };
  const orm = { em: { fork: () => em } } as unknown as MikroORM;
  const audit = {
    recordWithin(_em: EntityManager, input: Row) {
      audits.push(input);
      return {} as never;
    },
  } as unknown as AuditPort;
  const registry = sealedCommandHookRegistry({
    hookableActions: (manifest.hookableActions ?? []).map((declaration) => ({ moduleId: 'newsletter', ...declaration })),
    moduleDependencies: { [HOOK_MODULE]: ['newsletter'] },
    hooks: options.hooks,
    ...(options.isPresent ? { isPresent: options.isPresent } : {}),
  });
  const bus = new CommandBus(orm, audit, new EventBus<Record<string, EventBase>>(), { hooks: registry });
  return {
    bus,
    audits: committedAudits,
    outbox: committedOutbox,
    subscribers: () => rows(NewsletterSubscriber),
    links: () => rows(NewsletterSubscriberTag),
  };
}

const asSystem = <T>(fn: () => Promise<T>): Promise<T> =>
  withSystemScope('newsletter unit test: hookable actions', fn);

function plan(overrides: Partial<SubscribeSubscriberPlan> = {}): SubscribeSubscriberPlan {
  return {
    subscriberId: NEW_ID,
    isNew: true,
    email: EMAIL,
    salesChannelId: CHANNEL,
    mode: 'double',
    owner: { kind: 'customer', customerAccountId: ACCOUNT, organizationId: ORG },
    source: 'storefront',
    tags: ['s1843-offers', 's1843-news', 's1843-unknown'],
    ...overrides,
  };
}

const sample: NewsletterSubscriberHookData = {
  subscriberId: SUB,
  status: 'active',
  previousStatus: 'pending',
  salesChannelId: CHANNEL,
  customerAccountId: ACCOUNT,
  organizationId: ORG,
  tagIds: [TAG_A, TAG_B],
};

/** Nothing a hook or a handler is handed carries the address. */
function expectNoAddress(value: unknown): void {
  expect(JSON.stringify(value)).not.toMatch(/s1843-person/i);
}

describe('newsletter declares three hookable actions (issue #1843)', () => {
  it('lists the refs in its manifest, for both phases', () => {
    expect(manifest.hookableActions).toEqual(
      [NL.subscribe, NL.resubscribe, NL.confirm].map((ref) => ({
        action: ref.action,
        objectType: ref.objectType,
        phases: ['beforeCommit', 'afterCommit'],
      })),
    );
  });

  it('subscribe and resubscribe supply hookData and list-1 outboxData', () => {
    expectHookableCommand(makeSubscribeSubscriberCommand(plan()), NL.subscribe, { result: sample, sentinels: ['s1843-person'] });
    expectHookableCommand(makeSubscribeSubscriberCommand(plan({ subscriberId: SUB, isNew: false })), NL.resubscribe, {
      result: sample,
      sentinels: ['s1843-person'],
    });
  });

  it('confirm supplies hookData and list-1 outboxData', () => {
    expectHookableCommand(makeConfirmSubscriberCommand({ subscriberId: SUB }), NL.confirm, {
      result: sample,
      sentinels: ['s1843-person'],
    });
  });
});

describe('newsletter.subscriber.subscribe runs its hooks', () => {
  it('hands a beforeCommit hook ids and codes on the uncommitted write, and an afterCommit handler one outbox row', async () => {
    const recording = recordingCommandHooks();
    let seenOnTransaction: unknown = null;
    const h = harness({
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            recording.on(NL.subscribe, {
              then: async (ctx) => {
                seenOnTransaction = await ctx.em.findOne(NewsletterSubscriber, { id: ctx.objectId });
              },
            }),
            { id: 'grant-code', on: NL.subscribe, phase: 'afterCommit', handler: async () => undefined },
          ],
        },
      ],
    });

    const result = await asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())));

    expect(result).toMatchObject({ subscriberId: NEW_ID, status: 'pending' });
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]).toMatchObject({ action: 'newsletter.subscriber.subscribe', objectId: NEW_ID });
    expect(recording.calls[0]!.data).toEqual({
      subscriberId: NEW_ID,
      status: 'pending',
      previousStatus: null,
      salesChannelId: CHANNEL,
      customerAccountId: ACCOUNT,
      organizationId: ORG,
      tagIds: [TAG_A, TAG_B],
    });
    expect(seenOnTransaction).toMatchObject({ id: NEW_ID, status: 'pending' });
    expectNoAddress(recording.calls);

    expect(h.audits.map((entry) => entry['action'])).toEqual(['newsletter.subscriber.subscribe']);
    expect(h.outbox).toHaveLength(1);
    expect(h.outbox[0]).toMatchObject({
      action: 'newsletter.subscriber.subscribe',
      objectType: 'newsletter_subscriber',
      objectId: NEW_ID,
      organizationId: ORG,
      hookModule: HOOK_MODULE,
      hookId: 'grant-code',
      data: {
        subscriberId: NEW_ID,
        status: 'pending',
        previousStatus: null,
        salesChannelId: CHANNEL,
        customerAccountId: ACCOUNT,
        organizationId: ORG,
        tagIds: [TAG_A, TAG_B],
      },
    });
    expectNoAddress(h.outbox);
  });

  it('runs the resubscribe hooks, with the status the address had before', async () => {
    const recording = recordingCommandHooks();
    const h = harness({
      subscribers: [subscriberRow({ status: 'unsubscribed', confirmedAt: new Date('2026-01-01T00:00:00Z') })],
      hooks: [{ moduleId: HOOK_MODULE, entries: [recording.on(NL.resubscribe), recording.on(NL.subscribe)] }],
    });

    await asSystem(() =>
      h.bus.run(makeSubscribeSubscriberCommand(plan({ subscriberId: SUB, isNew: false, mode: 'single', tags: [] }))),
    );

    expect(recording.calls.map((call) => call.action)).toEqual(['newsletter.subscriber.resubscribe']);
    expect(recording.calls[0]!.data).toMatchObject({ subscriberId: SUB, status: 'active', previousStatus: 'unsubscribed' });
  });

  it('skips a hook whose module is switched off: no call, no outbox row, the write unchanged', async () => {
    const recording = recordingCommandHooks();
    const h = harness({
      isPresent: (moduleId) => moduleId !== HOOK_MODULE,
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            recording.on(NL.subscribe, {
              then: () => {
                throw new CommandHookRefusal(409, ACME.ACME_REWARDS_REFUSED, 'An off module refused.');
              },
            }),
            { id: 'grant-code', on: NL.subscribe, phase: 'afterCommit', handler: async () => undefined },
          ],
        },
      ],
    });

    await asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())));

    expect(recording.calls).toHaveLength(0);
    expect(h.outbox).toHaveLength(0);
    expect(h.subscribers()).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
  });

  it('rolls the subscriber, its tags and its entry back when a beforeCommit hook vetoes', async () => {
    const h = harness({
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            {
              id: 'refuse',
              on: NL.subscribe,
              phase: 'beforeCommit',
              handler: () => {
                throw new CommandHookRefusal(409, ACME.ACME_REWARDS_REFUSED, 'Refused by the rewards module.');
              },
            },
            { id: 'grant-code', on: NL.subscribe, phase: 'afterCommit', handler: async () => undefined },
          ],
        },
      ],
    });

    await expect(asSystem(() => h.bus.run(makeSubscribeSubscriberCommand(plan())))).rejects.toMatchObject({
      statusCode: 409,
      code: 'ACME_REWARDS_REFUSED',
    });
    expect(h.subscribers()).toHaveLength(0);
    expect(h.links()).toHaveLength(0);
    expect(h.audits).toHaveLength(0);
    expect(h.outbox).toHaveLength(0);
  });
});

describe('newsletter.subscriber.confirm runs its hooks', () => {
  it('hands a beforeCommit hook the activation and an afterCommit handler one outbox row', async () => {
    const recording = recordingCommandHooks();
    const h = harness({
      subscribers: [subscriberRow({ customerAccountId: ACCOUNT, organizationId: ORG })],
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            recording.on(NL.confirm),
            { id: 'grant-code', on: NL.confirm, phase: 'afterCommit', handler: async () => undefined },
          ],
        },
      ],
    });
    h.links().push({ subscriberId: SUB, tagId: TAG_B }, { subscriberId: SUB, tagId: TAG_A });

    await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })));

    const expected = {
      subscriberId: SUB,
      status: 'active',
      previousStatus: 'pending',
      salesChannelId: CHANNEL,
      customerAccountId: ACCOUNT,
      organizationId: ORG,
      tagIds: [TAG_A, TAG_B],
    };
    expect(recording.calls).toHaveLength(1);
    expect(recording.calls[0]).toMatchObject({ action: 'newsletter.subscriber.confirm', objectId: SUB, data: expected });
    expect(h.audits).toMatchObject([{ action: 'newsletter.subscriber.confirm', stateAfter: { status: 'active' } }]);
    expect(h.outbox).toMatchObject([
      { action: 'newsletter.subscriber.confirm', objectId: SUB, organizationId: ORG, hookId: 'grant-code', data: expected },
    ]);
    expectNoAddress([recording.calls, h.outbox]);
  });

  it('skips a hook whose module is switched off', async () => {
    const recording = recordingCommandHooks();
    const h = harness({
      subscribers: [subscriberRow()],
      isPresent: (moduleId) => moduleId !== HOOK_MODULE,
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            recording.on(NL.confirm),
            { id: 'grant-code', on: NL.confirm, phase: 'afterCommit', handler: async () => undefined },
          ],
        },
      ],
    });

    await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })));

    expect(recording.calls).toHaveLength(0);
    expect(h.outbox).toHaveLength(0);
    expect(h.subscribers()[0]!['status']).toBe('active');
  });

  it('leaves the subscriber pending and records nothing when a beforeCommit hook vetoes', async () => {
    const h = harness({
      subscribers: [subscriberRow()],
      hooks: [
        {
          moduleId: HOOK_MODULE,
          entries: [
            {
              id: 'refuse',
              on: NL.confirm,
              phase: 'beforeCommit',
              handler: () => {
                throw new CommandHookRefusal(409, ACME.ACME_REWARDS_REFUSED, 'Refused by the rewards module.');
              },
            },
          ],
        },
      ],
    });

    await expect(asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(h.subscribers()[0]).toMatchObject({ status: 'pending', confirmedAt: null });
    expect(h.audits).toHaveLength(0);
  });

  it('hands the hooks an unchanged status when the subscriber stopped being pending before the write', async () => {
    const recording = recordingCommandHooks();
    const h = harness({
      subscribers: [subscriberRow({ status: 'active', confirmedAt: new Date('2026-01-02T00:00:00Z') })],
      hooks: [{ moduleId: HOOK_MODULE, entries: [recording.on(NL.confirm)] }],
    });

    await asSystem(() => h.bus.run(makeConfirmSubscriberCommand({ subscriberId: SUB })));

    expect(recording.calls[0]!.data).toMatchObject({ status: 'active', previousStatus: 'active' });
    expect(h.audits).toHaveLength(0);
  });
});
