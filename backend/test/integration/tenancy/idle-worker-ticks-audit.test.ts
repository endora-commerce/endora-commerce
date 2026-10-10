import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EmailMailerSendInput, EmailMailerSendOutcome } from '@endora-commerce/contracts';
import { SalesChannel, enterSystemScope } from '@endora-commerce/platform/kernel';
import { attachEscapeHatchAuditWriter } from '@endora-commerce/platform/lifecycle';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { getTenantContext, runWithoutTenantContext } from '../../../src/tenancy/tenant-context.js';
import { Order, PriceList } from '../../helpers/package-entities.js';
import { TEST_ADMIN_ID, TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { createCrmOpportunity, restoreDefaultCrmWorkflow, seedCrmOrganization } from '../../helpers/seed-crm.js';
import { crmEventReminderRow, seedCrmEventRow } from '../../helpers/seed-crm-events.js';
import { setChannelStorefrontUrl, seedFeedPrices } from '../../helpers/seed-product-feeds.js';
import { OrderTransitionEffectService } from '../../../../packages/modules/orders/src/backend/services/order-transition-effect-service.js';
import type { OrderTransitionEffectHandlers } from '../../../../packages/modules/orders/src/backend/services/order-transition-effect-handlers.js';
import {
  SWEEP_SCOPE_REASON,
  runTransitionEffectSweepTick,
} from '../../../../packages/modules/orders/src/backend/workers/transition-effect-sweep-worker.js';
import type { EventReminderService } from '../../../../packages/modules/crm/src/backend/services/event-reminder-service.js';
import {
  EVENT_REMINDER_SCOPE_REASON,
  runEventReminderJob,
} from '../../../../packages/modules/crm/src/backend/workers/event-reminder-worker.js';
import { FeedRunService } from '../../../../packages/modules/product_feeds/src/backend/services/feed-run.service.js';
import { FEED_REAPER_SCOPE_REASON } from '../../../../packages/modules/product_feeds/src/backend/services/queues/feed-generation-queue.js';
import { runFeedRunReaperTick } from '../../../../packages/modules/product_feeds/src/backend/workers/feed-run-reaper-worker.js';
import { PriceListStatusWorker } from '../../../../packages/modules/price_lists/src/backend/services/price-list-status-worker.js';
import {
  STATUS_SWEEP_SCOPE_REASON,
  statusSweepTick,
} from '../../../../packages/modules/price_lists/src/backend/plugin.js';

/**
 * Issue #120 — a tick of a scheduled worker that finds nothing to do writes no
 * `tenant.escape_hatch` audit row; a tick that does work still writes its row.
 *
 * **Against the real writer.** The shared test server composes without
 * `composeApp`, so it attaches no escape-hatch audit writer and a scope entry
 * there only reaches stderr. This file attaches the production writer itself
 * (`attachEscapeHatchAuditWriter`, what `composeApp` calls) and reads
 * `audit_log_entries`, because the defect was rows: one per idle tick, 1,440 a
 * day for a sixty-second worker on an instance where nothing happened.
 *
 * **What is driven is the function each consumer hands to its scheduler** —
 * the BullMQ processor, the interval callback's body — with no ambient tenant
 * context (`runWithoutTenantContext`), which is how a worker meets it. The
 * harness's default `system` context would otherwise hide a probe that only
 * works inside a scope.
 *
 * The rows are **summed over `occurrences`**, per reason: the writer aggregates
 * identical crossings of one flush window into one row, and this file flushes
 * by hand, so several ticks with work are one row counting several.
 */

const IDLE_TICKS = 3;

describe('idle worker ticks write no escape-hatch audit row (issue #120)', () => {
  let h: BackendServerHandle;
  let emFactory: () => EntityManager;
  let writer: ReturnType<typeof attachEscapeHatchAuditWriter>;

  const mailer = {
    async send(_input: EmailMailerSendInput): Promise<EmailMailerSendOutcome> {
      return { status: 'sent' };
    },
  };

  beforeAll(async () => {
    h = await setupBackendServer({ organizationsMailer: mailer });
    emFactory = h.container.resolve('emFactory') as () => EntityManager;
    writer = attachEscapeHatchAuditWriter({
      em: () => h.orm.em.fork() as EntityManager,
      // Never on a timer here: every case flushes by hand, so what it counts
      // is what it caused.
      flushIntervalMs: 3_600_000,
      log: () => undefined,
    });
  });

  afterAll(async () => {
    await writer.detach();
    await teardownBackendServer(h);
  });

  /** Escape-hatch accesses recorded in `audit_log_entries` for one reason. */
  async function recorded(reason: string): Promise<number> {
    await writer.flush();
    expect(writer.pendingCount, 'the audit writer could not persist its records').toBe(0);
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select coalesce(sum(("state_after"->>'occurrences')::int), 0)::text as "n"
           from "audit_log_entries"
          where "action" = 'tenant.escape_hatch' and "state_after"->>'reason' = ?`,
        [reason],
      )) as Array<{ n: string }>;
    return Number(rows[0]!.n);
  }

  /** Run one tick the way its scheduler does: with nothing ambient. */
  const asWorker = <T>(tick: () => Promise<T>): Promise<T> =>
    runWithoutTenantContext(async () => {
      expect(getTenantContext(), 'a worker tick starts with no tenant context').toBeUndefined();
      return tick();
    });

  // --- orders: outstanding order follow-ups, every 60 s -----------------------

  describe('orders — the order follow-up sweep', () => {
    const stock = vi.fn<OrderTransitionEffectHandlers['stock.release']>(async () => ({
      outcome: 'done' as const,
      result: { released: 1 },
    }));
    const credit = vi.fn<OrderTransitionEffectHandlers['credit.release']>(async () => ({
      outcome: 'done' as const,
      result: { ok: true },
    }));
    const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
    let absent = new Set<string>();
    const service = (): OrderTransitionEffectService =>
      new OrderTransitionEffectService({
        emFactory,
        handlers: { 'stock.release': stock, 'credit.release': credit },
        isPresent: (moduleId) => !absent.has(moduleId),
        log: quiet,
      });
    const tick = () => asWorker(() => runTransitionEffectSweepTick({ effects: service(), log: quiet }));

    async function seedOrder(): Promise<string> {
      const em = h.em();
      const order = em.create(Order, {
        organizationId: TEST_ORGANIZATION_ID,
        placedByCustomerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: '00000000-0000-4000-8000-0000000000c1',
        status: 'cancelled',
        paymentStatus: 'deferred',
        deliveryAddress: {
          recipientName: 'Stub', street: 'ul. Odbioru 1', city: 'Warszawa',
          postalCode: '00-100', country: 'PL',
        },
        billingAddress: {
          recipientName: 'Stub', street: 'ul. Rozliczeń 2', city: 'Warszawa',
          postalCode: '00-101', country: 'PL',
        },
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        paymentMethodSnapshot: { code: 'credit_limit', name: 'CL', kind: 'credit_limit' },
        subtotal: '100.00',
        taxTotal: '23.00',
        deliveryTotal: '0.00',
        total: '123.00',
        currency: 'PLN',
        placedAt: new Date(),
      });
      await em.persistAndFlush(order);
      return order.id;
    }

    const owing = async (): Promise<string> => {
      const orderId = await seedOrder();
      await emFactory().transactional((tx) =>
        service().record(
          tx,
          { id: orderId, organizationId: TEST_ORGANIZATION_ID },
          [{ effect: 'stock.release', reason: 'order_cancelled' }],
          'transition',
        ),
      );
      return orderId;
    };

    it('several ticks with nothing outstanding write no row', async () => {
      const before = await recorded(SWEEP_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();

      expect(stock).not.toHaveBeenCalled();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before);
    });

    it('a follow-up that failed and is waiting out its back-off is not work, and writes no row', async () => {
      const orderId = await owing();
      await h
        .em()
        .getConnection()
        .execute(
          `update "order_transition_effects"
              set "attempts" = 1, "next_attempt_at" = now() + interval '1 hour'
            where "order_id" = ?`,
          [orderId],
        );
      const before = await recorded(SWEEP_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();

      expect(stock).not.toHaveBeenCalled();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before);
    });

    it('a tick with a follow-up due runs it and writes its row, as before', async () => {
      const orderId = await owing();
      const before = await recorded(SWEEP_SCOPE_REASON);

      await tick();

      expect(stock).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
      // And the tick after it is idle again.
      await tick();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
    });

    it('a follow-up waiting on a module that is off costs one row when it is marked, none while it waits, one when the module returns', async () => {
      const orderId = await owing();
      const blockedOn = async (): Promise<string | null> => {
        const rows = (await h
          .em()
          .getConnection()
          .execute(`select "blocked_on" from "order_transition_effects" where "order_id" = ?`, [
            orderId,
          ])) as Array<{ blocked_on: string | null }>;
        return rows[0]!.blocked_on;
      };
      const before = await recorded(SWEEP_SCOPE_REASON);
      stock.mockClear();

      absent = new Set(['inventory']);
      try {
        // The first tick has something to write: the row is marked as waiting.
        await tick();
        expect(await blockedOn()).toBe('inventory');
        expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);

        // Every tick after it, for as long as the module stays off, is idle.
        for (let i = 0; i < IDLE_TICKS; i += 1) await tick();
        expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
        expect(stock).not.toHaveBeenCalled();
      } finally {
        absent = new Set();
      }

      // The module is back: the release runs, and that tick is recorded.
      await tick();
      expect(stock).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
      expect(await blockedOn()).toBeNull();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 2);
    });

    /** One order owing `effect`, with its row's columns overridden as given. */
    const owingWith = async (
      effect: 'stock.release' | 'credit.release',
      set: string,
    ): Promise<string> => {
      const orderId = await seedOrder();
      await emFactory().transactional((tx) =>
        service().record(
          tx,
          { id: orderId, organizationId: TEST_ORGANIZATION_ID },
          [{ effect, reason: 'order_cancelled' }],
          'transition',
        ),
      );
      if (set.length > 0) {
        await h
          .em()
          .getConnection()
          .execute(`update "order_transition_effects" set ${set} where "order_id" = ?`, [orderId]);
      }
      return orderId;
    };

    it('only a credit release due: the tick runs it — the question covers every kind of follow-up', async () => {
      credit.mockClear();
      stock.mockClear();
      const orderId = await owingWith('credit.release', '');
      const before = await recorded(SWEEP_SCOPE_REASON);

      await tick();

      expect(credit).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
      expect(stock).not.toHaveBeenCalled();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
    });

    it('only a row still marked as waiting on a module that is back, deep in its back-off: the tick releases it now', async () => {
      stock.mockClear();
      // Not due by its own clock for an hour: the one thing that makes this
      // tick work is the mark, which a present owner no longer justifies.
      const orderId = await owingWith(
        'stock.release',
        `"blocked_on" = 'inventory', "attempts" = 3, "next_attempt_at" = now() + interval '1 hour'`,
      );
      const before = await recorded(SWEEP_SCOPE_REASON);

      await tick();

      expect(stock).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
    });

    it('a row under a live lease is somebody else`s and not work; once the lease has expired the tick runs it', async () => {
      stock.mockClear();
      const orderId = await owingWith('stock.release', `"claimed_until" = now() + interval '5 minutes'`);
      const before = await recorded(SWEEP_SCOPE_REASON);

      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();
      expect(stock).not.toHaveBeenCalled();
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before);

      await h
        .em()
        .getConnection()
        .execute(
          `update "order_transition_effects" set "claimed_until" = now() - interval '1 second' where "order_id" = ?`,
          [orderId],
        );
      await tick();

      expect(stock).toHaveBeenCalledWith({ orderId, reason: 'order_cancelled' });
      expect(await recorded(SWEEP_SCOPE_REASON)).toBe(before + 1);
    });
  });

  // --- crm: event reminders, every 60 s ---------------------------------------

  describe('crm — the event reminder sweep', () => {
    const reminders = () => h.container.resolve('crmEventReminderService') as EventReminderService;
    const tick = () =>
      asWorker(() =>
        runEventReminderJob({
          tick: h.container.resolve('crmEventReminderTick') as () => Promise<void>,
          isPresent: () => true,
          hasWork: () => reminders().hasSweepWork(),
        }),
      );

    beforeAll(async () => {
      await restoreDefaultCrmWorkflow(h.em());
      // Whatever an earlier file left due is handled here, under a reason of
      // this test's own, so the cases below start from an idle table.
      await enterSystemScope('test: settle crm reminders', () => reminders().sweep());
    });

    it('several ticks with no reminder due write no row', async () => {
      const before = await recorded(EVENT_REMINDER_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();

      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before);
    });

    it('a reminder that is not due yet is not work, and writes no row', async () => {
      const organizationId = await seedCrmOrganization(h.em(), 'Idle ticks later');
      const opportunity = await createCrmOpportunity(h, { organizationId });
      const startsAt = new Date(Date.now() + 2 * 3_600_000);
      const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timeZone: 'UTC',
        remindAt: new Date(Date.now() + 3_600_000),
        createdByAdminUserId: TEST_ADMIN_ID,
      });
      const before = await recorded(EVENT_REMINDER_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();

      expect((await crmEventReminderRow(h.em(), eventId))?.handledAt).toBeNull();
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before);
    });

    it('a tick with a reminder due delivers it and writes its row, as before', async () => {
      const organizationId = await seedCrmOrganization(h.em(), 'Idle ticks due');
      const opportunity = await createCrmOpportunity(h, { organizationId });
      const startsAt = new Date(Date.now() + 3_600_000);
      const eventId = await seedCrmEventRow(h.em(), opportunity.id, {
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timeZone: 'UTC',
        remindAt: new Date(Date.now() - 60_000),
        createdByAdminUserId: TEST_ADMIN_ID,
      });
      const before = await recorded(EVENT_REMINDER_SCOPE_REASON);

      await tick();

      const row = await crmEventReminderRow(h.em(), eventId);
      expect(row?.handledAt).not.toBeNull();
      expect(row?.outcome).not.toBe('sending');
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before + 1);
      await tick();
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before + 1);
    });

    /** An Event on a fresh open Opportunity, with the reminder columns as given. */
    const eventWith = async (
      label: string,
      reminder: { remindAt: Date; reminderHandledAt?: Date; reminderOutcome?: string },
    ): Promise<string> => {
      const organizationId = await seedCrmOrganization(h.em(), `Idle ticks ${label}`);
      const opportunity = await createCrmOpportunity(h, { organizationId });
      const startsAt = new Date(Date.now() + 3_600_000);
      return seedCrmEventRow(h.em(), opportunity.id, {
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3_600_000),
        timeZone: 'UTC',
        createdByAdminUserId: TEST_ADMIN_ID,
        ...reminder,
      });
    };

    it('only a reminder more than a day overdue: the tick marks it missed — a branch of its own', async () => {
      const eventId = await eventWith('missed', { remindAt: new Date(Date.now() - 25 * 3_600_000) });
      const before = await recorded(EVENT_REMINDER_SCOPE_REASON);

      await tick();

      expect((await crmEventReminderRow(h.em(), eventId))?.outcome).toBe('missed');
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before + 1);
    });

    it('only a claim left unrecorded for more than ten minutes: the tick marks it interrupted — a branch of its own', async () => {
      const eventId = await eventWith('interrupted', {
        remindAt: new Date(Date.now() - 12 * 60_000),
        reminderHandledAt: new Date(Date.now() - 11 * 60_000),
        reminderOutcome: 'sending',
      });
      const before = await recorded(EVENT_REMINDER_SCOPE_REASON);

      await tick();

      expect((await crmEventReminderRow(h.em(), eventId))?.outcome).toBe('interrupted');
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before + 1);
      // A claim that is recent is still somebody's: not work.
      const recent = await eventWith('claimed', {
        remindAt: new Date(Date.now() - 2 * 60_000),
        reminderHandledAt: new Date(Date.now() - 60_000),
        reminderOutcome: 'sending',
      });
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();
      expect((await crmEventReminderRow(h.em(), recent))?.outcome).toBe('sending');
      expect(await recorded(EVENT_REMINDER_SCOPE_REASON)).toBe(before + 1);
    });
  });

  // --- product_feeds: stale run claims, every 5 min ---------------------------

  describe('product_feeds — the stale-claim reaper', () => {
    const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
    const tick = () =>
      asWorker(() => runFeedRunReaperTick({ reaper: h.productFeeds.reaper }));

    let channelId: string;
    let templateId: string;

    beforeAll(async () => {
      await setChannelStorefrontUrl(h, 'pl_retail');
      channelId = (await h.em().findOneOrFail(SalesChannel, { code: 'pl_retail' })).id;
      await seedFeedPrices(h.em(), { code: 'feed_idle_ticks_list' });
      const templates = await h.app.inject({ method: 'GET', url: '/api/v1/admin/feed-templates', ...ADMIN });
      templateId = (
        templates.json() as { data: Array<{ id: string; systemCode: string | null }> }
      ).data.find((template) => template.systemCode === 'google_merchant_v1')!.id;
    });

    async function abandonedRun(): Promise<string> {
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/v1/admin/product-feeds',
        ...ADMIN,
        payload: {
          name: `Idle ticks ${randomUUID().slice(0, 8)}`,
          slug: `idle-ticks-${randomUUID().slice(0, 8)}`,
          feedTemplateId: templateId,
          salesChannelId: channelId,
          languageCode: 'en-US',
          currencyCode: 'PLN',
          pricePresentation: 'net',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const feedId = (created.json() as { data: { feed: { id: string } } }).data.feed.id;

      const em = h.orm.em.fork() as EntityManager;
      const runs = new FeedRunService(() => em);
      const run = await runs.createQueuedRun({
        productFeedId: feedId,
        trigger: 'scheduled',
        triggeredByAdminUserId: null,
      });
      expect((await runs.claim(feedId, run.id)).acquired).toBe(true);
      await em
        .getConnection()
        .execute(
          `update "product_feed_runs" set "heartbeat_at" = now() - interval '90 minutes' where "id" = ?`,
          [run.id],
        );
      return run.id;
    }

    it('several ticks with no run in progress write no row', async () => {
      const before = await recorded(FEED_REAPER_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) await tick();

      expect(await recorded(FEED_REAPER_SCOPE_REASON)).toBe(before);
    });

    it('a tick with a claim held releases the stale one and writes its row, as before', async () => {
      const runId = await abandonedRun();
      const before = await recorded(FEED_REAPER_SCOPE_REASON);

      await tick();

      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "status" from "product_feed_runs" where "id" = ?`, [runId])) as Array<{ status: string }>;
      expect(rows[0]?.status).toBe('failed');
      expect(await recorded(FEED_REAPER_SCOPE_REASON)).toBe(before + 1);
      await tick();
      expect(await recorded(FEED_REAPER_SCOPE_REASON)).toBe(before + 1);
    });

    it('a question that cannot be answered counts as yes: the sweep runs, and is recorded', async () => {
      const runId = await abandonedRun();
      const before = await recorded(FEED_REAPER_SCOPE_REASON);

      await asWorker(() =>
        runFeedRunReaperTick({
          reaper: {
            hasClaimedRuns: async () => {
              throw new Error('connection refused');
            },
            releaseStaleClaims: () => h.productFeeds.reaper.releaseStaleClaims(),
          },
        }),
      );

      const rows = (await h
        .em()
        .getConnection()
        .execute(`select "status" from "product_feed_runs" where "id" = ?`, [runId])) as Array<{ status: string }>;
      expect(rows[0]?.status).toBe('failed');
      expect(await recorded(FEED_REAPER_SCOPE_REASON)).toBe(before + 1);
    });
  });

  // --- price_lists: date-driven status transitions, every 5 min ---------------

  describe('price_lists — the status sweep', () => {
    const tick = () => asWorker(() => statusSweepTick(new PriceListStatusWorker(emFactory)));

    beforeAll(async () => {
      await enterSystemScope('test: settle price list statuses', () =>
        new PriceListStatusWorker(emFactory).sweep(),
      );
    });

    it('several ticks with no transition due write no row', async () => {
      const before = await recorded(STATUS_SWEEP_SCOPE_REASON);
      for (let i = 0; i < IDLE_TICKS; i += 1) expect(await tick()).toBeNull();

      expect(await recorded(STATUS_SWEEP_SCOPE_REASON)).toBe(before);
    });

    it('a tick with a list due to start activates it and writes its row, as before', async () => {
      const em = h.em();
      const suffix = randomUUID().slice(0, 8);
      const scheduled = em.create(PriceList, {
        code: `idle-ticks-${suffix}`,
        name: `Idle ticks ${suffix}`,
        currency: 'PLN',
        type: 'sale',
        status: 'scheduled',
        startsAt: new Date(Date.now() - 86_400_000),
      });
      await em.persistAndFlush(scheduled);
      const before = await recorded(STATUS_SWEEP_SCOPE_REASON);

      expect(await tick()).toEqual({ scheduledToActive: 1, activeToExpired: 0 });

      const row = await h.em().findOneOrFail(PriceList, { id: scheduled.id }, { refresh: true });
      expect(row.status).toBe('active');
      expect(await recorded(STATUS_SWEEP_SCOPE_REASON)).toBe(before + 1);
      expect(await tick()).toBeNull();
      expect(await recorded(STATUS_SWEEP_SCOPE_REASON)).toBe(before + 1);
    });

    it('only an active list whose end has passed: the tick expires it — the other branch of the question', async () => {
      const em = h.em();
      const suffix = randomUUID().slice(0, 8);
      const active = em.create(PriceList, {
        code: `idle-ticks-ended-${suffix}`,
        name: `Idle ticks ended ${suffix}`,
        currency: 'PLN',
        type: 'sale',
        status: 'active',
        startsAt: new Date(Date.now() - 3 * 86_400_000),
        endsAt: new Date(Date.now() - 86_400_000),
      });
      await em.persistAndFlush(active);
      const before = await recorded(STATUS_SWEEP_SCOPE_REASON);

      expect(await tick()).toEqual({ scheduledToActive: 0, activeToExpired: 1 });

      const row = await h.em().findOneOrFail(PriceList, { id: active.id }, { refresh: true });
      expect(row.status).toBe('expired');
      expect(await recorded(STATUS_SWEEP_SCOPE_REASON)).toBe(before + 1);
    });

    it('a question that cannot be answered counts as yes: the sweep runs, and is recorded', async () => {
      const em = h.em();
      const suffix = randomUUID().slice(0, 8);
      const scheduled = em.create(PriceList, {
        code: `idle-ticks-unanswered-${suffix}`,
        name: `Idle ticks unanswered ${suffix}`,
        currency: 'PLN',
        type: 'sale',
        status: 'scheduled',
        startsAt: new Date(Date.now() - 86_400_000),
      });
      await em.persistAndFlush(scheduled);
      const worker = new PriceListStatusWorker(emFactory);
      const before = await recorded(STATUS_SWEEP_SCOPE_REASON);

      const result = await asWorker(() =>
        statusSweepTick({
          hasDueTransitions: async () => {
            throw new Error('connection refused');
          },
          sweep: (now) => worker.sweep(now),
        }),
      );

      expect(result).toEqual({ scheduledToActive: 1, activeToExpired: 0 });
      const row = await h.em().findOneOrFail(PriceList, { id: scheduled.id }, { refresh: true });
      expect(row.status).toBe('active');
      expect(await recorded(STATUS_SWEEP_SCOPE_REASON)).toBe(before + 1);
    });
  });
});
