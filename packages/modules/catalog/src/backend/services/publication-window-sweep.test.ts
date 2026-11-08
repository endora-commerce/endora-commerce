import { describe, expect, it, vi } from 'vitest';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import { getTenantContext } from '@endora-commerce/platform/tenancy';
import {
  PUBLICATION_WINDOW_SWEEP_EVERY_MS,
  PUBLICATION_WINDOW_WATERMARK_KEY,
  PublicationWindowSweep,
  runPublicationWindowSweepTick,
  type PublicationWindowSweepResult,
} from './publication-window-sweep.js';

/**
 * Issue #894 — an idle tick of the publication-window sweep enters no scope.
 *
 * The tick asks `hasDueTransitions()` first, with no tenant context, and opens
 * the system scope (and its `tenant.escape_hatch` audit row) only on yes. The
 * question and the sweep's own query are built from one statement of the
 * predicate (`crossedRows`), so they cannot drift apart.
 */

const NOW = new Date('2031-06-15T12:00:00.000Z');
const FIVE_MINUTES_AGO = new Date(NOW.getTime() - 5 * 60_000);

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
const nothing: PublicationWindowSweepResult = { from: FIVE_MINUTES_AGO, until: NOW, productIds: [] };

/** An EntityManager that records what it was asked and answers from `answer`. */
function recordingEm(answer: (sql: string) => unknown) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const em = {
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return answer(sql);
    }),
  };
  return { em, calls };
}

function watermarkAt(at: Date | null) {
  const store = new Map<string, string>();
  if (at) store.set(PUBLICATION_WINDOW_WATERMARK_KEY, String(at.getTime()));
  return {
    store,
    watermark: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK' as const;
      }),
    },
  };
}

describe('PublicationWindowSweep.hasDueTransitions (#894)', () => {
  it('asks one exists(…) per row source the sweep selects from, over the interval the sweep would cover', async () => {
    const probeEm = recordingEm(() => [{ has_work: true }]);
    const sweepEm = recordingEm(() => []);
    const { watermark } = watermarkAt(FIVE_MINUTES_AGO);
    const probe = new PublicationWindowSweep(() => probeEm.em as never, watermark as never, () => undefined);
    const sweep = new PublicationWindowSweep(() => sweepEm.em as never, watermark as never, () => undefined);

    expect(await probe.hasDueTransitions(NOW)).toBe(true);
    await sweep.sweep(NOW);

    const sources = probe.crossedRows(FIVE_MINUTES_AGO, NOW);
    expect(sources).toHaveLength(2);
    expect(probeEm.calls).toHaveLength(1);
    expect(probeEm.calls[0]!.sql).toBe(
      `select (${sources.map((source) => `exists(select 1 ${source.from})`).join(' or ')}) as "has_work"`,
    );
    // The sweep lists from the very same row sources, with the very same parameters.
    expect(sweepEm.calls).toHaveLength(1);
    for (const source of sources) expect(sweepEm.calls[0]!.sql).toContain(source.from);
    expect(sweepEm.calls[0]!.params).toEqual(probeEm.calls[0]!.params);
    expect(probeEm.calls[0]!.params).toEqual(sources.flatMap((source) => [...source.params]));
  });

  it('answers no from the database when no bound was crossed', async () => {
    const { em } = recordingEm(() => [{ has_work: false }]);
    const { watermark } = watermarkAt(FIVE_MINUTES_AGO);
    const probe = new PublicationWindowSweep(() => em as never, watermark as never, () => undefined);

    expect(await probe.hasDueTransitions(NOW)).toBe(false);
  });

  it('with no watermark asks about now − 2 × interval, as the sweep would', async () => {
    const { em, calls } = recordingEm(() => [{ has_work: false }]);
    const { watermark } = watermarkAt(null);
    const probe = new PublicationWindowSweep(() => em as never, watermark as never, () => undefined);

    await probe.hasDueTransitions(NOW);

    const from = new Date(NOW.getTime() - 2 * PUBLICATION_WINDOW_SWEEP_EVERY_MS);
    expect(calls[0]!.params).toEqual(probe.crossedRows(from, NOW).flatMap((source) => [...source.params]));
  });

  it('an empty interval is nothing due, and asks the database nothing', async () => {
    const { em } = recordingEm(() => [{ has_work: true }]);
    const { watermark } = watermarkAt(NOW);
    const probe = new PublicationWindowSweep(() => em as never, watermark as never, () => undefined);

    expect(await probe.hasDueTransitions(NOW)).toBe(false);
    expect(em.execute).not.toHaveBeenCalled();
  });

  it('writes nothing: the watermark is the sweep`s to move', async () => {
    const { em } = recordingEm(() => [{ has_work: true }]);
    const { watermark } = watermarkAt(FIVE_MINUTES_AGO);
    const probe = new PublicationWindowSweep(() => em as never, watermark as never, () => undefined);

    await probe.hasDueTransitions(NOW);

    expect(watermark.set).not.toHaveBeenCalled();
  });
});

describe('runPublicationWindowSweepTick (#894)', () => {
  it('with nothing due it asks, outside any scope, and runs no sweep', async () => {
    const seen: Array<string | undefined> = [];
    const hasDueTransitions = vi.fn(async () => {
      seen.push(getTenantContext()?.actor.kind);
      return false;
    });
    const sweep = vi.fn(async () => nothing);

    await runPublicationWindowSweepTick({ sweep: { hasDueTransitions, sweep }, log: logger() });

    expect(hasDueTransitions).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([undefined]);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('with something due it sweeps inside the system scope', async () => {
    const seen: Array<string | undefined> = [];
    const sweep = vi.fn(async () => {
      seen.push(getTenantContext()?.actor.kind);
      return { ...nothing, productIds: ['a-product'] };
    });
    const log = logger();

    await runPublicationWindowSweepTick({ sweep: { hasDueTransitions: async () => true, sweep }, log });

    expect(sweep).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['system']);
    expect(log.info).toHaveBeenCalledTimes(1);
  });

  it('a question that cannot be answered counts as yes: the sweep runs', async () => {
    const sweep = vi.fn(async () => nothing);

    await runPublicationWindowSweepTick({
      sweep: {
        hasDueTransitions: async () => {
          throw new Error('the probe could not read');
        },
        sweep,
      },
      log: logger(),
    });

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('a module switched off under the question is not a failed question', async () => {
    const sweep = vi.fn(async () => nothing);

    await expect(
      runPublicationWindowSweepTick({
        sweep: {
          hasDueTransitions: async () => {
            throw new ModuleDisabledError('catalog');
          },
          sweep,
        },
        log: logger(),
      }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
    expect(sweep).not.toHaveBeenCalled();
  });

  it('a failed sweep is logged and does not fail the job', async () => {
    const log = logger();

    await expect(
      runPublicationWindowSweepTick({
        sweep: {
          hasDueTransitions: async () => true,
          sweep: async () => {
            throw new Error('database went away');
          },
        },
        log,
      }),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
