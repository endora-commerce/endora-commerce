import { randomUUID } from 'node:crypto';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CUSTOMER_ACCOUNT_ANONYMIZED_EVENT } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff, type OffStateAxis } from '../../helpers/off-state.js';
import { CustomerAccount } from '../../helpers/package-entities.js';
import { seedCrmOrganization } from '../../helpers/seed-crm.js';
import { ManifestReconciler } from '../../../src/kernel/settings/manifest-reconciler.js';
import { defineModuleWorker } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  CUSTOMERS_SETTING_CODES,
  manifest as customersManifest,
} from '../../../../packages/modules/customers/src/manifest.js';
import {
  ANONYMIZATION_SWEEP_QUEUE,
  ANONYMIZATION_SWEEP_SCHEDULER_ID,
  ensureAnonymizationSweepSchedule,
  startAnonymizationSweep,
  type AnonymizationSweepWorker,
} from '../../../../packages/modules/customers/src/backend/workers/anonymization-sweep-worker.js';

const DAY_MS = 86_400_000;
const RETENTION_DAYS = 30;

/**
 * Issue #677 — a soft-deleted account past `customers.deletion_retention_days`
 * is anonymised by the **scheduled job**.
 *
 * Every other test of the sweep calls `sweep()` by hand, which is how the sweep
 * went without a caller while its tests stayed green. Here nothing calls it:
 * the module's own `startAnonymizationSweep` builds the consumer and installs
 * the Job Scheduler on a real Redis, over the sweep worker the composed module
 * built, and attaches the consumer through the platform's worker seam
 * (`defineModuleWorker`, which is what `ctx.worker` applies). What anonymises
 * the account is the job BullMQ produces from that schedule.
 *
 * The retention window is set to 30 days, so an account deleted 31 days ago is
 * due only if the tick reads the setting — at the default of 365 it would not
 * be — and one deleted 29 days ago is inside the window and stays as it is.
 *
 * The shared test server composes no consumer (`processRunsWorkers` is false
 * there), so this file is where the two halves meet; that the module's
 * composition makes this same call is held by
 * `packages/modules/customers/src/backend/anonymization-sweep-is-scheduled.test.ts`.
 * The queue lives under a key prefix of this run's own, because the Redis is
 * shared with every other run on the machine.
 */
describe('customers — the anonymization sweep runs on its schedule (#677)', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue;
  let worker: Worker | undefined;
  let organizationId: string;
  let stopListening: () => void = () => undefined;
  const closers: Array<() => Promise<void>> = [];
  const prefix = `customers-anonymization-test-${randomUUID().slice(0, 8)}`;
  const RUN = randomUUID().slice(0, 8);
  const accounts: string[] = [];
  const completed: string[] = [];
  const announced: string[] = [];

  /** A customer account soft-deleted `daysAgo` days ago. */
  async function deletedAccount(label: string, daysAgo: number): Promise<string> {
    const em = h.em().fork();
    const row = em.create(CustomerAccount, {
      organizationId,
      email: `${label}-${RUN}@anonymization-schedule.test`,
      passwordHash: 'x'.repeat(60),
      firstName: 'Sweep',
      lastName: label,
      emailVerifiedAt: new Date(),
      deletedAt: new Date(Date.now() - daysAgo * DAY_MS),
    } as never);
    await em.persistAndFlush(row);
    accounts.push(row.id);
    return row.id;
  }

  async function stateOf(id: string): Promise<{ email: string; anonymizedAt: Date | null }> {
    const row = await h.em().fork().findOneOrFail(CustomerAccount, { id }, { filters: false });
    return { email: row.email, anonymizedAt: row.anonymizedAt ?? null };
  }

  const until = async (condition: () => Promise<boolean>, timeoutMs: number): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return condition();
  };

  const isAnonymized = async (id: string): Promise<boolean> => (await stateOf(id)).anonymizedAt !== null;

  beforeAll(async () => {
    h = await setupBackendServer();
    await new ManifestReconciler(h.em()).apply([customersManifest.settings!]);
    await h.settings.adminService.setValueForAllChannels(
      CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS,
      RETENTION_DAYS,
      null,
      { actorAdminUserId: null },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    organizationId = await seedCrmOrganization(h.em().fork(), `anonymization-schedule-${RUN}`);
    stopListening = h.eventBus.on(CUSTOMER_ACCOUNT_ANONYMIZED_EVENT as never, (event: unknown) => {
      announced.push((event as { customerAccountId: string }).customerAccountId);
    });
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue(ANONYMIZATION_SWEEP_QUEUE, { connection: redis, prefix });
  }, 120_000);

  afterAll(async () => {
    stopListening();
    for (const close of closers) await close();
    await worker?.close();
    await queue?.obliterate({ force: true }).catch(() => undefined);
    await queue?.close();
    redis?.disconnect();
    if (h) {
      if (accounts.length > 0) {
        await h
          .em()
          .getConnection()
          .execute(`delete from "customer_accounts" where "id" = any(?::uuid[])`, [`{${accounts.join(',')}}`]);
      }
      await h.settings.adminService.setValueForAllChannels(
        CUSTOMERS_SETTING_CODES.DELETION_RETENTION_DAYS,
        365,
        null,
        { actorAdminUserId: null },
      );
    }
    await teardownBackendServer(h);
  });

  it('one tick anonymises an account past the retention window, announces it, and leaves one inside the window untouched — nothing calls sweep()', async () => {
    const due = await deletedAccount('due', RETENTION_DAYS + 1);
    const inside = await deletedAccount('inside', RETENTION_DAYS - 1);
    const insideBefore = await stateOf(inside);

    const started = await startAnonymizationSweep({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      queuePrefix: prefix,
      // The sweep worker the composed module built, as its composition hands it over.
      sweeper: (
        h.container.cradle as unknown as {
          customers: { handle(): { anonymizationSweepWorker: AnonymizationSweepWorker } };
        }
      ).customers.handle().anonymizationSweepWorker,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      attach: (built) => {
        worker = defineModuleWorker('customers', built);
        built.on('completed', (job) => {
          completed.push(job.id ?? '');
        });
      },
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);

    // The schedule is installed on the queue, under its own stable id.
    expect((await queue.getJobSchedulers()).map((scheduler) => scheduler.key)).toEqual([
      ANONYMIZATION_SWEEP_SCHEDULER_ID,
    ]);
    // And its first job anonymises the account past the window.
    expect(await until(() => isAnonymized(due), 60_000)).toBe(true);
    expect((await stateOf(due)).email).toBe(`deleted+${due}@anonymized.invalid`);
    expect(announced).toContain(due);

    // The account still inside the window is untouched.
    expect(await stateOf(inside)).toEqual(insideBefore);
    expect(announced).not.toContain(inside);
  }, 120_000);

  it('installing the schedule again (a restart, or a second replica) keeps one scheduler under the same id', async () => {
    await ensureAnonymizationSweepSchedule(queue);
    await ensureAnonymizationSweepSchedule(queue);
    expect((await queue.getJobSchedulers()).map((scheduler) => scheduler.key)).toEqual([
      ANONYMIZATION_SWEEP_SCHEDULER_ID,
    ]);
  }, 60_000);

  it.each<OffStateAxis>(['deactivated', 'platform-unavailable'])(
    'with customers %s no tick runs, and the account is anonymised once the module is back',
    async (axis) => {
      const due = await deletedAccount(`off-${axis}`, RETENTION_DAYS + 1);
      await withModuleOff('customers', axis, async () => {
        const job = await queue.add('sweep', {});
        // Long enough for a running consumer to have taken it many times over.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        expect(completed).not.toContain(job.id);
        expect(await isAnonymized(due)).toBe(false);
        expect(announced).not.toContain(due);
      });
      // Back on: the tick that waited runs, and the account is anonymised.
      expect(await until(() => isAnonymized(due), 60_000)).toBe(true);
      expect(announced).toContain(due);
    },
    120_000,
  );
});
