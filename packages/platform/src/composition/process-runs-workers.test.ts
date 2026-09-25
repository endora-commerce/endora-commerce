import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { processRunsWorkersFor } from './process-runs-workers.js';

/**
 * `processRunsWorkers` — the one module-agnostic answer to "does this process
 * run queue consumers?" (`specs/134-paid-module-extraction/` T122, research
 * D16 §2(a), contract W1.1).
 *
 * The role table is Principle X's deployment dial as `compose-app.ts` states
 * it: unset or `all` co-locates the consumers, `worker` runs them alone, `api`
 * runs none. The second half holds the registration to the same computation
 * `composeApp` uses for its own worker decisions, so the published value cannot
 * drift from the `runWorkers` the platform acts on itself.
 */

describe('processRunsWorkers', () => {
  it.each([
    [undefined, true],
    ['all', true],
    ['worker', true],
    ['api', false],
  ])('answers %s with %s', (role, expected) => {
    expect(processRunsWorkersFor(role)).toBe(expected);
  });

  it('is what composeApp registers, from the same runWorkers it acts on', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./compose-app.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(
      /const runWorkers = processRunsWorkersFor\(process\.env\['BACKEND_ROLE'\]\);/,
    );
    expect(source).toMatch(/^\s*processRunsWorkers: runWorkers,$/m);
  });
});
