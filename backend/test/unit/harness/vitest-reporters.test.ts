/**
 * A shard's log prints each line once, and still says which files never ran.
 *
 * ## The defect
 *
 * Vite's `mergeConfig` concatenates arrays. That is the right algebra for
 * `include`, `exclude` and `setupFiles` — every contributor adds to a list —
 * and the wrong one for `reporters`, which is a set of listeners rather than a
 * list of items: a name appearing twice is a second listener printing every
 * line a second time. `vitest.config.base.ts` contributes `['default', 'junit']`
 * under CI and `backendTestOptions()` contributes `['default', <completeness>]`,
 * so what a CI shard actually ran was
 * `['default', 'junit', 'default', <completeness>]`.
 *
 * The cost is not cosmetic. GitLab stops collecting a job's output at 4 MB and
 * vitest prints its failure summary **last**, so a doubled log that crosses the
 * limit takes the summary with it. Shard 2 of pipeline 11478 and shard 3 of
 * 13573 both ended in `Job's log exceeded limit of 4194304 bytes` and named no
 * failing test; under D-198 no merge-request pipeline creates `test:backend` at
 * all, so the nightly is the only place the complete suite runs and that log is
 * the only record it leaves.
 *
 * ## Why the completeness reporter is asserted separately
 *
 * Because it is the one thing a junit report cannot reconstruct. Issue #199's
 * "this run was given N files and reported a result for M" is a statement about
 * files that produced **no** test case, and a report of test cases has nothing
 * to say about them. A repair that deduplicated reporters by collapsing the
 * whole list, or that dropped the backend's own entry along with the repeated
 * `default`, would have taken the sentence that made last night's `perf:backend`
 * diagnosable with it — so the union is over reporter *names* only, and an
 * instance is never collapsed.
 *
 * ## Why the third case reads source text rather than importing the configs
 *
 * `vitest.unit.config.ts` and `vitest.release.config.ts` set
 * `process.env.BACKEND_TEST_SERVICES` at module scope — that assignment *is*
 * their declaration that the run has no services. Importing either of them from
 * inside a running suite would perform it, which is a side effect on the run
 * doing the asserting. So the population is derived from the directory (every
 * `vitest*.config.ts` under the backend that imports `backendTestOptions`) and
 * each member is read as text.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { RunCompletenessReporter } from '../../run-completeness.js';
import { backendTestOptions, mergeBackendConfig, unionReporters } from '../../../vitest.shared.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');

/** What `vitest.config.base.ts` contributes on a CI run, as the backend receives it. */
const BASE_CI_REPORTERS = ['default', 'junit'];

function mergedReporters(): readonly unknown[] {
  const merged = mergeBackendConfig(
    { test: { reporters: [...BASE_CI_REPORTERS] } },
    { test: { ...backendTestOptions() } },
  );
  const reporters = merged.test?.reporters;
  expect(Array.isArray(reporters), 'the merged config carries no reporter array').toBe(true);
  return reporters as readonly unknown[];
}

/** Every backend vitest config that composes `backendTestOptions()`. */
function configsUsingBackendOptions(): ReadonlyMap<string, string> {
  const found = new Map<string, string>();
  for (const entry of readdirSync(BACKEND_ROOT)) {
    if (!entry.startsWith('vitest') || !entry.endsWith('.config.ts')) continue;
    const source = readFileSync(join(BACKEND_ROOT, entry), 'utf8');
    if (source.includes('backendTestOptions')) found.set(entry, source);
  }
  return found;
}

describe('the base and the backend compose reporters as a union', () => {
  it('prints the run once: `default` appears exactly once after the merge', () => {
    const defaults = mergedReporters().filter((entry) => entry === 'default');

    expect(
      defaults.length,
      'the merged reporter list names `default` more than once, so every line of a shard ' +
        "log is printed once per copy. `mergeConfig` concatenates; use `mergeBackendConfig` " +
        'in backend/vitest.shared.ts, which composes the two lists as a union.',
    ).toBe(1);
  });

  it('keeps the junit reporter the base contributes', () => {
    expect(
      mergedReporters().includes('junit'),
      'the union dropped `junit`, which is the report `test:backend` uploads as its ' +
        'artifact — the half of the diagnostic that survives a truncated log.',
    ).toBe(true);
  });

  it('keeps the completeness reporter, which no junit report can replace', () => {
    const instances = mergedReporters().filter(
      (entry) => entry instanceof RunCompletenessReporter,
    );

    expect(
      instances.length,
      'the merged reporter list carries no RunCompletenessReporter. Issue #199 — "this run ' +
        'was given N files and reported a result for M" — is a statement about files that ' +
        'produced no test case, so a junit report cannot say it.',
    ).toBe(1);
  });
});

describe('the union is over reporter names, and nothing else', () => {
  it('collapses a repeated name and keeps the first position', () => {
    expect(unionReporters(['default', 'junit', 'default'])).toStrictEqual(['default', 'junit']);
  });

  it('never collapses two instances, which are distinct listeners', () => {
    const first = new RunCompletenessReporter();
    const second = new RunCompletenessReporter();

    expect(unionReporters([first, second])).toStrictEqual([first, second]);
  });

  it('leaves a single non-array value alone', () => {
    expect(unionReporters('default')).toBe('default');
  });
});

describe('every backend config that composes the shared options merges through the union', () => {
  it('finds the configs to judge at all', () => {
    expect(
      configsUsingBackendOptions().size,
      'no backend vitest config imports `backendTestOptions`, so this file asserts nothing. ' +
        'Either the configs moved or the population above stopped matching them.',
    ).toBeGreaterThan(0);
  });

  it('names `mergeBackendConfig` rather than the bare `mergeConfig`', () => {
    const offenders = [...configsUsingBackendOptions()]
      .filter(([, source]) => !source.includes('mergeBackendConfig('))
      .map(([name]) => name);

    expect(
      offenders,
      'these backend vitest configs compose the shared options with the bare `mergeConfig`, ' +
        'which concatenates reporter lists rather than uniting them — so their runs print ' +
        'every line twice. Use `mergeBackendConfig` from backend/vitest.shared.ts.',
    ).toStrictEqual([]);
  });
});
