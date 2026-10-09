import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTenantContext } from '@endora-commerce/platform/tenancy';

/**
 * The sweep worker (`specs/142-order-transition-atomicity/`, D6, FR-012).
 *
 * BullMQ is replaced by two recording classes, so what is under test is the
 * code that ships: the processor **the worker is constructed with** — not a
 * sibling function the worker might or might not use — and the wiring that
 * decides whether a worker is built at all. A test over a function production
 * never calls stays green when the worker loses its scope or its processor;
 * this one does not.
 */

interface BuiltWorker {
  name: string;
  processor: () => Promise<unknown>;
  options: Record<string, unknown>;
}
const built: { workers: BuiltWorker[]; queues: FakeQueue[] } = { workers: [], queues: [] };

class FakeQueue {
  readonly upsertJobScheduler = vi.fn(async () => undefined);
  readonly close = vi.fn(async () => undefined);
  constructor(
    readonly name: string,
    readonly options: Record<string, unknown>,
  ) {
    built.queues.push(this);
  }
}

vi.mock('bullmq', () => ({
  Queue: FakeQueue,
  Worker: class {
    constructor(name: string, processor: () => Promise<unknown>, options: Record<string, unknown>) {
      built.workers.push({ name, processor, options });
    }
  },
}));

const {
  TRANSITION_EFFECT_SWEEP_EVERY_MS,
  TRANSITION_EFFECT_SWEEP_QUEUE,
  TRANSITION_EFFECT_SWEEP_SCHEDULER_ID,
  buildTransitionEffectSweepWorker,
  startTransitionEffectSweep,
} = await import('./transition-effect-sweep-worker.js');

const redis = { fake: 'redis' } as never;
const quiet = { info: () => undefined, warn: vi.fn(), error: () => undefined };
const summary = { done: 0, blocked: 0, failed: 0, skipped: 0 };

beforeEach(() => {
  built.workers.length = 0;
  built.queues.length = 0;
  quiet.warn.mockReset();
});

describe('the worker that ships', () => {
  it('consumes the module`s own queue, one tick at a time', () => {
    buildTransitionEffectSweepWorker({ redis, effects: { sweep: async () => summary, hasSweepWork: async () => true }, log: quiet });

    expect(built.workers).toHaveLength(1);
    expect(built.workers[0]!.name).toBe(TRANSITION_EFFECT_SWEEP_QUEUE);
    expect(TRANSITION_EFFECT_SWEEP_QUEUE.startsWith('orders.')).toBe(true);
    expect(built.workers[0]!.options).toEqual({ connection: redis, concurrency: 1 });
  });

  it('runs one sweep per job, inside a system tenant scope it establishes itself', async () => {
    const seen: Array<string | undefined> = [];
    const sweep = vi.fn(async () => {
      seen.push(getTenantContext()?.actor.kind);
      return summary;
    });
    buildTransitionEffectSweepWorker({
      redis,
      effects: { sweep, hasSweepWork: async () => true },
      log: quiet,
    });
    const { processor } = built.workers[0]!;

    // A worker has no request: there is no ambient context for it to inherit.
    expect(getTenantContext()).toBeUndefined();
    await processor();
    await processor();

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['system', 'system']);
  });

  it('logs a failed pass and does not fail the job — the next tick is the retry', async () => {
    buildTransitionEffectSweepWorker({
      redis,
      effects: {
        hasSweepWork: async () => true,
        sweep: async () => {
          throw new Error('database unavailable');
        },
      },
      log: quiet,
    });

    await expect(built.workers[0]!.processor()).resolves.toBeUndefined();

    expect(quiet.warn).toHaveBeenCalledWith(
      { error: 'database unavailable' },
      expect.stringContaining('sweep'),
    );
  });
});

describe('an idle tick opens no scope (issue #120)', () => {
  /** Every escape-hatch record the default sink printed while `run` ran. */
  const escapeHatchLines = async (run: () => Promise<unknown>): Promise<string[]> => {
    const lines: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      const line = String(chunk);
      if (line.includes('tenant.escape_hatch')) lines.push(line);
      return true;
    });
    try {
      await run();
    } finally {
      write.mockRestore();
    }
    return lines;
  };

  it('asks whether there is work outside any tenant context, and stops there when there is none', async () => {
    const asked: Array<string | undefined> = [];
    const sweep = vi.fn(async () => summary);
    const hasSweepWork = vi.fn(async () => {
      asked.push(getTenantContext()?.actor.kind);
      return false;
    });
    buildTransitionEffectSweepWorker({ redis, effects: { sweep, hasSweepWork }, log: quiet });
    const { processor } = built.workers[0]!;

    const lines = await escapeHatchLines(async () => {
      await processor();
      await processor();
      await processor();
    });

    expect(hasSweepWork).toHaveBeenCalledTimes(3);
    // The question is not asked under a widened scope: there is none yet.
    expect(asked).toEqual([undefined, undefined, undefined]);
    expect(sweep).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('a tick with work reports its scope entry exactly as before', async () => {
    const sweep = vi.fn(async () => summary);
    buildTransitionEffectSweepWorker({
      redis,
      effects: { sweep, hasSweepWork: async () => true },
      log: quiet,
    });

    const lines = await escapeHatchLines(() => built.workers[0]!.processor());

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      msg: 'tenant.escape_hatch',
      scope: 'system',
      reason: 'orders: sweep outstanding order follow-ups',
      entryPoint: 'worker',
    });
  });

  it('a question that cannot be answered counts as yes — the tick runs, scope and record included', async () => {
    const seen: Array<string | undefined> = [];
    const sweep = vi.fn(async () => {
      seen.push(getTenantContext()?.actor.kind);
      return summary;
    });
    buildTransitionEffectSweepWorker({
      redis,
      effects: {
        sweep,
        hasSweepWork: async () => {
          throw new Error('connection refused');
        },
      },
      log: quiet,
    });

    const lines = await escapeHatchLines(() => built.workers[0]!.processor());

    expect(seen).toEqual(['system']);
    expect(lines).toHaveLength(1);
  });
});

describe('startTransitionEffectSweep — whether a consumer is built at all', () => {
  const start = (host: { processRunsWorkers: boolean; moduleQueueRedis: unknown }) => {
    const attach = vi.fn();
    const onClose = vi.fn();
    const started = startTransitionEffectSweep({
      processRunsWorkers: host.processRunsWorkers,
      moduleQueueRedis: host.moduleQueueRedis as never,
      effects: { sweep: async () => summary, hasSweepWork: async () => true },
      log: quiet,
      attach,
      onClose,
    });
    return { attach, onClose, started };
  };

  it('builds nothing in a process that does not consume queues', async () => {
    const { attach, started } = start({ processRunsWorkers: false, moduleQueueRedis: redis });

    expect(await started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(built.workers).toHaveLength(0);
    expect(built.queues).toHaveLength(0);
  });

  it('builds nothing in a composition that offers no queue connection', async () => {
    const { attach, started } = start({ processRunsWorkers: true, moduleQueueRedis: undefined });

    expect(await started).toBe(false);
    expect(attach).not.toHaveBeenCalled();
    expect(built.workers).toHaveLength(0);
  });

  it('with both, hands the worker to the platform seam, installs the schedule and closes its queue on shutdown', async () => {
    const { attach, onClose, started } = start({ processRunsWorkers: true, moduleQueueRedis: redis });

    expect(await started).toBe(true);
    // The worker reaches `ctx.worker` — the seam that lets the platform stop it.
    expect(attach).toHaveBeenCalledTimes(1);
    expect(built.workers).toHaveLength(1);

    const [queue] = built.queues;
    expect(queue!.name).toBe(TRANSITION_EFFECT_SWEEP_QUEUE);
    expect(TRANSITION_EFFECT_SWEEP_EVERY_MS).toBe(60_000);
    expect(queue!.upsertJobScheduler).toHaveBeenCalledWith(
      TRANSITION_EFFECT_SWEEP_SCHEDULER_ID,
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    await (onClose.mock.calls[0]![0] as () => Promise<void>)();
    expect(queue!.close).toHaveBeenCalledTimes(1);
  });
});
