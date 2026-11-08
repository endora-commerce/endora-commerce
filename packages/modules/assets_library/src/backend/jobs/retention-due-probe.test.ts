import { describe, expect, it, vi } from 'vitest';

import { ASSET_CLEANUP_GRACE_MS, cutoffFor, DAY_MS, type RetentionSweepDeps } from './retention-sweep-deps.js';
import { RetentionDueProbe } from './retention-due-probe.js';
import { previousVersionsDue, retentionDueRows } from './retention-due-rows.js';
import { createAssetRetentionSweeper } from './retention-sweeper.js';

/**
 * Issue #909 — the retention sweep's question, asked before a tick does any
 * work, is one `anyRowExists` over the four passes' own row sources.
 *
 * The probe and the passes are built from one statement of each predicate
 * (`retentionDueRows`), so a condition added to a pass is added to the
 * question by the same edit.
 */

const NOW = new Date('2031-06-15T12:00:00.000Z');
const RETENTION_DAYS = 10;

/** An EntityManager that records every statement and answers from `answer`. */
function recordingEm(answer: (sql: string) => unknown) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const em = {
    fork: () => em,
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return answer(sql);
    }),
    find: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    flush: vi.fn(async () => undefined),
  };
  return { em, calls };
}

function depsOn(em: unknown): RetentionSweepDeps {
  return {
    emFactory: () => em as never,
    adapters: { getForBackend: vi.fn() } as never,
    referenceRegistry: { findReferences: async () => [] },
    loadRetentionDays: vi.fn(async () => RETENTION_DAYS),
  };
}

describe('retentionDueRows (#909)', () => {
  it('one row source per pass, over the cutoff the setting gives and the cleanup grace', () => {
    const sources = retentionDueRows(NOW, RETENTION_DAYS);

    expect(sources).toHaveLength(4);
    for (const source of sources) expect(source.from.startsWith('from ')).toBe(true);
    const cutoff = cutoffFor(NOW, RETENTION_DAYS);
    expect(cutoff.getTime()).toBe(NOW.getTime() - RETENTION_DAYS * DAY_MS);
    expect(sources.flatMap((source) => [...source.params])).toEqual([
      cutoff,
      cutoff,
      new Date(NOW.getTime() - ASSET_CLEANUP_GRACE_MS),
    ]);
  });
});

describe('previousVersionsDue — only the rows pass 1 can purge (#914)', () => {
  it('leaves out legacy rows and rows with no previous locator, which the pass never purges', () => {
    const { from } = previousVersionsDue(cutoffFor(NOW, RETENTION_DAYS));

    expect(from).toContain(`"storage_backend" <> 'legacy'`);
    expect(from).toContain(`"previous_storage_locator" <> ''`);
  });
});

describe('RetentionDueProbe.hasDue (#909)', () => {
  it('asks one exists(…) per pass in a single statement, and answers yes from the database', async () => {
    const { em, calls } = recordingEm(() => [{ has_work: true }]);
    const deps = depsOn(em);

    expect(await new RetentionDueProbe(deps).hasDue(NOW)).toBe(true);

    const sources = retentionDueRows(NOW, RETENTION_DAYS);
    expect(calls).toEqual([
      {
        sql: `select (${sources.map((source) => `exists(select 1 ${source.from})`).join(' or ')}) as "has_work"`,
        params: sources.flatMap((source) => [...source.params]),
      },
    ]);
    expect(deps.loadRetentionDays).toHaveBeenCalledTimes(1);
    // One bit, no ORM read: nothing reaches the identity map or a count.
    expect(em.find).not.toHaveBeenCalled();
    expect(em.count).not.toHaveBeenCalled();
  });

  it('answers no when the database says nothing is due', async () => {
    const { em } = recordingEm(() => [{ has_work: false }]);

    expect(await new RetentionDueProbe(depsOn(em)).hasDue(NOW)).toBe(false);
  });

  it('is the sweeper`s hasDue', async () => {
    const { em, calls } = recordingEm(() => [{ has_work: true }]);

    expect(await createAssetRetentionSweeper(depsOn(em)).hasDue(NOW)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toMatch(/^select \(exists\(/u);
  });
});

describe('the sweep selects from the same row sources (#909)', () => {
  it('every pass lists through its row source, with that source`s parameters', async () => {
    const { em, calls } = recordingEm((sql) => (sql.startsWith('select count(') ? [{ count: 0 }] : []));

    await createAssetRetentionSweeper(depsOn(em)).sweep(NOW);

    const sources = retentionDueRows(NOW, RETENTION_DAYS);
    for (const source of sources) {
      const call = calls.find((c) => c.sql.includes(` ${source.from} `) || c.sql.endsWith(` ${source.from}`));
      expect(call, source.from).toBeDefined();
      expect(call!.params.slice(0, source.params.length)).toEqual([...source.params]);
    }
  });
});
