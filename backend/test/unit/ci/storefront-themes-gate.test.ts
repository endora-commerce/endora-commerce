import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readWorkflowJobs, type WorkflowJob } from '../../helpers/actions-workflows.js';

/**
 * A pull request that breaks a theme fails a check before it merges (issue #109).
 *
 * `check:themes` judges the stylesheet `next build` emits — never the source —
 * so it runs as the last step of the storefront's own `build` script and can run
 * nowhere else. Until this file, the only workflow that built the storefront was
 * `demo.yml`, which runs on `master` pushes and on dispatch: a pull request that
 * broke a theme was found after it had merged.
 *
 * The question is asked of the tree rather than of a list. Which package script
 * carries `check:themes` is read off `storefront/package.json`, and the
 * assertion is that some job of some workflow triggered by `pull_request` runs
 * that script — so moving the check to a different script, or dropping it from
 * `build`, fails here rather than leaving a green job that stopped looking.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

const STOREFRONT_SCRIPTS = (
  JSON.parse(readFileSync(join(REPO_ROOT, 'storefront', 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }
).scripts;

/** The storefront scripts whose command runs `check:themes`, the script itself included. */
const THEMES_CARRIERS = Object.entries(STOREFRONT_SCRIPTS)
  .filter(([name, command]) => name === 'check:themes' || /\bcheck:themes\b/.test(command))
  .map(([name]) => name);

/** Is this workflow triggered by a pull request? Read off the `on:` block only. */
function triggersOnPullRequest(source: string): boolean {
  const on = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(source)?.[1] ?? '';
  return /^ {2}pull_request:/m.test(on);
}

/** A run line that runs one of the storefront's carrier scripts. */
function runsThemesCheck(line: string): boolean {
  return THEMES_CARRIERS.some((script) => {
    const escaped = script.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    return new RegExp(`\\bpnpm\\s+--filter\\s+'?storefront'?\\s+run\\s+${escaped}(\\s|$)`).test(line);
  });
}

const PULL_REQUEST_JOBS: ReadonlyArray<{ file: string; job: WorkflowJob }> = readdirSync(WORKFLOW_DIR)
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .sort()
  .flatMap((file) => {
    const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
    if (!triggersOnPullRequest(source)) return [];
    return readWorkflowJobs(source).map((job) => ({ file, job }));
  });

describe('check:themes runs on a pull request (issue #109)', () => {
  it('reads a storefront that still runs check:themes from its build', () => {
    // The floor: with no carrier the assertion below would be vacuous.
    expect(STOREFRONT_SCRIPTS['check:themes'], 'storefront declares no check:themes').toBeDefined();
    expect(THEMES_CARRIERS).toContain('build');
    expect(PULL_REQUEST_JOBS.length, 'no pull-request workflow job was read').toBeGreaterThan(0);
  });

  it('is run by a pull-request-triggered job, after the packages are built', () => {
    const running = PULL_REQUEST_JOBS.filter(({ job }) => job.runLines.some(runsThemesCheck));
    expect(
      running.map(({ file, job }) => `${file}#${job.name ?? job.id}`),
      'no workflow triggered by `pull_request` runs the storefront build, so a pull request ' +
        'that breaks a theme is found only after it merges (`demo.yml` runs on `master`)',
    ).not.toEqual([]);

    for (const { file, job } of running) {
      const first = job.runLines.findIndex(runsThemesCheck);
      const install = job.runLines.indexOf('pnpm install --frozen-lockfile');
      const build = job.runLines.indexOf('pnpm run build:packages');
      expect(install, `${file}#${job.id} builds the storefront with no install before it`).toBeGreaterThan(-1);
      expect(install).toBeLessThan(first);
      expect(build, `${file}#${job.id} builds the storefront over an unbuilt workspace`).toBeGreaterThan(-1);
      expect(build).toBeLessThan(first);
    }
  });

  it('runs on every pull request, never behind a paths filter', () => {
    // A job filtered away by `paths` reports no status at all, and a required
    // check that never reports blocks a pull request permanently — the reason
    // `quality.yml` ported no `changes:` ladder. A theme lives in a package as
    // well as in the storefront, so no short list of paths would be right.
    for (const { file } of PULL_REQUEST_JOBS.filter(({ job }) => job.runLines.some(runsThemesCheck))) {
      const source = readFileSync(join(WORKFLOW_DIR, file), 'utf8');
      const on = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(source)?.[1] ?? '';
      expect(on, `${file} filters its pull-request trigger by path`).not.toMatch(/paths(-ignore)?:/);
    }
  });
});
