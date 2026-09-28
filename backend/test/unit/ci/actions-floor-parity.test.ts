import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gateCommands, readWorkflowJobs } from '../../helpers/actions-workflows.js';
import { readJobs } from '../../helpers/ci-jobs.js';

/**
 * The day-one Actions floor runs exactly what GitLab runs.
 *
 * `specs/129-github-canonical-migration/contracts/gate-window.md` §3.1 names
 * five jobs and says what their absence would cost: without `quality` the forty
 * checks that enforce Principles I, VI, VIII, XI, XII, XIII and XVII run
 * **nowhere** after the migration, because a historical GitLab repository
 * receives no pushes and therefore creates no pipelines (§2). The failure this
 * file exists to refuse is not a job that is missing — that is visible — but a
 * **line** that is missing from a job that is present, which is invisible: the
 * workflow is green, the check never runs, and nothing anywhere says so.
 *
 * ## Why this is a comparison rather than a list
 *
 * The obvious alternative is to write the ported command list here and assert
 * the workflow matches it. That is the derived fact D-100 forbids, twice over:
 * a third copy of a list that already exists in two places, and the copy a
 * reviewer would update to make a failing run pass. So nothing here enumerates
 * a command. `.gitlab-ci.yml` is the source, `.github/workflows/quality.yml` is
 * the port, and the assertion is that the two are the same set in the same
 * order.
 *
 * ## How a reader verifies the port, in one chain
 *
 *   * `check-inventory.test.ts` already holds every recorded check's `job`
 *     field against `.gitlab-ci.yml`'s `quality` and `quality:static` command
 *     blocks, **in both directions** — an inventory entry naming a job that
 *     does not run it fails, and so does a command no entry claims.
 *   * `gate-coverage.test.ts` already holds every repository script that some
 *     job runs to being run by some job, with no "not wired yet" verdict.
 *   * This file holds GitLab's five floor jobs equal to Actions' five.
 *
 * Compose them and "the port is complete" is a property of the tree rather than
 * of anybody's reading. Adding a check to `quality` on one host only fails
 * here, by name, in the merge request that did it.
 *
 * ## What the comparison is over
 *
 * `gateCommands` in `test/helpers/actions-workflows.ts`, applied to both hosts:
 * the lines that invoke this repository's own machinery, through `pnpm` or by
 * running a script in `scripts/`. Everything a host does to *supply* an
 * environment — `apt-get` for an image with no git, GitLab's `safe.directory`,
 * the pnpm store probe, the shell that resolves a base ref — differs by
 * construction and is not part of the question. There is deliberately no
 * per-host exception list: an exception list is the thing somebody extends to
 * make a divergence disappear.
 *
 * Two properties that are *not* command lines are asserted separately, because
 * dropping either would be silent: `release:changeset`'s two refusals, which
 * are what stop it reporting a pass measured against nothing, and the publish
 * workflow's fail-closed guards.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI_FILE = join(REPO_ROOT, '.gitlab-ci.yml');
const WORKFLOW_DIR = join(REPO_ROOT, '.github', 'workflows');

const CI_SOURCE = readFileSync(CI_FILE, 'utf8');
const GITLAB_JOBS = readJobs(CI_SOURCE);

const WORKFLOW_FILES = readdirSync(WORKFLOW_DIR)
  .filter((entry) => entry.endsWith('.yml') || entry.endsWith('.yaml'))
  .sort();

function workflowSource(file: string): string {
  return readFileSync(join(WORKFLOW_DIR, file), 'utf8');
}

const QUALITY_WORKFLOW = workflowSource('quality.yml');
const PUBLISH_WORKFLOW = workflowSource('publish.yml');
const ACCEPTANCE_PUBLIC_WORKFLOW = workflowSource('acceptance-public.yml');
const QUALITY_JOBS = readWorkflowJobs(QUALITY_WORKFLOW);
const PUBLISH_JOBS = readWorkflowJobs(PUBLISH_WORKFLOW);
const ACCEPTANCE_PUBLIC_JOBS = readWorkflowJobs(ACCEPTANCE_PUBLIC_WORKFLOW);

/** The five of window §3.1, named as both hosts name them. */
const FLOOR = [
  'quality',
  'quality:static',
  'test:backend:unit',
  'test:frontend',
  'release:changeset',
] as const;

function gitlabGateCommands(name: string): readonly string[] {
  const job = GITLAB_JOBS.find((candidate) => candidate.name === name);
  if (job === undefined) return [];
  return gateCommands(`${job.beforeScript}\n${job.script}`);
}

function actionsGateCommands(name: string): readonly string[] {
  const job = QUALITY_JOBS.find((candidate) => candidate.name === name);
  if (job === undefined) return [];
  return gateCommands(job.runLines.join('\n'));
}

describe('the floor parsed a population that looks like both hosts', () => {
  /**
   * The floor (issue #244). Every assertion below is "the two lists agree",
   * which is also what two empty lists say, and what a parser that stopped
   * recognising `run:` says. Both would be a green measuring nothing.
   */
  it('read three workflow files and the five floor jobs', () => {
    expect(WORKFLOW_FILES).toEqual(['acceptance-public.yml', 'publish.yml', 'quality.yml']);
    expect(QUALITY_JOBS.map((job) => job.name)).toEqual([...FLOOR]);
    expect(PUBLISH_JOBS.map((job) => job.name)).toEqual(['publish:packages']);
    expect(
      GITLAB_JOBS.map((job) => job.name),
      'the GitLab file no longer names all five floor jobs. Removing one is T045 work and it ' +
        'comes with `ci-jobs.ts` gaining a second source (window §4.6) — not with deleting a row ' +
        'from this test.',
    ).toEqual(expect.arrayContaining([...FLOOR]));
  });

  it('read a `quality` block that is the whole check estate', () => {
    expect(
      actionsGateCommands('quality').length,
      'the ported `quality` block is too short to be the check estate, so the parser or the ' +
        'workflow has lost most of it',
    ).toBeGreaterThanOrEqual(40);
  });
});

describe('every floor job runs exactly what its GitLab twin runs', () => {
  for (const name of FLOOR) {
    it(`holds for \`${name}\``, () => {
      const gitlab = gitlabGateCommands(name);
      const actions = actionsGateCommands(name);
      expect(gitlab.length, `\`${name}\` runs nothing on GitLab, so this compared nothing`).
        toBeGreaterThan(0);
      expect(
        actions,
        `\`${name}\` differs between \`.gitlab-ci.yml\` and \`.github/workflows/quality.yml\`. ` +
          'A command present on one host and absent on the other is a check that runs nowhere ' +
          'from migration day, because a historical GitLab repository creates no pipelines ' +
          '(gate-window §2). Add it to both, or remove it from both and give it a disposition.',
      ).toEqual([...gitlab]);
    });
  }
});

describe('the ported jobs are given what their scripts need', () => {
  /**
   * `toolchain-supply.test.ts`' rule, restated on the second host rather than
   * copied to it: it reads `.gitlab-ci.yml` and cannot see a workflow. The rule
   * is the same and the reason is the same — every `@endora-commerce/*`
   * specifier resolves through a built `./dist`, so an unbuilt workspace is a
   * repository in which almost nothing resolves.
   */
  const runsWorkspaceCode = (line: string): boolean => /\bpnpm\s+(--filter\b|-r\b)/.test(line);

  for (const job of [...QUALITY_JOBS, ...PUBLISH_JOBS]) {
    it(`holds for \`${job.name ?? job.id}\``, () => {
      const first = job.runLines.findIndex(runsWorkspaceCode);
      if (first === -1) return;
      const install = job.runLines.indexOf('pnpm install --frozen-lockfile');
      const build = job.runLines.indexOf('pnpm run build:packages');
      expect(
        install !== -1 && install < first,
        `\`${job.name ?? job.id}\` runs a workspace script with no earlier ` +
          '`pnpm install --frozen-lockfile`. It is also the first thing every job does today, ' +
          'and it is what fails on an unrendered package manifest.',
      ).toBe(true);
      expect(
        build !== -1 && build < first,
        `\`${job.name ?? job.id}\` runs a workspace script with no earlier ` +
          '`pnpm run build:packages`, so it would fail on "Failed to load url ' +
          '../../../packages/platform/dist/…", deep inside whatever it was trying to measure.',
      ).toBe(true);
    });
  }
});

describe('the workflows run on hosted runners, at the node version GitLab names', () => {
  it('names no self-hosted runner anywhere', () => {
    // Read off `runs-on:` rather than off the file text: the prose in these
    // files names the label in order to refuse it, and a substring test would
    // report the paragraph that states the rule as a breach of it — the same
    // trap `commandLines()` in `ci-jobs.ts` documents on the GitLab side.
    const offenders = WORKFLOW_FILES.flatMap((file) =>
      [...workflowSource(file).matchAll(/^\s*(?:- )?runs-on:\s*(.+)$/gm)]
        .filter((match) => match[1]!.includes('self-hosted'))
        .map((match) => `${file}: ${match[1]!.trim()}`),
    );
    expect(
      offenders,
      'a public repository that accepts pull requests must never run fork code on self-hosted ' +
        'infrastructure, and the box `.gitlab-ci.yml` describes carries another project\'s live ' +
        'server. If the heavy suites ever do move to a self-hosted runner, D-198\'s suspension is ' +
        're-earned and needs a ruling of its own (gate-window §6.4), not a label added here.',
    ).toEqual([]);
  });

  it('pins every node version to one `.gitlab-ci.yml` already names', () => {
    // Not a second statement of the engine floor: `node-engine-floor.test.ts`
    // already holds every `image:` tag in `.gitlab-ci.yml` at or above the root
    // manifest's floor, and that test reads only the GitLab file. Asserting the
    // workflows name a tag from that same set composes with it, so the floor
    // reaches the new host through the test that already owns it rather than
    // through a copy of its arithmetic here.
    const imageTags = new Set(
      [...CI_SOURCE.matchAll(/^\s*image:\s*node:(\d+(?:\.\d+)*)-[a-z]+\s*$/gm)].map(
        (match) => match[1]!,
      ),
    );
    expect(imageTags.size, '`.gitlab-ci.yml` declares no node image, so this read nothing').
      toBeGreaterThan(0);

    const declared = WORKFLOW_FILES.flatMap((file) =>
      [...workflowSource(file).matchAll(/^\s*node-version:\s*'?([\d.]+)'?\s*$/gm)].map(
        (match) => `${file}: ${match[1]!}`,
      ),
    );
    expect(declared.length, 'no workflow declares a node version, so this read nothing').
      toBeGreaterThan(0);
    const wrong = declared.filter((entry) => !imageTags.has(entry.split(': ')[1]!));
    expect(
      wrong,
      `these workflows name a node version no \`.gitlab-ci.yml\` image names (${[...imageTags].join(', ')}). ` +
        'A job below the engine floor cannot import an overlay module at all — the finding D-236 ' +
        'was written from — and the workflow file is now a second place that decides it.',
    ).toEqual([]);
  });

  it('declares an explicit permissions block on every job', () => {
    const missing = [...QUALITY_JOBS, ...PUBLISH_JOBS, ...ACCEPTANCE_PUBLIC_JOBS]
      .filter((job) => !/^\s{4}permissions:\s*$/m.test(job.body))
      .map((job) => job.name ?? job.id);
    expect(
      missing,
      'a job with no `permissions:` block inherits whatever the repository default is, which is ' +
        'a setting outside this tree. Least privilege has to be written down where the job is.',
    ).toEqual([]);
  });

  it('grants `id-token: write` to the publish job and to nothing else', () => {
    const granting = WORKFLOW_FILES.filter((file) => workflowSource(file).includes('id-token'));
    expect(
      granting,
      'provenance is the only reason anything here needs an OIDC token, and the publish job is ' +
        'the only job that produces provenance.',
    ).toEqual(['publish.yml']);
    expect(
      PUBLISH_JOBS[0]!.body,
      'the publish job must actually carry the permission its guards check for',
    ).toContain('id-token: write');
  });
});

describe('the refusals survive the port', () => {
  /**
   * These are shell, not commands, so the parity comparison above cannot see
   * them — and each is a place where a green would otherwise mean "did not
   * look", which is the one thing this estate refuses everywhere.
   */
  it('`release:changeset` still refuses an unresolvable base ref', () => {
    const job = QUALITY_JOBS.find((candidate) => candidate.name === 'release:changeset')!;
    const refusals = job.runLines.filter((line) =>
      line.includes('refusing to report a pass measured against nothing'),
    );
    expect(
      refusals.length,
      'the two guards — the base ref resolves, and it shares a merge base with HEAD — are what ' +
        'stop `changeset status` reporting a pass against a ref it could not find.',
    ).toBe(2);
    expect(job.runLines.filter((line) => line.trim() === 'exit 2').length).toBe(2);
  });

  it('`publish:packages` keeps all of its fail-closed guards', () => {
    // npm's unpublish policy makes a wrong first version permanent, so each of
    // these is the only thing between a misconfiguration and a version nobody
    // can take back. Three come from `publish:packages`; the OIDC and
    // provenance guards are this host's own, because only this host can fail
    // that way — silently, with a green job and no attestation.
    for (const guard of [
      'if [ -z "$ENDORA_NPM_REGISTRY" ]',
      'if [ -z "$ENDORA_NPM_TOKEN" ]',
      'if [ -z "$ACTIONS_ID_TOKEN_REQUEST_URL" ]',
      'npm config get provenance',
      'No unpublished projects to publish',
    ]) {
      expect(PUBLISH_WORKFLOW, `the publish workflow lost its guard: ${guard}`).toContain(guard);
    }
  });

  it('`publish:packages` still runs `check:release-intent` inline before publishing', () => {
    const lines = PUBLISH_JOBS[0]!.runLines;
    const gate = lines.indexOf('pnpm --filter backend run check:release-intent');
    // The command, not the word: three of this workflow's refusal messages
    // name `changeset publish` in prose, and two of them are above this line.
    const publish = lines.findIndex((line) => line.startsWith('pnpm exec changeset publish'));
    expect(
      gate,
      'the last gate before a publish. `quality` does not run on the dispatched ref unless it ' +
        'happens to be `master`, so without this the packages would be published having been ' +
        'judged only by the pull request that wrote them.',
    ).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });

  it('`publish:packages` refuses own licence terms on the public registry before publishing', () => {
    // `specs/136-open-source-publication/` FR-011: a `SEE LICENSE IN` package
    // belongs on the private registry, and this job publishes to whichever
    // registry its environment names — so the registry is handed to the check
    // rather than assumed, and the refusal sits before the publish.
    const lines = PUBLISH_JOBS[0]!.runLines;
    const refusal = lines.findIndex(
      (line) =>
        line.includes('scripts/check-release-intent.ts') &&
        line.includes('--publish-registry "$ENDORA_NPM_REGISTRY"'),
    );
    const publish = lines.findIndex((line) => line.startsWith('pnpm exec changeset publish'));
    expect(refusal, 'the publish job lost its own-licence refusal').toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(refusal);
  });

  it('is a deliberate act — the publish workflow is dispatched, never triggered by a push', () => {
    expect(PUBLISH_WORKFLOW).toContain('workflow_dispatch');
    expect(
      /^on:\s*\n\s+push:/m.test(PUBLISH_WORKFLOW),
      'D-160.5\'s property is that a publish is a deliberate act. GitLab spelled it ' +
        '`when: manual`; here it is `workflow_dispatch` plus a reviewed environment.',
    ).toBe(false);
    expect(PUBLISH_JOBS[0]!.body).toContain('environment: npm-publish');
  });
});

describe('the `public` acceptance mode runs on a stranger\'s machine, and only when dispatched', () => {
  /**
   * `specs/136-open-source-publication/` GAP-8, FR-070, plan W5.4. The mode's
   * whole subject is a machine with Node and Docker and nothing of ours — no
   * `.npmrc`, no credential, no workspace install — so each property below is
   * one way the workflow could stop being that machine while still going green.
   */
  const job = ACCEPTANCE_PUBLIC_JOBS[0]!;

  it('is one job, named for the mode', () => {
    expect(ACCEPTANCE_PUBLIC_JOBS.map((entry) => entry.name)).toEqual(['acceptance:instance:public']);
  });

  it('is dispatched and nothing else, until there is a published version to install', () => {
    // FR-071's nightly and per-release runs are plan W5.5, after `0.100.0`
    // exists on npmjs. Before that every trigger but a person's would fail on
    // a package that is not there.
    const triggers = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(ACCEPTANCE_PUBLIC_WORKFLOW)?.[1] ?? '';
    const keys = [...triggers.matchAll(/^ {2}([a-z_]+):/gm)].map((match) => match[1]);
    expect(keys).toEqual(['workflow_dispatch']);
  });

  it('carries no credential and writes no registry configuration', () => {
    // Over the configuration, not the prose: the header names each of these
    // in order to say the job does not use it — `commandLines()`' trap in
    // `ci-jobs.ts`, one host over.
    const configuration = ACCEPTANCE_PUBLIC_WORKFLOW.split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(configuration).not.toMatch(/\$\{\{\s*secrets\./);
    expect(configuration).not.toContain('registry-url');
    expect(configuration).not.toContain('.npmrc');
    expect(configuration).not.toContain('id-token');
    expect(job.body).toMatch(/persist-credentials:\s*false/);
  });

  it('installs nothing of this repository — no pnpm, no workspace install, no build', () => {
    for (const line of job.runLines) {
      expect(line, 'a runner that installed this workspace is not a stranger\'s machine').not.toMatch(
        /\bpnpm\b|corepack/,
      );
    }
    expect(job.uses.some((action) => action.startsWith('pnpm/'))).toBe(false);
  });

  it('runs the harness from outside the checkout, with the version the dispatcher chose', () => {
    expect(job.body).toContain('working-directory: ${{ runner.temp }}');
    const harness = job.runLines.find((line) => line.includes('instance-public.ts'));
    expect(harness, 'the job no longer runs the public-mode harness').toBeDefined();
    expect(harness).toContain('--version "$ENDORA_PUBLIC_VERSION"');
    // An input interpolated straight into a shell line is script injection;
    // it arrives through the environment instead.
    expect(job.runLines.join('\n')).not.toContain('${{ inputs.');
  });
});
