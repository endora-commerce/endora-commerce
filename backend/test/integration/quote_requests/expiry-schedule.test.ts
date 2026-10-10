import { randomUUID } from 'node:crypto';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { attachEscapeHatchAuditWriter } from '@endora-commerce/platform/lifecycle';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { QuoteRequest } from '../../helpers/package-entities.js';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { QUOTE_REQUESTS_SETTING_CODES } from '../../../../packages/modules/quote_requests/src/manifest.js';
import {
  RFQ_EXPIRY_SWEEP_QUEUE,
  RFQ_EXPIRY_SWEEP_SCHEDULER_ID,
  RFQ_EXPIRY_SWEEP_SCOPE_REASON,
  startRfqExpirySweep,
} from '../../../../packages/modules/quote_requests/src/backend/workers/rfq-expiry-sweep-worker.js';

const CUSTOMER = { b2b_session: 'stub-customer-session' };
const DAY_MS = 86_400_000;
const EXPIRY_DAYS = 14;

/**
 * A Quote Request past its expiry is expired by the **scheduled job**.
 *
 * Every other test of the sweep calls `sweep()` by hand — which is how the
 * sweep went without a caller for as long as it has existed while its tests
 * stayed green. Here nothing calls it: the module's own
 * `startRfqExpirySweep` builds the consumer and installs the Job Scheduler on
 * a real Redis, over the worker the composed module built, and attaches the
 * consumer through the platform's worker seam (`defineModuleWorker`, which is
 * what `ctx.worker` applies). What expires the request is the job BullMQ
 * produces from that schedule.
 *
 * The shared test server composes no consumer (`processRunsWorkers` is false
 * there), so this file is the one place the two halves meet; that the module's
 * composition makes this same call is held by
 * `packages/modules/quote_requests/src/backend/expiry-sweep-is-scheduled.test.ts`.
 *
 * The queue lives under a key prefix of this run's own, because the Redis is
 * shared with every other run on the machine.
 */
describe('quote_requests — the expiry sweep runs on its schedule', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  let writer: ReturnType<typeof attachEscapeHatchAuditWriter>;
  const closers: Array<() => Promise<void>> = [];
  const prefix = `rfq-expiry-test-${randomUUID().slice(0, 8)}`;
  const completed: string[] = [];

  const dueRequest = async (): Promise<string> => {
    const created = await h.app.inject({
      method: 'POST',
      url: '/api/v1/quote-requests',
      cookies: CUSTOMER,
      payload: { items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { data: { id: string } }).data.id;
    await h
      .em()
      .nativeUpdate(QuoteRequest, { id }, { updatedAt: new Date(Date.now() - (EXPIRY_DAYS + 1) * DAY_MS) });
    return id;
  };

  const statusOf = async (id: string): Promise<string> =>
    (await h.em().findOneOrFail(QuoteRequest, { id }, { filters: false })).status;

  const until = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return condition();
  };

  /** Put one more tick on the queue, as the scheduler does, and wait until the consumer has run it. */
  const tick = async (): Promise<void> => {
    const job = await queue.add('sweep', {});
    const ran = await until(async () => completed.includes(job.id ?? ''), 30_000);
    expect(ran, 'the consumer ran the tick').toBe(true);
  };

  /** Escape-hatch accesses recorded in `audit_log_entries` for the sweep's reason. */
  const recorded = async (): Promise<number> => {
    await writer.flush();
    const rows = (await h
      .em()
      .getConnection()
      .execute(
        `select coalesce(sum(("state_after"->>'occurrences')::int), 0)::text as "n"
           from "audit_log_entries"
          where "action" = 'tenant.escape_hatch' and "state_after"->>'reason' = ?`,
        [RFQ_EXPIRY_SWEEP_SCOPE_REASON],
      )) as Array<{ n: string }>;
    return Number(rows[0]!.n);
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, EXPIRY_DAYS, null, {
      actorAdminUserId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    writer = attachEscapeHatchAuditWriter({
      em: () => h.orm.em.fork() as EntityManager,
      flushIntervalMs: 3_600_000,
      log: () => undefined,
    });
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(RFQ_EXPIRY_SWEEP_QUEUE, { connection: redis, prefix });
  }, 120_000);

  afterAll(async () => {
    for (const close of closers) await close();
    await worker?.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    redis.disconnect();
    await writer.detach();
    await h.settings.adminService.setValueForAllChannels(QUOTE_REQUESTS_SETTING_CODES.EXPIRY_DAYS, 0, null, {
      actorAdminUserId: null,
    });
    await teardownBackendServer(h);
  });

  it('a request past its expiry is expired by the job the schedule produces — nothing calls sweep()', async () => {
    const id = await dueRequest();
    expect(await statusOf(id)).toBe('Pending');

    const started = await startRfqExpirySweep({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      queuePrefix: prefix,
      // The worker the composed module built, as its composition hands it over.
      expiry: (
        h.container.cradle as unknown as { quoteRequests: { handle(): { expiryWorker: never } } }
      ).quoteRequests.handle().expiryWorker,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      attach: (built) => {
        worker = defineModuleWorker('quote_requests', built);
        built.on('completed', (job) => {
          completed.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);

    // The schedule is installed on the queue, under its own id.
    expect((await queue.getJobSchedulers()).map((scheduler) => scheduler.key)).toEqual([RFQ_EXPIRY_SWEEP_SCHEDULER_ID]);
    // And its first job expires the request.
    expect(await until(async () => (await statusOf(id)) === 'Expired', 60_000)).toBe(true);
    expect(await recorded(), 'a tick with work enters the system scope once').toBe(1);
  }, 120_000);

  it('a tick with nothing to expire enters no scope: no escape-hatch audit row', async () => {
    const before = await recorded();
    await tick();
    await tick();
    await tick();
    expect(await recorded()).toBe(before);

    // The control: with something due, the very same tick is recorded once.
    const id = await dueRequest();
    await tick();
    expect(await statusOf(id)).toBe('Expired');
    expect(await recorded()).toBe(before + 1);
  }, 120_000);

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with quote_requests %s no tick runs, and the request is expired once the module is back',
    async (axis) => {
      const id = await dueRequest();
      const before = await recorded();
      await withModuleOff('quote_requests', axis, async () => {
        const job = await queue.add('sweep', {});
        // Long enough for a running consumer to have taken it many times over.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(completed).not.toContain(job.id);
        expect(await statusOf(id)).toBe('Pending');
        expect(await recorded()).toBe(before);
      });
      // Back on: the tick that waited runs, and the request is expired.
      expect(await until(async () => (await statusOf(id)) === 'Expired', 60_000)).toBe(true);
    },
    120_000,
  );
});
