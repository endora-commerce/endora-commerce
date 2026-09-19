/**
 * Every suite whose log can cross 4 MB reports a failing test somewhere else.
 *
 * Two jobs are held here, because the defect happened twice. `test:backend` is
 * the original (pipeline 13573) and `test:frontend` is the same failure on the
 * other half of the estate (pipeline 14265, job 55801, sha `bb99c74a7`): a red
 * job whose trace ends in the log-limit notice, no junit report, and
 * `projects/267/pipelines/14265/test_report` answering `total: 0`. The
 * `test:frontend` trace was 5 509 606 bytes of which 89.7% was two repeated i18n
 * development warnings — that half is de-duplicated at its source and held by
 * `admin/test/kit/kit-i18n-diagnostic-volume.test.tsx`. This file holds the half
 * that does not depend on any suite staying quiet.
 *
 * ## The defect
 *
 * Scheduled pipeline 13573 failed on `test:backend 3/5` and nobody could say
 * why. The trace ends in `Job's log exceeded limit of 4194304 bytes. Job
 * execution will continue but no more output will be collected.`, and vitest
 * prints its failure summary **last**, so the summary was past the cut. The
 * job's artifacts were `['job.log']`, and the API had `script_failure` and
 * nothing else. Under D-198 no merge-request pipeline creates `test:backend` at
 * all, so the nightly is the only place the complete suite runs: a regression on
 * `master` is found by this job and by nothing else, and the one job that failed
 * was the one that could not be read.
 *
 * The junit reporter was already running — `JUNIT report written to
 * …/test-results.junit.xml` appears in every shard — and the file was being
 * thrown away with the container.
 *
 * ## What this file holds
 *
 * That the job uploads that report as a GitLab junit report, on failure as well
 * as on success, **at the path the suite actually writes**. The path is the
 * expensive half: it is not written down in one place, it is the composition of
 * two independent declarations — the workspace member the job's own script
 * names (`pnpm --filter backend exec vitest`, whose member directory is vitest's
 * root) and `outputFile.junit` in the repository's base vitest config. Either
 * one moving silently turns the artifact into "no matching files", which GitLab
 * reports as a warning on an already-failing job and nobody reads. So both are
 * derived here rather than compared against a literal.
 *
 * ## What it deliberately does not assert
 *
 * That the five shards write distinct filenames. They do not, and they do not
 * need to: `parallel: 5` is five jobs in five containers with five workspaces,
 * so there is no filesystem to collide on, and vitest's `--shard` partitions the
 * file list, so no two shards report the same test case either. An assertion
 * that each shard's path is unique would be an assertion about a collision that
 * cannot happen, which is worse than none.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../../scripts/lib/workspace-packages.js';
import { readJobs, type CiJob } from '../../helpers/ci-jobs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..');

const JOB = 'test:backend';
const FRONTEND_JOB = 'test:frontend';

/**
 * Absence is a failure with a sentence, never a substituted value.
 *
 * Every input below is one half of a derivation, so a missing one makes the
 * comparison vacuous rather than wrong — and a `?? ''` would compare two empty
 * strings and report a green. That is issue #113's shape, and it is also what
 * `check:fixture-substitution` refuses.
 */
function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

function job(name: string = JOB): CiJob {
  const source = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');

  return required(
    readJobs(source).find((candidate) => candidate.name === name),
    `.gitlab-ci.yml declares no \`${name}\` job, so this file asserts nothing. If the job was ` +
      'renamed, rename it here too — a suite whose log can cross 4 MB has to keep reporting ' +
      'its failures somewhere that limit cannot reach.',
  );
}

/** A job's own keys, with the comment lines dropped — they quote the very paths asserted here. */
function declaration(body: string): readonly string[] {
  return body.split('\n').filter((line) => !line.trim().startsWith('#'));
}

/** The `artifacts:` block of a job, as its own lines. */
function artifactsBlock(body: string): readonly string[] {
  const lines = declaration(body);
  const start = lines.findIndex((line) => /^ {2}artifacts:\s*$/.test(line));
  if (start === -1) return [];
  const block: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '') continue;
    if (!/^ {3}/.test(line)) break;
    block.push(line);
  }
  return block;
}

/**
 * Where the suite writes its junit report, relative to `$CI_PROJECT_DIR`.
 *
 * `outputFile` is resolved by vitest against its root, which for
 * `pnpm --filter <member> exec vitest` is that member's own directory.
 */
function reportPathTheSuiteWrites(target: CiJob): string {
  const filter = required(
    /pnpm\s+--filter\s+(\S+)\s+exec\s+vitest\b/.exec(target.script),
    `the \`${JOB}\` script no longer runs \`pnpm --filter <member> exec vitest\`, so the ` +
      'directory vitest treats as its root — and therefore where it writes the junit report ' +
      'this job uploads — cannot be derived from it.',
  );
  const memberName = required(filter[1], 'the --filter match captured no member name.');
  const member = required(
    workspaceMembers(REPO_ROOT, nodeWorkspaceFs()).find(
      (candidate) => candidate.name === memberName,
    ),
    `the \`${JOB}\` script filters on \`${memberName}\`, which is no workspace member.`,
  );

  return join(relative(REPO_ROOT, member.dir), declaredReportFilename());
}

/**
 * The junit path `outputFile` declares, relative to each vitest root.
 *
 * One declaration serves both jobs: `vitest.config.base.ts` is the file every
 * workspace member's configuration merges, so the filename is the same wherever
 * the run is rooted. Only the root differs.
 */
function declaredReportFilename(): string {
  const base = readFileSync(join(REPO_ROOT, 'vitest.config.base.ts'), 'utf8');
  const declared = required(
    /junit:\s*'([^']+)'/.exec(base),
    'vitest.config.base.ts declares no `outputFile` for the junit reporter, so there is no ' +
      'path for the artifact to name. A report nothing writes is an artifact that uploads ' +
      'nothing, and GitLab says so only as a warning on an already-failing job.',
  );
  return required(declared[1], 'the `outputFile` match captured no path.').replace(/^\.\//, '');
}

/**
 * Every path `test:frontend` writes a junit report to, relative to `$CI_PROJECT_DIR`.
 *
 * Unlike `test:backend`, this job's script is a **recursive** run —
 * `pnpm --filter '!backend' run test` — so vitest is rooted in each member that
 * has a `test` script, and there is one report per member rather than one for the
 * job. `admin` and `storefront` sit one directory deep, `packages/*` two and
 * `packages/modules/*` three, which is why the artifact has to be a glob and why
 * asserting a literal list of 71 paths would be a ledger nobody maintains.
 */
function reportPathsTheFrontendJobWrites(target: CiJob): readonly string[] {
  required(
    /pnpm\s+--filter\s+'!backend'\s+run\s+test\b/.exec(target.script),
    `the \`${FRONTEND_JOB}\` script no longer runs \`pnpm --filter '!backend' run test\`, so ` +
      'the set of members vitest is rooted in — and therefore where the junit reports it ' +
      'uploads are written — cannot be derived from it.',
  );

  const filename = declaredReportFilename();
  const paths = workspaceMembers(REPO_ROOT, nodeWorkspaceFs())
    .filter((member) => member.name !== 'backend')
    .filter((member) => {
      const scripts = member.manifest['scripts'];
      const test =
        typeof scripts === 'object' && scripts !== null
          ? (scripts as Record<string, unknown>)['test']
          : undefined;
      return typeof test === 'string' && /\bvitest\b/.test(test);
    })
    .map((member) => join(relative(REPO_ROOT, member.dir), filename));

  // A derivation that found nothing would make every assertion below vacuous
  // (issue #113): the glob would be compared against an empty population and
  // agree with anything, including a glob that matches nothing at all.
  if (paths.length === 0) {
    throw new Error(
      `no non-backend workspace member declares a \`test\` script running vitest, so \`${FRONTEND_JOB}\` ` +
        'writes no junit report and this assertion has no population. Either the script moved ' +
        'or the members stopped running vitest; both change what the job can report.',
    );
  }
  return paths;
}

/** A GitLab artifact path, as a matcher. `**` crosses directory separators; `*` does not. */
function globMatcher(glob: string): RegExp {
  const pattern = glob
    .split('**')
    .map((chunk) =>
      chunk
        .split('*')
        .map((literal) => literal.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${pattern}$`);
}

describe('a failing test in the complete backend suite outlives the job log', () => {
  it('uploads the junit report as a GitLab junit report', () => {
    const target = job();
    const block = artifactsBlock(target.body);

    expect(
      block.some((line) => /^ {4}reports:\s*$/.test(line)),
      `\`${JOB}\` declares no \`artifacts: reports:\`. Its log is the only record a scheduled ` +
        'run leaves, and GitLab stops collecting it at 4 MB — which is past where vitest ' +
        'prints the failure summary. Pipeline 13573 failed there and named no test.',
    ).toBe(true);

    const declared = required(
      block.find((line) => /^ {6}junit:/.test(line)),
      `\`${JOB}\` declares no junit report path.`,
    );

    expect(declared.split(':').slice(1).join(':').trim()).toBe(
      reportPathTheSuiteWrites(target),
    );
  });

  it('uploads it when the job fails, which is the only run that needs it', () => {
    const block = artifactsBlock(job().body);

    expect(
      block.some((line) => /^ {4}when:\s*always\s*$/.test(line)),
      `\`${JOB}\` does not declare \`artifacts: when: always\`. GitLab's default is ` +
        '`on_success`, so the report would be uploaded by every run except the one anybody ' +
        'needs it for.',
    ).toBe(true);
  });
});

describe('a failing test in the frontend suite outlives the job log', () => {
  it('uploads a junit report covering every member the job runs vitest in', () => {
    const target = job(FRONTEND_JOB);
    const block = artifactsBlock(target.body);

    expect(
      block.some((line) => /^ {4}reports:\s*$/.test(line)),
      `\`${FRONTEND_JOB}\` declares no \`artifacts: reports:\`. Its log is the only record it ` +
        'leaves, GitLab stops collecting it at 4 MB, and vitest prints the failure summary ' +
        'past that point. Pipeline 14265 failed there and named no test; the API answered ' +
        '`total: 0` because there was no report to answer with.',
    ).toBe(true);

    const declared = required(
      block.find((line) => /^ {6}junit:/.test(line)),
      `\`${FRONTEND_JOB}\` declares no junit report path.`,
    );
    const glob = declared
      .split(':')
      .slice(1)
      .join(':')
      .trim()
      .replace(/^['"]|['"]$/g, '');

    const matches = globMatcher(glob);
    const uncovered = reportPathsTheFrontendJobWrites(target).filter(
      (path) => !matches.test(path),
    );

    expect(
      uncovered,
      `\`${FRONTEND_JOB}\` uploads \`${glob}\`, which does not match every report the job ` +
        'writes. A member whose report is not covered fails without naming a test, which is ' +
        'the defect this exists to stop. Members left out: ' +
        `${uncovered.slice(0, 5).join(', ')}${uncovered.length > 5 ? ', …' : ''}`,
    ).toEqual([]);
  });

  it('uploads it when the job fails, which is the only run that needs it', () => {
    const block = artifactsBlock(job(FRONTEND_JOB).body);

    expect(
      block.some((line) => /^ {4}when:\s*always\s*$/.test(line)),
      `\`${FRONTEND_JOB}\` does not declare \`artifacts: when: always\`. GitLab's default is ` +
        '`on_success`, so the report would be uploaded by every run except the one anybody ' +
        'needs it for.',
    ).toBe(true);
  });
});
