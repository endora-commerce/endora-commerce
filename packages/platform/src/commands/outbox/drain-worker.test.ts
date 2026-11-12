import { describe, expect, it, vi } from 'vitest';
import { getTenantContext } from '../../tenancy/tenant-context.js';
import {
  COMMAND_OUTBOX_DRAIN_EVERY_MS,
  COMMAND_OUTBOX_DRAIN_QUEUE,
  COMMAND_OUTBOX_DRAIN_SCHEDULER_ID,
  COMMAND_OUTBOX_WAKE_JOB_ID,
} from './constants.js';
import {
  COMMAND_OUTBOX_DRAIN_SCOPE_REASON,
  ensureCommandOutboxDrainSchedule,
  runCommandOutboxDrainTick,
  startCommandOutboxDrain,
  type CommandOutboxDrainTickDeps,
} from './drain-worker.js';
import type { OutboxStore } from './store.js';
import { createCommandOutboxWake } from './wake.js';

/**
 * `specs/176-command-hooks-outbox/` T042 (FR-033): the clock of the outbox
 * drain, in the `quote_requests` sweep's shape — BullMQ stood in for, so what
 * is held is what the platform hands it, and no connection is opened.
 */

const bull = vi.hoisted(() => ({
  queues: [] as Array<{
    name: string;
    options: Record<string, unknown>;
    upsertJobScheduler: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  workers: [] as Array<{ name: string; processor: () => Promise<unknown>; options: Record<string, unknown> }>,
  addFails: false,
}));
vi.mock('bullmq', () => ({
  Queue: class {
    readonly upsertJobScheduler = vi.fn(async () => undefined);
    readonly add = vi.fn(async () => {
      if (bull.addFails) throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
      return {};
    });
    readonly close = vi.fn(async () => undefined);
    constructor(
      readonly name: string,
      readonly options: Record<string, unknown>,
    ) {
      bull.queues.push(this);
    }
  },
  Worker: class {
    constructor(
      readonly name: string,
      readonly processor: () => Promise<unknown>,
      readonly options: Record<string, unknown>,
    ) {
      bull.workers.push(this);
    }
  },
}));

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

function idleStore(hasWork: boolean | (() => Promise<boolean>)): OutboxStore {
  const fail = async (): Promise<never> => {
    throw new Error('not reached');
  };
  return {
    hasWork: typeof hasWork === 'function' ? hasWork : async () => hasWork,
    reclaimExpiredLeases: async () => 0,
    claim: async () => [],
    markDelivered: fail,
    markRetry: fail,
    markDead: fail,
    release: fail,
    purge: async () => ({ delivered: 0, dead: 0 }),
  };
}

const handlers = { isPresent: () => true, afterCommitHandler: () => undefined };

function tickDeps(store: OutboxStore, enterScope = vi.fn(async (_reason: string, run: () => Promise<unknown>) => run())) {
  const deps: CommandOutboxDrainTickDeps = { store, handlers, log: logger(), enterScope: enterScope as never };
  return { deps, enterScope };
}

describe('command outbox drain — the clock (176 T042)', () => {
  it('names a queue BullMQ accepts, ticks every ten seconds and deduplicates its wake-up', () => {
    expect(COMMAND_OUTBOX_DRAIN_QUEUE).toBe('command_outbox.drain');
    expect(COMMAND_OUTBOX_DRAIN_QUEUE).not.toContain(':');
    expect(COMMAND_OUTBOX_DRAIN_SCHEDULER_ID).toBe('command_outbox.drain');
    expect(COMMAND_OUTBOX_WAKE_JOB_ID).toBe('command_outbox.drain.wake');
    expect(COMMAND_OUTBOX_DRAIN_EVERY_MS).toBe(10_000);
  });

  it('installs one scheduler by id, idempotently: every boot of every worker process upserts the same one', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);
    await ensureCommandOutboxDrainSchedule({ upsertJobScheduler } as never);
    await ensureCommandOutboxDrainSchedule({ upsertJobScheduler } as never);
    expect(upsertJobScheduler.mock.calls).toEqual([
      ['command_outbox.drain', { every: 10_000 }, { name: 'tick', data: {} }],
      ['command_outbox.drain', { every: 10_000 }, { name: 'tick', data: {} }],
    ]);
  });

  it.each([
    ['the process runs none', { processRunsWorkers: false, moduleQueueRedis: {} as never }],
    ['the composition offers no connection', { processRunsWorkers: true, moduleQueueRedis: undefined }],
  ])('builds no consumer and installs no schedule where %s', async (_where, host) => {
    bull.queues.length = 0;
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = await startCommandOutboxDrain({ store: idleStore(false), handlers, log: logger(), attach, onClose, ...host });
    expect(started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(bull.queues).toEqual([]);
  });

  it('where the process consumes queues: one consumer through the seam, one tick at a time, and the schedule', async () => {
    bull.queues.length = 0;
    bull.workers.length = 0;
    const attach = vi.fn();
    const closers: Array<() => Promise<void>> = [];
    const started = await startCommandOutboxDrain({
      store: idleStore(false),
      handlers,
      log: logger(),
      processRunsWorkers: true,
      moduleQueueRedis: {} as never,
      attach,
      onClose: (close) => closers.push(close),
    });
    expect(started).toBe(true);
    expect(bull.queues.map((queue) => queue.name)).toEqual([COMMAND_OUTBOX_DRAIN_QUEUE]);
    expect(bull.workers.map((worker) => worker.name)).toEqual([COMMAND_OUTBOX_DRAIN_QUEUE]);
    expect(attach).toHaveBeenCalledWith(bull.workers[0]);
    expect(bull.workers[0]?.options).toMatchObject({ concurrency: 1 });
    expect(bull.queues[0]?.upsertJobScheduler).toHaveBeenCalledTimes(1);
    await closers[0]?.();
    expect(bull.queues[0]?.close).toHaveBeenCalledTimes(1);
  });
});

describe('command outbox drain — the wake-up (176 T042)', () => {
  it('enqueues a deduplicated wake job on the drain queue, building the queue once and only when asked', async () => {
    bull.queues.length = 0;
    bull.addFails = false;
    const wake = createCommandOutboxWake({} as never);
    expect(bull.queues).toEqual([]);
    await wake.wake();
    await wake.wake();
    expect(bull.queues.map((queue) => queue.name)).toEqual([COMMAND_OUTBOX_DRAIN_QUEUE]);
    const calls = bull.queues[0]!.add.mock.calls;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call[0]).toBe('wake');
      expect(call[2]).toMatchObject({ deduplication: { id: COMMAND_OUTBOX_WAKE_JOB_ID } });
    }
    await wake.close();
    expect(bull.queues[0]!.close).toHaveBeenCalledTimes(1);
  });

  it('swallows a Redis failure: the row is in Postgres and the scheduled tick delivers it', async () => {
    bull.queues.length = 0;
    bull.addFails = true;
    const wake = createCommandOutboxWake({} as never);
    await expect(wake.wake()).resolves.toBeUndefined();
    bull.addFails = false;
  });

  it('closes nothing when it never woke', async () => {
    bull.queues.length = 0;
    const wake = createCommandOutboxWake({} as never);
    await wake.close();
    expect(bull.queues).toEqual([]);
  });
});

describe('command outbox drain — one tick (176 T042)', () => {
  it('an idle tick asks one question and enters no scope', async () => {
    const hasWork = vi.fn(async () => false);
    const { deps, enterScope } = tickDeps(idleStore(hasWork));
    await runCommandOutboxDrainTick(deps);
    expect(hasWork).toHaveBeenCalledTimes(1);
    expect(enterScope).not.toHaveBeenCalled();
  });

  it('a tick with work enters one system scope with the drain’s reason', async () => {
    const { deps, enterScope } = tickDeps(idleStore(true));
    await runCommandOutboxDrainTick(deps);
    expect(enterScope).toHaveBeenCalledTimes(1);
    expect(enterScope.mock.calls[0]?.[0]).toBe(COMMAND_OUTBOX_DRAIN_SCOPE_REASON);
  });

  it('by default the scope is the platform system scope', async () => {
    const seen: unknown[] = [];
    const store = idleStore(true);
    store.reclaimExpiredLeases = async () => {
      seen.push(getTenantContext());
      return 0;
    };
    await runCommandOutboxDrainTick({ store, handlers, log: logger() });
    expect(seen).toEqual([expect.objectContaining({ mode: 'system', reason: COMMAND_OUTBOX_DRAIN_SCOPE_REASON })]);
  });

  it('a question that cannot be answered counts as yes', async () => {
    const { deps, enterScope } = tickDeps(
      idleStore(async () => {
        throw new Error('the probe could not read');
      }),
    );
    await runCommandOutboxDrainTick(deps);
    expect(enterScope).toHaveBeenCalledTimes(1);
  });

  it('a failed pass is logged and does not fail the job — the next tick is the retry', async () => {
    const store = idleStore(true);
    store.reclaimExpiredLeases = async () => {
      throw new Error('database went away');
    };
    const { deps } = tickDeps(store);
    await expect(runCommandOutboxDrainTick(deps)).resolves.toBeUndefined();
    expect(deps.log.warn).toHaveBeenCalledTimes(1);
  });
});
