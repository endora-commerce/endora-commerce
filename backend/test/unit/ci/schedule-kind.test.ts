import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commandLines, readJobs } from '../../helpers/ci-jobs.js';

/**
 * `CI_SCHEDULE_KIND` is read in one place, and it can tell three states apart.
 *
 * ## The defect
 *
 * Two scheduled jobs branched on the variable, inline, and both wrote it the
 * same way:
 *
 *     if [ "$CI_SCHEDULE_KIND" = "weekly-heavy" ]; then …; fi
 *
 * One branch, three inputs. `weekly-heavy` takes it; **unset** and a **typo**
 * both fall through to the same silent else, and the cheaper branch then runs by
 * accident of the default rather than by decision. The schedule that produced
 * pipeline 13444 carries no variables at all, so the `weekly-heavy` branch had
 * never been reachable in either job — for as long as either had existed — and
 * nothing anywhere said so. A branch nobody can reach is indistinguishable,
 * from inside the repository, from one that is simply never taken.
 *
 * ## What is asserted here
 *
 * The resolver is spawned rather than reimplemented, in `boot-gate.test.ts`'
 * idiom: it is shell because its callers are shell, and a second copy of the
 * decision in TypeScript would be two answers to one question waiting to
 * disagree. One red proof per state it claims to separate, plus the two-way
 * reconciliation against the pipeline — every job that branches on the variable
 * goes through the resolver, and no job reads it raw.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const LIB = join(REPO_ROOT, 'scripts/lib/schedule-kind.sh');

interface Resolution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Sources the real library and resolves, exactly as both callers do. */
function resolve(env: Record<string, string>): Resolution {
  const result = spawnSync('bash', ['-c', `. "${LIB}"\nresolve_schedule_kind '[t]'`], {
    encoding: 'utf8',
    // A clean environment: the developer machine this runs on has neither
    // variable, but a CI job running the suite has `CI_PIPELINE_SOURCE`, and a
    // case that reads the ambient value asserts something different there.
    env: { PATH: process.env['PATH'] ?? '', ...env },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

describe('resolve_schedule_kind separates its three states', () => {
  it('a recognised kind is read off the variable, with nothing said', () => {
    for (const kind of ['nightly', 'weekly-heavy']) {
      const result = resolve({ CI_PIPELINE_SOURCE: 'schedule', CI_SCHEDULE_KIND: kind });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(kind);
      expect(result.stderr).toBe('');
    }
  });

  it('unset on a scheduled pipeline is a refusal, not a nightly', () => {
    const result = resolve({ CI_PIPELINE_SOURCE: 'schedule' });
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/CI_SCHEDULE_KIND is unset/);
    // It names the fix, which is a GitLab setting and not a file in this tree.
    expect(result.stderr).toMatch(/Schedules/);
    expect(result.stderr).toMatch(/nightly weekly-heavy/);
  });

  it('unset off a schedule is a nightly that says it is defaulting', () => {
    const result = resolve({ CI_PIPELINE_SOURCE: 'merge_request_event' });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('nightly');
    expect(result.stderr).toMatch(/is not a schedule; running as `nightly`/);
  });

  it('an unrecognised value is a refusal on any pipeline source', () => {
    for (const source of ['schedule', 'merge_request_event', 'push']) {
      const result = resolve({ CI_PIPELINE_SOURCE: source, CI_SCHEDULE_KIND: 'weekly-heavvy' });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(/weekly-heavvy/);
      expect(result.stderr).toMatch(/Recognised kinds: nightly weekly-heavy/);
    }
  });

  it('a typo and an unset variable are different answers', () => {
    // The whole point. Before this they were one silent else.
    const typo = resolve({ CI_PIPELINE_SOURCE: 'schedule', CI_SCHEDULE_KIND: 'nightlyy' });
    const unset = resolve({ CI_PIPELINE_SOURCE: 'schedule' });
    expect(typo.stderr).not.toEqual(unset.stderr);
  });
});

describe('the pipeline reads the variable through the resolver', () => {
  const source = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
  const jobs = readJobs(source);
  const lines = commandLines(jobs);

  it('the pipeline was parsed at all', () => {
    expect(jobs.length).toBeGreaterThan(10);
    expect(lines.length).toBeGreaterThan(50);
  });

  it('no job script reads CI_SCHEDULE_KIND itself', () => {
    // `rules:` may still test it — that decides whether a job exists, which the
    // resolver cannot do — but a *script* that reads it raw is a second reader
    // of the three states, and it is the one that was wrong.
    expect(lines.filter((line) => line.includes('CI_SCHEDULE_KIND'))).toEqual([]);
  });
});
