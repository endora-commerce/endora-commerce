import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { commandLines, readJobs, type CiJob } from '../../helpers/ci-jobs.js';

/**
 * What a CI job has to be given before it runs this repository's code.
 *
 * Two jobs of pipeline 11475 were red for reasons no analysis in the tree could
 * see, and both were the same shape one layer out from the usual one: a job
 * whose *environment* did not supply something its *script* needs. Neither
 * defect is in any source file, so no check that reads sources could find it,
 * and the failure arrived as a Vite resolution error and twenty-two assertion
 * failures rather than as a sentence naming the missing thing.
 *
 * ## 1. A job that runs our code builds the packages first
 *
 * Since feature 080 (T042) the six packages under `packages/` resolve through
 * their own `exports` maps at `./dist`, and since the platform relocation
 * (!908) *all* of `backend/src/{kernel,http,tenancy,commands,events}` is
 * re-exported from one of them — 70 shims naming
 * `packages/platform/dist/<file>.js`. So an unbuilt workspace is no longer a
 * slightly stale import: it is a repository in which almost nothing resolves.
 *
 * `.gitlab-ci.yml` states that rule in its own header and names
 * `release:changeset` as the one exception, on the ground that the job "imports
 * no `@endora-commerce/*` package". That ground stopped being true when
 * `test:release-gate` was added to it, and nothing noticed, because the
 * exception was a sentence in a comment. This is the same statement as a
 * predicate over the file: whichever job runs a workspace script, the build
 * comes first.
 *
 * The population is derived from the file — every job whose `script` invokes a
 * workspace filter — so a job added tomorrow is covered without being listed
 * here, and an exception has to be argued in a diff rather than assumed.
 *
 * ## 2. `git` is a dependency of the backend unit suite, not a nicety
 *
 * `node:22.18-slim` ships no git. The suite spawns the changesets CLI, which
 * spawns git, and it spawns `check-naming.sh` and `check-language.sh`, whose
 * file list is `git ls-files` and which exit 2 rather than report a vacuous
 * green without it. Ten failures across two files said "expected 1 to be 0" and
 * none of them said "there is no git here".
 *
 * That half is not asserted from this file, deliberately: which jobs need git
 * is a property of *what the suite does*, and writing a job list here would be
 * a derived fact copied into a second place (D-100). The suite proves its own
 * requirement instead — see `toolchain.test.ts` beside this file — so any job
 * that runs it gets the answer, and a job that does not run it is not made to
 * install something it has no use for.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI_FILE = `${REPO_ROOT}.gitlab-ci.yml`;

/**
 * The job parser is `test/helpers/ci-jobs.ts`, shared with
 * `gate-coverage.test.ts` beside this file. It lived here until that second
 * reader existed; two parsers over one file would be one population derived
 * twice, which is the shape this estate spends its review effort refusing.
 */

/**
 * Does this text run a script belonging to a workspace in this repository?
 *
 * `pnpm --filter <member> …` and `pnpm -r …` both do, whatever comes after —
 * `run`, `exec tsx`, `exec vitest`. `pnpm exec <vendored-cli>` does not: that is
 * a dependency's binary, which is exactly why `release:changeset` could run
 * `changeset status` without a build for as long as that was all it ran.
 */
function runsWorkspaceCode(text: string): boolean {
  return /\bpnpm\s+(--filter\b|-r\b)/.test(text);
}

const JOBS = readJobs(readFileSync(CI_FILE, 'utf8'));

describe('the CI file gives every job what its script needs', () => {
  /**
   * The floor (issue #244). Everything below is "no job violates the rule",
   * which is also what an empty job list says, and what a parser that stopped
   * recognising `script:` says. Both would be a green measuring nothing.
   */
  it('parsed a population that looks like this pipeline', () => {
    const named = JOBS.map((job) => job.name);
    expect(named).toEqual(
      expect.arrayContaining(['quality', 'release:changeset', 'deploy', 'publish:docs']),
    );
    expect(JOBS.filter((job) => job.script !== '').length).toBeGreaterThanOrEqual(8);
    expect(JOBS.filter((job) => runsWorkspaceCode(job.script)).length).toBeGreaterThanOrEqual(6);
  });

  it('builds the workspace packages before running any workspace script', () => {
    const offenders = JOBS.filter(
      (job) =>
        runsWorkspaceCode(job.script) && !job.beforeScript.includes('pnpm run build:packages'),
    ).map((job) => job.name);

    expect(
      offenders,
      `${offenders.join(', ')}: runs a workspace script with no \`pnpm run build:packages\` in ` +
        'before_script. Every `@endora-commerce/*` package resolves through its built `./dist`, ' +
        'and since the platform relocation so does all of backend/src/{kernel,http,tenancy,' +
        'commands,events} — so the job fails on "Failed to load url ../../../packages/platform/' +
        'dist/…", deep inside whatever it was actually trying to measure.',
    ).toEqual([]);
  });

  /**
   * The rule is read off `before_script` and not off the job as a whole, which
   * is the difference between "the build runs" and "the build runs first". A
   * `build:packages` sitting in the `script` block below the command that needs
   * it satisfies a substring test over the job and changes nothing, so the
   * predicate above must keep the two sections apart. This is that property.
   */
  it('reads the two sections separately, so ordering is part of the rule', () => {
    const invented = readJobs(
      [
        'example:',
        '  before_script:',
        '    - echo one',
        '  script:',
        '    - pnpm --filter backend run x',
        '',
      ].join('\n'),
    );
    expect(invented).toHaveLength(1);
    expect(invented[0]?.beforeScript).toContain('echo one');
    expect(invented[0]?.beforeScript).not.toContain('pnpm --filter');
    expect(runsWorkspaceCode(invented[0]?.script ?? '')).toBe(true);
  });
});

/**
 * ## 3. A sharded suite job does not share the runner with a second instance
 *
 * Issue #199's second cause. `endora-commerce-runner-1` and `-2` are two
 * registrations on **one** machine — same `system ID`, same docker host in both
 * job logs — 4 vCPU and `MemTotal` 7 926 360 kB, and that machine also carries
 * another project's Magento test server. Measured on it, in the job's own image
 * with its own NODE_OPTIONS and services: one shard of `test:backend` holds
 * ~2.5 GB of anonymous memory, flat from its fortieth file to its last, and
 * completes alone with `oom_kill 0`; two of them collapse the host's
 * `MemAvailable` to under 500 MB and the **host's** OOM killer takes the larger
 * fork, which the container's `memory.events` records as `oom 0, oom_kill 1`.
 * Vitest reports that as `Worker exited unexpectedly` and two hundred files
 * silently do not run.
 *
 * `resource_group` is what stops the second instance starting. It is asserted
 * here rather than left to the comment above the job because it looks exactly
 * like a performance regression to anybody who has not read the measurement —
 * the five shards serialise, and the stage goes from ~75 to ~120 minutes — so
 * the first instinct on meeting it is to delete it. It is a fact about a
 * **shared** host, not about the suite: when the runner has a machine to itself
 * the concurrency should come back, and this assertion is the thing that has to
 * be retired deliberately for that to happen.
 *
 * The population is derived: any job that runs `vitest ... --shard`. A second
 * sharded suite added tomorrow is covered without being named here.
 */
function runsAShardedSuite(text: string): boolean {
  return /\bvitest\b[^\n]*--shard/.test(text);
}

describe('a sharded suite job keeps the runner to itself', () => {
  /** The floor: everything below is also what an empty population says. */
  it('found the sharded job', () => {
    expect(JOBS.filter((job) => runsAShardedSuite(job.script)).map((job) => job.name)).toContain(
      'test:backend',
    );
  });

  it('declares a resource_group, so two shards never share the one runner host', () => {
    const offenders = JOBS.filter(
      (job) => runsAShardedSuite(job.script) && !/^ {2}resource_group:/m.test(job.body),
    ).map((job) => job.name);

    expect(
      offenders,
      `${offenders.join(', ')}: runs a \`--shard\` suite with no \`resource_group\`. Two ` +
        'instances of this job on the one shared 7.9 GB runner host make the host OOM killer ' +
        "take a vitest fork — `memory.events` reports `oom 0, oom_kill 1` — and the run's " +
        'remaining files silently do not run (issue #199). One whole job costs 2.5 GB of ' +
        'anonymous memory. If the suite has been given a machine of its own, retire this ' +
        'assertion with the measurement in the Memory block above the job — do not delete it ' +
        'to make a pipeline faster.',
    ).toEqual([]);
  });

  /**
   * The predicate reads the job's own block, so a `resource_group` belonging to
   * the *next* job must not satisfy it. Without this the assertion above is a
   * substring test over the whole file wearing a per-job costume.
   */
  it('reads the resource_group from the job that runs the shard, not from a neighbour', () => {
    const invented = readJobs(
      [
        'sharded:',
        '  script:',
        '    - pnpm --filter backend exec vitest run --shard=$CI_NODE_INDEX/$CI_NODE_TOTAL',
        'other:',
        '  resource_group: something',
        '  script:',
        '    - echo two',
        '',
      ].join('\n'),
    );

    const sharded = invented.find((job) => job.name === 'sharded');
    expect(runsAShardedSuite(sharded?.script ?? '')).toBe(true);
    expect(/^ {2}resource_group:/m.test(sharded?.body ?? '')).toBe(false);
    expect(
      /^ {2}resource_group:/m.test(invented.find((job) => job.name === 'other')?.body ?? ''),
    ).toBe(true);
  });
});

describe('the CI file names the jobs the release gate is wired into', () => {
  /**
   * `release:changeset` is the one job with git and a target branch, so it is
   * where `check:release-intent --since` and `test:release-gate` run. Both now
   * import repository code, which is what made the missing build bite; this
   * pins the pair so a future move takes the build requirement with it rather
   * than leaving the job matching no rule.
   */
  it('runs both halves of the release gate in the same job', () => {
    const job = JOBS.find((candidate) => candidate.name === 'release:changeset');
    expect(job).toBeDefined();
    expect(job?.script).toContain('pnpm --filter backend run check:release-intent');
    expect(job?.script).toContain('pnpm --filter backend run test:release-gate');
  });
});

/**
 * ## 4. A job that transfers over ssh is given ssh, and rsync if it transfers
 *
 * `alpine:3.20` ships neither an ssh client nor rsync, and both deployment jobs
 * run on it. `deploy` has installed `openssh-client` in its `before_script`
 * since it was written; `publish:docs` (feature 133) needs rsync as well,
 * because the documentation site is transferred file by file into a fresh
 * release directory rather than pulled as an image.
 *
 * The failure this refuses is the file's own shape one tool over: a job whose
 * *environment* does not supply what its *script* needs, arriving as
 * `rsync: not found` in the middle of a deploy stage rather than as a sentence
 * naming the missing package. It is written as a rule over a derived
 * population — every job whose commands invoke the tool — rather than as a list
 * of two job names, so the next job that transfers something is covered by
 * having been added to the pipeline.
 */
interface TransferTool {
  /** The package an image is asked for. */
  readonly pkg: string;
  /** What using it looks like in a command line. */
  readonly used: RegExp;
}

const TRANSFER_TOOLS: readonly TransferTool[] = [
  { pkg: 'openssh-client', used: /(^|[\s;&|"'(])(ssh|scp|ssh-add|ssh-agent|ssh-keyscan)\b/ },
  { pkg: 'rsync', used: /(^|[\s;&|"'(])rsync\b/ },
];

/** An image is asked for a package by an install command, not by mentioning it. */
function installs(beforeScript: string, pkg: string): boolean {
  return new RegExp(`(apk add|apt-get install)[^\\n]*\\b${pkg}\\b`).test(beforeScript);
}

/** Which tools a job uses without having been given them. */
function missingTools(job: CiJob): readonly string[] {
  const commands = commandLines([job]).join('\n');
  return TRANSFER_TOOLS.filter(
    (tool) => tool.used.test(commands) && !installs(job.beforeScript, tool.pkg),
  ).map((tool) => tool.pkg);
}

describe('a job that ships files to the VPS is given the tools to ship them', () => {
  /** The floor: everything below is also what an empty population says. */
  it('found the jobs that transfer', () => {
    const transferring = JOBS.filter((job) =>
      TRANSFER_TOOLS.some((tool) => tool.used.test(commandLines([job]).join('\n'))),
    ).map((job) => job.name);

    expect(transferring).toEqual(expect.arrayContaining(['deploy', 'publish:docs']));
  });

  it('installs every transfer tool its commands use', () => {
    const offenders = JOBS.filter((job) => missingTools(job).length > 0).map(
      (job) => `${job.name} (${missingTools(job).join(', ')})`,
    );

    expect(
      offenders,
      `${offenders.join(', ')}: uses a transfer tool the job never installs. \`alpine:3.20\` ` +
        'ships neither an ssh client nor rsync, so this arrives as `not found` in the middle of ' +
        'the deploy stage — after the artefact has been downloaded and, for the documentation ' +
        'site, with the release directory half-made.',
    ).toEqual([]);
  });

  /**
   * The rule reads the install line rather than the job text, so a job that
   * merely names a package in a comment — or installs the other one — is still
   * an offender. Without this the assertion above is a substring test wearing a
   * toolchain costume.
   */
  it('is not satisfied by the other package, or by a mention', () => {
    const invented = readJobs(
      [
        'ships:',
        '  before_script:',
        '    - apk add --no-cache openssh-client',
        '  script:',
        '    # rsync would be needed here',
        '    - rsync -a build/ user@host:/srv/site/',
        '    - ssh user@host "true"',
        '',
      ].join('\n'),
    );

    expect(invented).toHaveLength(1);
    expect(missingTools(invented[0]!)).toEqual(['rsync']);
  });
});
