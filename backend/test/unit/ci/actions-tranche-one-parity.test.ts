import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gateCommands, readWorkflowJobs } from '../../helpers/actions-workflows.js';
import { readJobs } from '../../helpers/ci-jobs.js';

/**
 * Tranche 1 of the gate window runs on Actions exactly as it runs on GitLab.
 *
 * `specs/129-github-canonical-migration/contracts/gate-window.md` §4.2 names
 * three jobs — `pack-gate`, `boot-gate`, `build:docs` — and T042b ports them.
 * `pack-gate` is the one with a hard trigger: it must run before the first
 * npmjs publish (T052), because it is what stands between a tarball that packs
 * the wrong files and a version nobody can take back.
 *
 * `actions-floor-parity.test.ts` holds the day-one floor; this file holds the
 * tranche, with the same comparison and the same refusal to enumerate a
 * command. Two things are compared per job, because each is a way the port can
 * go green over something it no longer does:
 *
 *   * **what it runs** — `gateCommands` over both hosts, in order;
 *   * **when it runs** — GitLab's two rules (always on the default branch; on a
 *     merge request when a listed path changed) against the workflow's `push`
 *     and `pull_request` triggers. A path dropped from the `pull_request`
 *     filter is a pull request that changes the gate's subject and is not
 *     judged by it, which is invisible from a green run.
 *
 * The one deliberate difference in the path list: GitLab's names
 * `.gitlab-ci.yml`, because that is where the job is defined; on Actions the
 * job is defined in its own workflow file, so that file takes the entry's
 * place. `.gitlab-ci.yml` is not carried across — an edit to it changes nothing
 * a workflow runs.
 *
 * **`build:docs` is not ported yet, and is not listed below.** Its second
 * command, `verify:docs-build`, reads
 * `specs/133-docs-site-publication/url-inventory.txt`, which stayed behind the
 * D-247 cut line; on this tree it exits 2 (`inventory-absent`) on every run.
 * Where the inventory lives on the canonical tree is a decision, not a port.
 * The `!reference [.docs-rules, rules]` resolution in `gitlabRules` is kept
 * for it: whoever ports it adds one row to `TRANCHE`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI_SOURCE = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
const GITLAB_JOBS = readJobs(CI_SOURCE);

/** The tranche, as GitLab names each job and the workflow file that ports it. */
const TRANCHE = [
  { name: 'pack-gate', workflow: '.github/workflows/pack-gate.yml' },
  { name: 'boot-gate', workflow: '.github/workflows/boot-gate.yml' },
] as const;

function workflowSource(path: string): string {
  const absolute = join(REPO_ROOT, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
}

/** The text of one top-level block of `.gitlab-ci.yml`, hidden templates included. */
function gitlabBlock(key: string): string {
  const lines = CI_SOURCE.split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);
  if (start === -1) return '';
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line) && !line.startsWith('#')) break;
    body.push(line);
  }
  return body.join('\n');
}

/**
 * The job's `rules:`, following one `!reference [<template>, rules]` — the
 * shape `build:docs` uses to share `.docs-rules` with `publish:docs`.
 */
function gitlabRules(name: string): string {
  const block = gitlabBlock(name);
  const reference = /^ {2}rules:\s*!reference\s*\[\s*([.\w:-]+)\s*,\s*rules\s*\]\s*$/m.exec(block);
  // A leading newline so a template whose first key is `rules:` is found too.
  const source = `\n${reference === null ? block : gitlabBlock(reference[1]!)}`;
  const start = source.indexOf('\n  rules:');
  return start === -1 ? '' : source.slice(start);
}

/** The merge-request `changes:` list, comments dropped, in order. */
function gitlabChanges(name: string): readonly string[] {
  const rules = gitlabRules(name);
  const start = rules.indexOf('changes:');
  if (start === -1) return [];
  return rules
    .slice(start)
    .split('\n')
    .slice(1)
    .filter((line) => !line.trim().startsWith('#') && line.trim() !== '')
    .map((line) => /^\s{8}- (.+)$/.exec(line)?.[1]?.trim())
    .filter((entry): entry is string => entry !== undefined);
}

/** The `on:` block of a workflow, up to the next column-0 key. */
function triggers(source: string): string {
  return /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(source)?.[1] ?? '';
}

/** The `pull_request.paths` filter, quotes dropped, in order. */
function pullRequestPaths(source: string): readonly string[] {
  const block = /^ {2}pull_request:\s*\n((?: {4}.*\n|\s*\n)*)/m.exec(triggers(source))?.[1] ?? '';
  const paths = /^ {4}paths:\s*\n((?: {6}.*\n|\s*\n)*)/m.exec(block)?.[1] ?? '';
  return paths
    .split('\n')
    .map((line) => /^ {6}- '?([^']+?)'?\s*$/.exec(line)?.[1])
    .filter((entry): entry is string => entry !== undefined);
}

describe('tranche 1 exists on both hosts', () => {
  for (const { name, workflow } of TRANCHE) {
    it(`\`${name}\` is one job in \`${workflow}\`, named as GitLab names it`, () => {
      expect(
        GITLAB_JOBS.map((job) => job.name),
        `\`${name}\` is gone from \`.gitlab-ci.yml\`. Removing it is T045 work and comes with ` +
          '`ci-jobs.ts` gaining a second source (window §4.6), not with deleting a row here.',
      ).toContain(name);
      const source = workflowSource(workflow);
      expect(source, `${workflow} does not exist`).not.toBe('');
      expect(readWorkflowJobs(source).map((job) => job.name)).toEqual([name]);
    });
  }
});

describe('every tranche job runs exactly what its GitLab twin runs', () => {
  for (const { name, workflow } of TRANCHE) {
    it(`holds for \`${name}\``, () => {
      const gitlabJob = GITLAB_JOBS.find((job) => job.name === name);
      const gitlab = gitlabJob === undefined
        ? []
        : gateCommands(`${gitlabJob.beforeScript}\n${gitlabJob.script}`);
      const actions = gateCommands(
        readWorkflowJobs(workflowSource(workflow)).flatMap((job) => job.runLines).join('\n'),
      );
      expect(gitlab.length, `\`${name}\` runs nothing on GitLab, so this compared nothing`).
        toBeGreaterThan(0);
      expect(
        actions,
        `\`${name}\` differs between \`.gitlab-ci.yml\` and \`${workflow}\`. A command on one ` +
          'host only is a gate that runs nowhere once GitLab stops creating pipelines ' +
          '(gate-window §2). Change both, or neither.',
      ).toEqual([...gitlab]);
    });
  }
});

describe('every tranche job runs when its GitLab twin runs', () => {
  for (const { name, workflow } of TRANCHE) {
    it(`\`${name}\` runs on every push to master, unfiltered`, () => {
      // GitLab's first rule: `$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, with no
      // `changes:`. `pack-gate`'s run on `master` is the one T052 relies on.
      expect(gitlabRules(name)).toMatch(/- if: '\$CI_COMMIT_BRANCH == \$CI_DEFAULT_BRANCH'\s*\n/);
      const push = /^ {2}push:\s*\n((?: {4}.*\n|\s*\n)*)/m.exec(triggers(workflowSource(workflow)))?.[1];
      expect(push, `${workflow} has no push trigger`).toBeDefined();
      expect(push).toMatch(/^ {4}branches: \[master\]\s*$/m);
      expect(push, 'a `master` run filtered by path is not GitLab\'s first rule').not.toMatch(/paths/);
    });

    it(`\`${name}\` runs on a pull request touching exactly GitLab's \`changes:\` list`, () => {
      const gitlab = gitlabChanges(name);
      expect(gitlab.length, `\`${name}\` has no merge-request \`changes:\` list to compare`).
        toBeGreaterThan(0);
      const expected = gitlab.map((entry) => (entry === '.gitlab-ci.yml' ? workflow : entry));
      expect(
        pullRequestPaths(workflowSource(workflow)),
        `\`${workflow}\`'s pull_request paths differ from \`${name}\`'s \`changes:\`. A path on ` +
          'one host only is a pull request that changes what the gate judges and is not judged.',
      ).toEqual(expected);
    });
  }
});

describe('the tranche workflows hold the canonical host\'s supply-chain rules', () => {
  for (const { name, workflow } of TRANCHE) {
    const source = workflowSource(workflow);
    const jobs = readWorkflowJobs(source);

    it(`\`${name}\` pins every action to a full commit SHA`, () => {
      const uses = jobs.flatMap((job) => job.uses);
      expect(uses.length, `${workflow} names no action, so this read nothing`).toBeGreaterThan(0);
      expect(
        uses.filter((action) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(action)),
        'a tag is whatever its owner points it at on the day of the run',
      ).toEqual([]);
    });

    it(`\`${name}\` reads only, and reads no secret`, () => {
      const configuration = source
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
      expect(configuration).toMatch(/^permissions:\s*\n {2}contents: read\s*$/m);
      expect(configuration, 'none of the three gates writes anything').not.toMatch(/:\s*write\b/);
      expect(configuration, 'none of the three gates needs a credential').
        not.toMatch(/\$\{\{\s*secrets\./);
      for (const job of jobs) expect(job.body).toMatch(/persist-credentials:\s*false/);
    });
  }
});
