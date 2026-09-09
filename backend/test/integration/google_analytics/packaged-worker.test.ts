import { asValue } from 'awilix';
import Fastify, { type FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Worker } from 'bullmq';
import { createRootContainer } from '../../../src/kernel/container.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  type ModuleRegistrationSink,
} from '../../../src/kernel/module-context.js';
import { EventBus } from '@endora-commerce/platform/events';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  pauseWorkersFor,
  resumeWorkersFor,
} from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { registerModule } from '@endora-commerce/mod-google-analytics/backend';
import {
  createGaDeliveryQueue,
  GA_DELIVERY_QUEUE_NAME,
  type GaCollectEnqueuer,
} from '../../../../packages/modules/google_analytics/src/backend/services/ss-delivery-queue.js';

/**
 * `google_analytics` is the first module package with a **real BullMQ
 * consumer** (feature 080, T040b), and this file is what turns that from a
 * claim into a measurement.
 *
 * `blog` proved the mechanics of a package; `quote_requests` proved a migration
 * chain and a writing `ctx.subscribe` subscriber. Neither could say anything
 * about `ctx.worker`: `RfqExpiryWorker` is a plain `sweep()` with no queue
 * behind it, which is why that package needs no `ioredis` peer. This module
 * constructs a `Queue` and a `Worker` (`services/ss-delivery-queue.ts`) and
 * hands the `Worker` to `ctx.worker`, which is `defineModuleWorker`.
 *
 * Two properties, and they are different questions:
 *
 *  1. **Principle X — it consumes.** A job the module's own producer enqueued
 *     is picked up and run by the worker the module registered, out of the
 *     package's compiled `dist`. Nothing about a move is supposed to change
 *     that; before this file nothing measured it either.
 *  2. **Constitution XVII item 2 — it can be stopped.** `pauseWorkersFor(<id>)`
 *     is the seam the lifecycle orchestrator's disable path calls, and it can
 *     only reach a worker registered **under this module's id**. A move that
 *     put the worker outside `ctx.worker` — or under the wrong id — would leave
 *     the platform's stop switch attached to nothing, and would look exactly
 *     like a green test suite.
 *
 *  3. **Constitution XVII on the axis an operator drives.** This paragraph used
 *     to say the opposite, and said so deliberately: *"it proves the platform
 *     can stop this worker, not that every off-state path does — `pauseWorkersFor`
 *     is reached from the orchestrator's platform-availability `disable` and from
 *     nowhere else, so the operator-activation axis leaves a running worker
 *     running… asserting it here would bless it."* The gap was real, it was the
 *     platform's rather than this package's, and it has been repaired: the worker
 *     now follows the per-process registry cache, so a **deactivation** stops it
 *     in whichever process holds it — including a `BACKEND_ROLE=worker` one that
 *     never runs the orchestrator. The assertion that would have blessed the
 *     defect is the assertion that now holds, so it is made below rather than
 *     withheld. Its general form, against a real queue and both axes, is
 *     `test/integration/_lifecycle/deactivation-stops-workers.integration.test.ts`;
 *     what this file adds is that it holds for a worker composed out of a
 *     package's compiled `dist`.
 *
 * **Why this is not `setupBackendServer`.** The harness contributes
 * `moduleQueueRedis: undefined` on purpose — "no queue in this composition" is
 * a statement a root makes rather than something inferred — so under it this
 * module registers no worker at all and there is nothing here to measure. So
 * the composition is built by hand, in the shape `google_tag_manager`'s
 * cache-invalidation test established: a root container, the ports this module
 * resolves, and a real Redis in `moduleQueueRedis`.
 *
 * The queue name is fixed, so the run starts by obliterating it: a job left
 * behind by a crashed run would otherwise be consumed by this one's worker and
 * counted as its own.
 */

const MODULE_ID = 'google_analytics';
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

/** The settings this module's processor reads. Blank measurement id ⇒ drop. */
function settingsStub(): { get: (code: string) => Promise<unknown> } {
  return {
    get: async (code: string) => {
      // Blank on every code. A blank measurement id makes the processor treat
      // the channel as untracked and return without calling out, which is
      // deliberate: this file measures *whether the job ran*, and a real GA4
      // Measurement Protocol call would measure the network.
      void code;
      return '';
    },
  };
}

describe('google_analytics — the packaged BullMQ consumer (Principle X)', () => {
  let redis: Redis;
  let app: FastifyInstance;
  let sink: ModuleRegistrationSink;
  let worker: Worker;
  let container: ReturnType<typeof createRootContainer>;
  const completed: string[] = [];

  beforeAll(async () => {
    // This file boots no server, so nothing has loaded module presence; seeding
    // it is the whole of the lifecycle state these assertions need. The reset
    // in `afterAll` is `[]` rather than a captured baseline for the same
    // reason — there is nothing to capture, and reading one throws
    // `ModulePresenceNotLoadedError`.
    registryCache.__setEnabledForTesting([MODULE_ID]);
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });

    const scratchQueue = createGaDeliveryQueue(redis);
    await scratchQueue.obliterate({ force: true });
    await scratchQueue.close();

    container = createRootContainer();
    container.register({
      emFactory: asValue(() => {
        throw new Error('[packaged-worker] this composition touches no database');
      }),
      auditLogService: asValue({ record: async () => undefined }),
      settingsReadPort: asValue(settingsStub()),
      requireAdmin: asValue(() => async () => undefined),
      salesChannelCodeIdPort: asValue({
        idByCode: async () => CHANNEL_ID,
        codeById: async () => 'default',
      }),
      adminAuditActorResolver: asValue(() => ({ actorAdminUserId: null })),
      moduleQueueRedis: asValue(redis),
    });

    sink = createModuleRegistrationSink();
    registerModule(
      createModuleContext({
        module: { id: MODULE_ID, version: '1.0.0' },
        container,
        eventBus: new EventBus(),
        sink,
        log: { info: () => {}, warn: () => {}, error: () => {} },
      }),
    );

    // `ctx.worker` is called inside the module's `ctx.routes` callback, so the
    // worker only exists once the plugin is registered — the same order a real
    // boot produces.
    app = Fastify();
    for (const plugin of sink.plugins) await app.register(plugin);
    await app.ready();

    worker = sink.workers[0] as Worker;
    expect(
      worker,
      'the packaged module registered no worker — `ctx.worker` was not reached',
    ).toBeDefined();
    worker.on('completed', (job) => {
      completed.push(String(job.id));
    });
    await worker.waitUntilReady();
  }, 60_000);

  afterAll(async () => {
    registryCache.__setEnabledForTesting([]);
    for (const unsubscribe of sink?.unsubscribes ?? []) unsubscribe();
    await worker?.close();
    await app?.close();
    await redis?.quit();
  });

  /**
   * Enqueue one event through the module's **own** producer — the closure the
   * `/collect` route calls, resolved from the container the module registered
   * it in, so the job travels the queue object the module built.
   *
   * Deliberately not `app.inject`: the storefront route reads the channel off
   * the platform request scope, which the host's tenant hook opens and this
   * composition does not have. Standing that up would put the resolver
   * middleware between this file and the thing it measures, and the route's own
   * gating is proven where it belongs — `off-state.test.ts`.
   */
  async function collect(): Promise<void> {
    const { googleAnalyticsServices } = container.cradle as unknown as {
      googleAnalyticsServices: { enqueueCollect?: GaCollectEnqueuer };
    };
    const enqueue = googleAnalyticsServices.enqueueCollect;
    expect(
      enqueue,
      'the module built no producer — `moduleQueueRedis` did not reach it',
    ).toBeDefined();
    const accepted = await enqueue?.(CHANNEL_ID, {
      clientId: 'client-1',
      consent: { analyticsStorage: 'granted' },
      events: [{ name: 'view_item', params: { item_id: 'p-1' } }],
    });
    expect(accepted).toBe(1);
  }

  async function settleUntil(ms: number, expected: number): Promise<number> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && completed.length < expected) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return completed.length;
  }

  it('registers its worker under its own manifest id, so the platform can reach it', () => {
    // The property a move can break silently: `ctx.worker` files the worker in
    // `defineModuleWorker`'s per-module registry, and `pauseWorkersFor` is the
    // only way the lifecycle reaches it. A worker constructed outside that seam
    // is a worker the platform cannot stop, and nothing else would notice.
    expect(worker.name).toBe(GA_DELIVERY_QUEUE_NAME);
  });

  it('consumes a job the packaged producer enqueued', async () => {
    await collect();
    expect(await settleUntil(10_000, 1)).toBe(1);
  }, 30_000);

  it('stops consuming while paused for its module, and resumes', async () => {
    await pauseWorkersFor(MODULE_ID);
    expect(worker.isPaused(), 'pauseWorkersFor did not reach the packaged worker').toBe(true);

    const before = completed.length;
    await collect();
    // Well past the time the worker needs when it is running; the positive case
    // above is what makes a quiet interval mean "paused" rather than "slow".
    await settleUntil(2_000, before + 1);
    expect(completed.length, 'a paused worker consumed a job').toBe(before);

    await resumeWorkersFor(MODULE_ID);
    expect(await settleUntil(10_000, before + 1)).toBe(before + 1);
  }, 30_000);

  it('stops consuming when the operator deactivates the module, and drains on reactivation', async () => {
    // The assertion the header used to withhold. Nobody calls `pauseWorkersFor`
    // here: the presence install alone is the seam, which is what makes the
    // answer right in a process that never ran the orchestrator. For this module
    // it is the difference between "analytics is off" and "we are still sending
    // events to Google after the operator withdrew that disclosure".
    registryCache.__setEnabledForTesting([MODULE_ID], { deactivated: [MODULE_ID] });

    const before = completed.length;
    await collect();
    await settleUntil(2_000, before + 1);
    expect(completed.length, 'a deactivated module consumed a job').toBe(before);

    registryCache.__setEnabledForTesting([MODULE_ID]);
    expect(await settleUntil(20_000, before + 1)).toBe(before + 1);
  }, 60_000);
});
