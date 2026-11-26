import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import { RECORD_MERGE_CHANGED_CHANNEL, type MergeCoverageResult } from '@endora-commerce/contracts';
import { subscribeWhenReady } from '../cache/subscribe-when-ready.js';
import type { PlatformLogger } from '../logging.js';
import { enterSystemScope } from '../scope.js';
import { mergeFreezeState } from '../../tenancy/merge-freeze.js';
import { entityOwnerFromPath, populationFromMetadata, runtimeMergeCoverage } from './completeness.js';
import type { RecordMergeRegistry } from './registry.js';
import { runRecordMerge, type RecordMergeChangedEvent, type RecordMergeRunOutcome, type RecordMergeRunnerDeps } from './runner.js';
import { PlatformRecordMergeService, loadMergeFreezeSnapshot, type RecordMergeService } from './service.js';
import { PostgresRecordMergeStore } from './store.js';
import {
  buildRecordMergeWorker,
  createRecordMergeQueue,
  ensureRecordMergeCatchUpSchedule,
  processRecordMergeJob,
  recordMergeEnqueuer,
  runRecordMergeCatchUp,
  watchPresenceForCatchUp,
  type RecordMergeJobData,
} from './worker.js';

/**
 * The record-merge mechanism of one composed platform
 * (`specs/192-organization-merge/`, research R-1): the registry modules
 * register into, the service hosts call, the runner, the queue and the frozen
 * set's refresh. A composition root builds one, hands the registry to
 * `composeModules`, registers `recordMergeService` and `recordMergeRuntime`,
 * and `_lifecycle` starts the worker where this process runs workers.
 */
export interface RecordMergeRuntime {
  readonly registry: RecordMergeRegistry;
  readonly service: RecordMergeService;
  /** Run one merge as far as it goes, in this process (the worker's job; a test's direct drive). */
  run(mergeId: string): Promise<RecordMergeRunOutcome>;
  /** Enqueue every merge that has work now (running, or a deferred step whose module is back). */
  catchUp(): Promise<string[]>;
  /** The completeness twin's analysis, computed once from the ORM's metadata. */
  coverage(): MergeCoverageResult;
  /** Load the frozen and archived sets from the database. Never throws: a failure is logged and retried by the reload. */
  loadFreeze(): Promise<void>;
  /** Refresh the sets on the merge channel and every five minutes. */
  watch(redisSubscriber: Redis): Promise<void>;
  /** The consumer and the repeatable catch-up, where this process runs workers. */
  startWorker(input: {
    readonly processRunsWorkers: boolean;
    readonly attach: (worker: Worker<RecordMergeJobData>) => void;
    readonly onClose: (close: () => Promise<void>) => void;
  }): Promise<boolean>;
  close(): Promise<void>;
}

export interface CreateRecordMergeRuntimeOptions {
  readonly orm: Pick<MikroORM, 'getMetadata'>;
  readonly emFactory: () => EntityManager;
  readonly registry: RecordMergeRegistry;
  readonly isPresent: (moduleId: string) => boolean;
  /** `registryCache.onPresenceInstalled` — the catch-up's pub/sub path. */
  readonly onPresenceInstalled?: (listener: () => void) => () => void;
  /** The producer's (and the worker's) connection. Absent: nothing is enqueued, and a test drives `run`. */
  readonly redis?: Redis | undefined;
  readonly queuePrefix?: string;
  readonly log: Pick<PlatformLogger, 'info' | 'warn' | 'error'>;
  /** How often the frozen set is reloaded whole (default five minutes). */
  readonly freezeReloadMs?: number;
}

export function createRecordMergeRuntime(options: CreateRecordMergeRuntimeOptions): RecordMergeRuntime {
  const store = new PostgresRecordMergeStore(options.emFactory);
  let queue: Queue<RecordMergeJobData> | undefined;
  const producer = (): Queue<RecordMergeJobData> | undefined => {
    if (options.redis === undefined) return undefined;
    queue ??= createRecordMergeQueue(options.redis, options.queuePrefix);
    return queue;
  };
  const enqueue = recordMergeEnqueuer(producer, options.log);

  let coverage: MergeCoverageResult | undefined;
  const computeCoverage = (): MergeCoverageResult => {
    coverage ??= runtimeMergeCoverage({
      population: populationFromMetadata(
        [...new Set(options.orm.getMetadata().getAll().values())]
          .filter((meta) => !meta.embeddable && !meta.virtual && !meta.abstract)
          .map((meta) => ({ className: meta.className, properties: meta.properties, path: meta.path })),
        (_className, path) => entityOwnerFromPath(path),
      ),
      declarations: options.registry.allDeclarations(),
    });
    return coverage;
  };

  const loadFreeze = async (): Promise<void> => {
    try {
      const snapshot = await loadMergeFreezeSnapshot(options.emFactory().fork({ clear: true }));
      mergeFreezeState.replace(snapshot);
    } catch (error) {
      options.log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'record-merge: the frozen set could not be loaded; the next reload retries',
      );
    }
  };

  const publishChanged = async (): Promise<void> => {
    if (options.redis === undefined) return;
    await options.redis.publish(RECORD_MERGE_CHANGED_CHANNEL, '{}');
  };

  const onChanged = async (event: RecordMergeChangedEvent): Promise<void> => {
    if (event.state === 'completed') mergeFreezeState.archive(event.hostType, event.loserId, event.mergeId, event.survivorId);
    else if (event.state === 'cancelled') mergeFreezeState.unfreeze(event.hostType, event.loserId);
    else mergeFreezeState.freeze(event.hostType, event.loserId, event.mergeId);
    await publishChanged().catch(() => undefined);
    if (event.state === 'needs_attention') {
      options.log.warn({ mergeId: event.mergeId, hostType: event.hostType }, 'record-merge: a merge needs attention');
    }
  };

  const runnerDeps: RecordMergeRunnerDeps = {
    store,
    registry: options.registry,
    isPresent: options.isPresent,
    enterScope: (reason, run) => enterSystemScope(reason, () => run()),
    onChanged,
    log: options.log,
  };

  const service = new PlatformRecordMergeService({
    emFactory: options.emFactory,
    registry: options.registry,
    isPresent: options.isPresent,
    coverage: computeCoverage,
    enqueue,
    publishChanged,
  });

  const closers: (() => Promise<void> | void)[] = [];

  return {
    registry: options.registry,
    service,
    run: (mergeId) => enterSystemScope('record-merge: runner', () => runRecordMerge(mergeId, runnerDeps)),
    catchUp: () =>
      enterSystemScope('record-merge: catch-up', () =>
        runRecordMergeCatchUp({ store, isPresent: options.isPresent, enqueue }),
      ),
    coverage: computeCoverage,
    loadFreeze,
    async watch(redisSubscriber: Redis): Promise<void> {
      redisSubscriber.on('message', (channel: string) => {
        if (channel !== RECORD_MERGE_CHANGED_CHANNEL) return;
        void enterSystemScope('record-merge: reload the frozen set', () => loadFreeze());
      });
      try {
        await subscribeWhenReady(redisSubscriber, RECORD_MERGE_CHANGED_CHANNEL);
      } catch (error) {
        options.log.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'record-merge: could not subscribe to the merge channel; the periodic reload keeps the frozen set fresh',
        );
      }
      const timer = setInterval(() => {
        void enterSystemScope('record-merge: reload the frozen set', () => loadFreeze());
      }, options.freezeReloadMs ?? 5 * 60_000);
      timer.unref();
      closers.push(() => clearInterval(timer));
    },
    async startWorker(input): Promise<boolean> {
      if (!input.processRunsWorkers || options.redis === undefined) return false;
      const target = producer()!;
      input.attach(
        buildRecordMergeWorker({
          redis: options.redis,
          ...(options.queuePrefix !== undefined ? { prefix: options.queuePrefix } : {}),
          process: (data) => processRecordMergeJob(data, { runner: runnerDeps, store, enqueue }),
        }),
      );
      await ensureRecordMergeCatchUpSchedule(target);
      if (options.onPresenceInstalled !== undefined) {
        const stop = watchPresenceForCatchUp(
          options.onPresenceInstalled,
          async () => {
            await enterSystemScope('record-merge: catch-up', () =>
              runRecordMergeCatchUp({ store, isPresent: options.isPresent, enqueue }),
            );
          },
          options.log,
        );
        closers.push(stop);
      }
      input.onClose(async () => {
        await target.close();
      });
      return true;
    },
    async close(): Promise<void> {
      for (const close of closers.splice(0)) await close();
      if (queue !== undefined) await queue.close();
    },
  };
}
