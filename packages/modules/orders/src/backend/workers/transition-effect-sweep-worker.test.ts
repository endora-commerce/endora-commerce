import { describe, expect, it, vi } from 'vitest';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  TRANSITION_EFFECT_SWEEP_EVERY_MS,
  TRANSITION_EFFECT_SWEEP_QUEUE,
  TRANSITION_EFFECT_SWEEP_SCHEDULER_ID,
  ensureTransitionEffectSweepSchedule,
  transitionEffectSweepProcessor,
} from './transition-effect-sweep-worker.js';

/**
 * The sweep worker (`specs/142-order-transition-atomicity/`, D6, FR-012).
 *
 * BullMQ is the clock and nothing else, so what there is to test without Redis
 * is the processor — one `sweep()` per job, inside a system scope — and the
 * schedule it is installed under.
 */

const noLog = { info: () => undefined, warn: vi.fn(), error: () => undefined };

describe('transitionEffectSweepProcessor', () => {
  it('runs one sweep per job, inside a system tenant scope', async () => {
    const seen: Array<string | undefined> = [];
    const sweep = vi.fn(async () => {
      seen.push(getTenantContext()?.actor.kind);
      return { done: 0, blocked: 0, failed: 0, skipped: 0 };
    });
    const processor = transitionEffectSweepProcessor({ effects: { sweep }, log: noLog });

    // No ambient context before the job: the processor has to establish one.
    expect(getTenantContext()).toBeUndefined();
    await processor();
    await processor();

    expect(sweep).toHaveBeenCalledTimes(2);
    expect(seen).toEqual(['system', 'system']);
  });

  it('logs a failed pass and does not fail the job — the next tick is the retry', async () => {
    const warn = vi.fn();
    const sweep = vi.fn(async () => {
      throw new Error('database unavailable');
    });
    const processor = transitionEffectSweepProcessor({
      effects: { sweep },
      log: { ...noLog, warn },
    });

    await expect(processor()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      { error: 'database unavailable' },
      expect.stringContaining('sweep'),
    );
  });
});

describe('ensureTransitionEffectSweepSchedule', () => {
  it('installs one scheduler, by a stable id, firing every sixty seconds', async () => {
    const upsertJobScheduler = vi.fn(async () => undefined);

    await ensureTransitionEffectSweepSchedule({ upsertJobScheduler });

    expect(TRANSITION_EFFECT_SWEEP_EVERY_MS).toBe(60_000);
    expect(upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      TRANSITION_EFFECT_SWEEP_SCHEDULER_ID,
      { every: 60_000 },
      { name: 'sweep', data: {} },
    );
  });

  it('names its queue in the module`s namespace', () => {
    expect(TRANSITION_EFFECT_SWEEP_QUEUE.startsWith('orders')).toBe(true);
  });
});
