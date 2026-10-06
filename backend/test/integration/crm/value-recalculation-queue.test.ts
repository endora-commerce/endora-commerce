import { Queue, type Job, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import {
  createCrmOpportunity,
  linkCrmOrder,
  restoreDefaultCrmWorkflow,
  seedCrmOrder,
  setCrmCountingStatuses,
} from '../../helpers/seed-crm.js';
import {
  createValueRecalculationProducer,
  startValueRecalculation,
  VALUE_RECALCULATION_QUEUE,
  type ValueRecalculationJobData,
  type ValueRecalculationProducer,
} from '../../../../packages/modules/crm/src/backend/workers/value-recalculation-worker.js';

/**
 * The recalculation queue against a real Redis — the module's own producer and
 * the module's own consumer, with BullMQ between them
 * (`specs/143-crm-sales-opportunities/research.md` N-S7).
 *
 * **Why this is not only `setupBackendServer`.** The harness composes with
 * `moduleQueueRedis: undefined` on purpose, so under it the module enqueues
 * nothing and builds no consumer, and every other test of the value drives the
 * pass by calling the service. That leaves three things nobody measured: that
 * saving the counting statuses asks the queue at all, that the function BullMQ
 * invokes enters a system scope before it reads a tenant-scoped table, and
 * that the per-Opportunity job holds one waiting request however often it is
 * asked. Here the application is the harness's, and the producer and the
 * consumer are built beside it on a real connection — by the module's own
 * factories, so what runs is what a worker process runs.
 *
 * The queue name is fixed, so the run starts by obliterating it.
 */
describe('crm value recalculation queue (real BullMQ)', () => {
  let h: BackendServerHandle;
  let redis: Redis;
  let queue: Queue<ValueRecalculationJobData>;
  let producer: ValueRecalculationProducer;
  let worker: Worker<ValueRecalculationJobData> | undefined;

  const valueService = () =>
    h.container.resolve('crmOpportunityValueService') as {
      recalculateAll(): Promise<number>;
      recalculate(id: string): Promise<boolean>;
    };

  const storedComputedValue = async (id: string): Promise<string> => {
    const rows = (await h.em().execute(`select "computed_value" from "crm_opportunities" where "id" = ?`, [
      id,
    ])) as Array<{ computed_value: string }>;
    return rows[0]?.computed_value ?? '';
  };

  /** Every job the consumer finished, and every failure, from the moment it was built. */
  let completed: Array<Job<ValueRecalculationJobData>> = [];
  let failures: Error[] = [];
  /**
   * The tenant scope each job's work found itself in, by mode and by the reason
   * it was entered for. The reason is what tells the consumer's own scope from
   * the one the harness leaves ambient around a test.
   */
  let scopes: string[] = [];
  const CONSUMER_SCOPE = 'system: crm: recalculate computed opportunity values';
  const recordScope = () => {
    const context = getTenantContext();
    scopes.push(`${context?.mode}: ${(context as { reason?: string } | undefined)?.reason}`);
  };

  /** Build the consumer exactly as the module's composition does, on the real connection. */
  const startConsumer = async (): Promise<Worker<ValueRecalculationJobData>> => {
    completed = [];
    failures = [];
    scopes = [];
    let attached: Worker<ValueRecalculationJobData> | undefined;
    const started = startValueRecalculation({
      processRunsWorkers: true,
      moduleQueueRedis: redis,
      recalculateAll: () => {
        recordScope();
        return valueService().recalculateAll();
      },
      recalculateOne: (opportunityId) => {
        recordScope();
        return valueService().recalculate(opportunityId);
      },
      log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never,
      attach: (built) => {
        // Listening before the consumer takes its first job.
        built.on('completed', (job) => completed.push(job));
        built.on('failed', (_job, error) => failures.push(error));
        attached = built;
      },
    });
    expect(started).toBe(true);
    if (!attached) throw new Error('the consumer was not attached');
    await attached.waitUntilReady();
    worker = attached;
    return attached;
  };

  /** Resolves once the consumer has finished `count` jobs; fails with the first failure. */
  const finishedJobs = (count: number) =>
    vi.waitFor(
      () => {
        if (failures[0]) throw failures[0];
        expect(completed.length).toBeGreaterThanOrEqual(count);
        return completed;
      },
      { timeout: 30_000, interval: 50 },
    );

  beforeAll(async () => {
    h = await setupBackendServer();
    await restoreDefaultCrmWorkflow(h.em());
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue<ValueRecalculationJobData>(VALUE_RECALCULATION_QUEUE, { connection: redis });
    await queue.obliterate({ force: true });
    producer = createValueRecalculationProducer(redis);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await worker?.close();
    worker = undefined;
    await queue.obliterate({ force: true }).catch(() => undefined);
  });

  afterAll(async () => {
    await producer.close();
    await queue.close();
    await redis.quit();
    await setCrmCountingStatuses(h, { order: [], quoteRequest: [] });
    await restoreDefaultCrmWorkflow(h.em());
    await teardownBackendServer(h);
  });

  it('saving the counting statuses enqueues a pass, and the consumer runs it in a scope of its own', async () => {
    expect((await setCrmCountingStatuses(h, { order: [], quoteRequest: [] })).statusCode).toBe(202);
    const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
    const order = await seedCrmOrder(h.em(), { status: 'paid', total: '64.00' });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    expect(await storedComputedValue(opportunity.id)).toBe('0.00');

    // The application's producer has no connection under the harness; hand its
    // one call to the real one. Everything before and after it is the product's.
    const composed = h.container.resolve('crmValueRecalculationProducer') as ValueRecalculationProducer;
    vi.spyOn(composed, 'enqueue').mockImplementation(() => producer.enqueue());

    await startConsumer();
    expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);

    const [job] = await finishedJobs(1);
    expect(job?.data.opportunityId).toBeUndefined();
    // No request is behind a job: the consumer starts the scope its work runs in.
    expect(scopes).toEqual([CONSUMER_SCOPE]);
    expect(await storedComputedValue(opportunity.id)).toBe('64.00');
  }, 60_000);

  it('holds one waiting request per Opportunity however often it is asked, and takes another once that ran', async () => {
    expect((await setCrmCountingStatuses(h, { order: ['paid'], quoteRequest: [] })).statusCode).toBe(202);
    const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
    const other = await createCrmOpportunity(h, { valueMode: 'computed' });
    const order = await seedCrmOrder(h.em(), { status: 'paid', total: '31.00' });
    expect((await linkCrmOrder(h, opportunity.id, order.id)).statusCode).toBe(201);
    await h.em().execute(`update "crm_opportunities" set "computed_value" = '1.00' where "id" = ?`, [
      opportunity.id,
    ]);

    // No consumer yet: the requests wait.
    for (let asked = 0; asked < 5; asked += 1) expect(await producer.enqueueOne(opportunity.id)).toBe(true);
    await producer.enqueueOne(other.id);
    expect(await queue.getWaitingCount()).toBe(2);

    await startConsumer();
    const seen = (await finishedJobs(2)).map((job) => job.data.opportunityId);
    expect([...seen].sort()).toEqual([opportunity.id, other.id].sort());
    expect(scopes).toEqual([CONSUMER_SCOPE, CONSUMER_SCOPE]);
    expect(await storedComputedValue(opportunity.id)).toBe('31.00');

    // Finished and gone, so the next request for the same Opportunity is a new job.
    await h.em().execute(`update "crm_opportunities" set "computed_value" = '2.00' where "id" = ?`, [
      opportunity.id,
    ]);
    expect(await producer.enqueueOne(opportunity.id)).toBe(true);
    expect((await finishedJobs(3))[2]?.data.opportunityId).toBe(opportunity.id);
    expect(await storedComputedValue(opportunity.id)).toBe('31.00');
  }, 60_000);

  it('a pass that fails is tried again, later: every job carries attempts and a backoff', async () => {
    // No consumer: the jobs wait, and what they were enqueued with can be read.
    await producer.enqueue();
    const opportunity = await createCrmOpportunity(h, { valueMode: 'computed' });
    await producer.enqueueOne(opportunity.id);

    const waiting = await queue.getJobs(['waiting']);
    expect(waiting).toHaveLength(2);
    for (const job of waiting) {
      expect(job.opts.attempts).toBe(3);
      expect(job.opts.backoff).toEqual({ type: 'exponential', delay: 5_000 });
    }
  }, 60_000);
});
