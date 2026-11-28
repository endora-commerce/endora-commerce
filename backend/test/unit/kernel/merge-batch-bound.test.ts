import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `specs/192-organization-merge/` — a participant's batch moves at most
 * `batchSize` rows, which `expectMergeParticipant` asserts. A batch written as
 * `… where "id" in (select … limit ? for update)` does not hold that bound: the
 * planner may run the locking subquery as the inner side of a join and rescan
 * it, or re-run it in a concurrent-update recheck, and each run skips the rows
 * the statement already changed and takes the next ones. Seen as "a batch moved
 * 3 rows when asked for at most 2" under a loaded run.
 *
 * `= any(array(select … limit ? for update))` is an InitPlan, evaluated once;
 * a standalone `select … for update` or a `with "picked" as (…)` is fine too.
 */
const MODULES = fileURLToPath(new URL('../../../../packages/modules/', import.meta.url));

function mergeCommands(): string[] {
  return readdirSync(MODULES).flatMap((moduleId) => {
    const dir = join(MODULES, moduleId, 'src/backend/commands');
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((file) => file.includes('merge') && file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .map((file) => join(dir, file));
  });
}

describe('merge batches', () => {
  it('never bound a write with an `in (select … limit ? for update)` subquery', () => {
    const commands = mergeCommands();
    expect(commands.length).toBeGreaterThan(15);
    const offenders = commands
      .filter((path) => /\bin \((?:`\s*\+\s*`)?\s*select\b[^;]*?\blimit \? for update\)/s.test(readFileSync(path, 'utf8')))
      .map((path) => relative(MODULES, path))
      .sort();
    expect(offenders).toEqual([]);
  });
});
