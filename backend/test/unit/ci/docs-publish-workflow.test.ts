import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { gateCommands, readWorkflowJobs, type WorkflowJob } from '../../helpers/actions-workflows.js';

/**
 * `.github/workflows/publish-docs.yml` publishes the documentation site from
 * `master`, after an approval, onto a host where a reader never sees half of a
 * build (129 T046b; the GitLab `publish:docs` job it ports is held by
 * `docs-publication.test.ts`, whose contract is
 * `specs/133-docs-site-publication/contracts/publication-pipeline.md`).
 *
 * ## Why it is held as tightly as `demo.yml`
 *
 * The deploy job holds an SSH key that can write the documentation root on the
 * shared host, in a public repository that accepts pull requests from forks.
 * Every property below is one way that key reaches code nobody reviewed, or one
 * way a run goes green while serving something other than the gated build:
 *
 *   * a pull-request, pull-request-target or workflow-run trigger runs, or can
 *     be steered by, a fork's code;
 *   * a job that reads a secret without naming the `docs` environment escapes
 *     its branch policy and required reviewer;
 *   * an action pinned by tag runs whatever the tag points at on the day;
 *   * the job that runs the repository's own build scripts is the job a
 *     malicious dependency runs in, so it must hold no secret at all;
 *   * a transfer straight into the served tree is a half-uploaded site for as
 *     long as the transfer takes.
 *
 * Read with the same fixed-shape reader as `demo-workflow.test.ts`, for the same
 * reason (Constitution IV): no YAML library, and a floor that fails over a file
 * the reader understood as empty.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/publish-docs.yml');
const WORKFLOW = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';
const BUILD_CHECK_PATH = join(REPO_ROOT, '.github/workflows/build-docs.yml');
const BUILD_CHECK = existsSync(BUILD_CHECK_PATH) ? readFileSync(BUILD_CHECK_PATH, 'utf8') : '';
const HOST_SCRIPT = readFileSync(join(REPO_ROOT, 'deploy/publish-docs.sh'), 'utf8');

/** The file without its comment lines: the header names what it refuses. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

const CONFIGURATION = withoutComments(WORKFLOW);
const JOBS = readWorkflowJobs(WORKFLOW);

/** One top-level block's lines (`on:`, `permissions:`, …), comments dropped. */
function topLevelBlock(source: string, key: string): readonly string[] {
  const lines = withoutComments(source).split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return [];
  const block = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    if (line.trim() !== '') block.push(line);
  }
  return block;
}

/** A trigger's `paths:` list under `on.<trigger>`, quotes dropped, in order. */
function triggerPaths(source: string, trigger: string): readonly string[] {
  const on = topLevelBlock(source, 'on').join('\n');
  const block = new RegExp(`^ {2}${trigger}:\\s*\\n((?: {4}.*\\n?)*)`, 'm').exec(on)?.[1] ?? '';
  const paths = /^ {4}paths:\s*\n((?: {6}.*\n?)*)/m.exec(block)?.[1] ?? '';
  return paths
    .split('\n')
    .map((line) => /^ {6}- '?([^']+?)'?\s*$/.exec(line)?.[1])
    .filter((entry): entry is string => entry !== undefined);
}

/** A job's steps, each as its own text, comment lines dropped. */
function stepsOf(job: WorkflowJob): readonly string[] {
  const steps: string[][] = [];
  let inSteps = false;
  for (const line of job.body.split('\n')) {
    if (/^ {4}steps:\s*$/.test(line)) {
      inSteps = true;
      continue;
    }
    if (!inSteps || line.trim() === '' || line.trim().startsWith('#')) continue;
    if (/^ {6}- /.test(line)) steps.push([line]);
    else if (/^ {8}/.test(line) && steps.length > 0) steps[steps.length - 1]!.push(line);
    else inSteps = false;
  }
  return steps.map((step) => step.join('\n'));
}

function configurationOf(job: WorkflowJob): string {
  return withoutComments(job.body);
}

function namesDocsEnvironment(job: WorkflowJob): boolean {
  const body = configurationOf(job);
  return (
    /^ {4}environment:\s*docs\s*$/m.test(body) ||
    /^ {4}environment:\s*\n {6}name:\s*docs\s*$/m.test(body)
  );
}

const BUILD = JOBS.find((job) => job.runLines.includes('pnpm --filter docs run build'));
const DEPLOY = JOBS.find((job) => job.runLines.some((line) => line.includes('publish-docs.sh')));

describe('the publication workflow exists and reads as a build and a deploy', () => {
  /** The floor (issue #244): every rule below is vacuous over an empty parse. */
  it('parses two jobs: one builds, the other ships', () => {
    expect(WORKFLOW, '.github/workflows/publish-docs.yml does not exist').not.toBe('');
    expect(BUILD_CHECK, '.github/workflows/build-docs.yml does not exist').not.toBe('');
    expect(JOBS.map((job) => job.id)).toHaveLength(2);
    expect(BUILD, 'no job runs the docs build').toBeDefined();
    expect(DEPLOY, 'no job runs deploy/publish-docs.sh on the host').toBeDefined();
    expect(BUILD).not.toBe(DEPLOY);
  });
});

describe('when it runs', () => {
  it('is triggered by a push to master and by a dispatch, and by nothing else', () => {
    const block = topLevelBlock(WORKFLOW, 'on');
    const triggers = block.flatMap((line) => /^ {2}([a-z_]+):/.exec(line)?.[1] ?? []);
    expect(triggers).toEqual(['push', 'workflow_dispatch']);
    expect(block.join('\n')).toMatch(/^ {2}push:\s*\n {4}branches:\s*\[master\]\s*$/m);
  });

  it('names no pull-request, pull-request-target or workflow-run trigger anywhere', () => {
    for (const trigger of ['pull_request', 'pull_request_target', 'workflow_run']) {
      expect(CONFIGURATION, `\`${trigger}\` runs, or can be steered by, a fork's code`).not.toContain(
        trigger,
      );
    }
  });

  it('publishes on exactly the inputs the PR-time build check judges', () => {
    // The build check's own file is the one entry that differs: each workflow
    // lists itself, as GitLab's `.docs-rules` listed `.gitlab-ci.yml`.
    const check = triggerPaths(BUILD_CHECK, 'pull_request');
    expect(check.length, 'build-docs.yml has no pull_request paths to compare').toBeGreaterThan(0);
    expect(check).toContain('specs/133-docs-site-publication/url-inventory.txt');
    const expected = check.map((entry) =>
      entry === '.github/workflows/build-docs.yml' ? '.github/workflows/publish-docs.yml' : entry,
    );
    expect(
      triggerPaths(WORKFLOW, 'push'),
      'an input the build check judges but whose change does not publish leaves the live site ' +
        'behind master; one that publishes but is never judged ships unverified.',
    ).toEqual(expected);
  });

  it('runs every job only on master, whatever ref a dispatch names', () => {
    for (const job of JOBS) {
      expect(configurationOf(job), `${job.id} can run from an unmerged branch`).toMatch(
        /^ {4}if:\s*github\.ref == 'refs\/heads\/master'\s*$/m,
      );
    }
  });

  it('never cancels a publication in flight', () => {
    const concurrency = topLevelBlock(WORKFLOW, 'concurrency').join('\n');
    expect(concurrency).toMatch(/^ {2}group:\s*\S+/m);
    expect(concurrency).toMatch(/^ {2}cancel-in-progress:\s*false\s*$/m);
    expect(CONFIGURATION).not.toMatch(/cancel-in-progress:\s*true/);
  });
});

describe('the build job', () => {
  it('runs exactly what the PR-time build check runs', () => {
    const check = gateCommands(readWorkflowJobs(BUILD_CHECK).flatMap((job) => job.runLines).join('\n'));
    expect(check.length, 'build-docs.yml runs nothing').toBeGreaterThan(0);
    expect(check).toContain('pnpm --filter backend run verify:docs-build');
    expect(
      gateCommands(BUILD!.runLines.join('\n')),
      'the published build must pass the same gate the pull request was judged by',
    ).toEqual([...check]);
  });

  it('hands the verified tree to the deploy job instead of letting it rebuild', () => {
    const upload = stepsOf(BUILD!).find((step) => step.includes('actions/upload-artifact@'));
    expect(upload, 'the build job uploads no artefact').toBeDefined();
    expect(upload).toMatch(/^ {10}path:\s*docs\/build\/?\s*$/m);
    expect(upload).toMatch(/^ {10}if-no-files-found:\s*error\s*$/m);
    const download = stepsOf(DEPLOY!).find((step) => step.includes('actions/download-artifact@'));
    expect(download, 'the deploy job downloads no artefact').toBeDefined();
    expect(DEPLOY!.runLines.join('\n')).not.toMatch(/\bpnpm\b/);
    expect(configurationOf(DEPLOY!)).toMatch(new RegExp(`^ {4}needs:\\s*(?:\\[\\s*)?${BUILD!.id}(?:\\s*\\])?\\s*$`, 'm'));
  });

  it('reads no secret and stays out of the environment', () => {
    expect(configurationOf(BUILD!)).not.toContain('secrets.');
    expect(namesDocsEnvironment(BUILD!)).toBe(false);
  });
});

describe('the deploy credential reaches only the approved deploy job', () => {
  it('grants nothing at the top, and each job only reads the repository', () => {
    expect(CONFIGURATION).toMatch(/^permissions:\s*\{\}\s*$/m);
    for (const job of JOBS) {
      expect(configurationOf(job), `${job.id} has no permissions block of its own`).toMatch(
        /^ {4}permissions:\s*\n {6}contents:\s*read\s*$/m,
      );
    }
    expect(CONFIGURATION, 'a documentation publication writes nothing on GitHub').not.toMatch(
      /:\s*write\b/,
    );
  });

  it('puts the deploy job in the `docs` environment, and every secret reader with it', () => {
    expect(namesDocsEnvironment(DEPLOY!), 'the deploy job names no `docs` environment').toBe(true);
    expect(CONFIGURATION, 'the `demo` environment is another deployment\'s approval').not.toMatch(
      /environment:[\s\S]{0,40}\bdemo\b/,
    );
    const readers = JOBS.filter((job) => configurationOf(job).includes('secrets.'));
    expect(readers.map((job) => job.id)).toEqual([DEPLOY!.id]);
    expect(CONFIGURATION.split(/^jobs:\s*$/m)[0]!).not.toContain('secrets.');
  });

  it('reads every coordinate and the key from an environment secret', () => {
    for (const name of ['SSH_PRIVATE_KEY', 'SSH_KNOWN_HOSTS', 'DEPLOY_HOST', 'DEPLOY_USER', 'DOCS_DEPLOY_PATH']) {
      expect(configurationOf(DEPLOY!)).toMatch(
        new RegExp(`^\\s+${name}:\\s*\\$\\{\\{ secrets\\.${name} \\}\\}\\s*$`, 'm'),
      );
    }
  });

  it('pins every action to a full commit SHA, with its version written above it', () => {
    const uses = JOBS.flatMap((job) => job.uses);
    expect(uses.length, 'the reader found no `uses:`').toBeGreaterThan(0);
    expect(uses.filter((action) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(action))).toEqual([]);
    const lines = WORKFLOW.split('\n');
    lines.forEach((line, index) => {
      const action = /^\s*- uses:\s*([\w.-]+\/[\w.-]+)@/.exec(line)?.[1];
      if (action === undefined) return;
      expect(lines[index - 1]!.trim(), `no version comment above ${line.trim()}`).toMatch(
        new RegExp(`^# ${action.replace('/', '\\/')} v\\d+(?:\\.\\d+)*$`),
      );
    });
  });

  it('interpolates no secret, input or event field into a shell line', () => {
    for (const job of JOBS) {
      for (const line of job.runLines) {
        expect(line, `${job.id}: ${line}`).not.toMatch(/\$\{\{\s*(inputs|secrets|vars|github\.event)\./);
      }
    }
  });

  it('trusts only the host key it was given', () => {
    expect(CONFIGURATION).not.toMatch(/StrictHostKeyChecking[= ]+no/i);
    expect(DEPLOY!.runLines.join('\n')).toMatch(/StrictHostKeyChecking[= ]+yes/);
  });

  it('forgets the key whatever happened, as its last step', () => {
    const steps = stepsOf(DEPLOY!);
    const last = steps[steps.length - 1]!;
    expect(last).toMatch(/^ {8}if:\s*always\(\)\s*$/m);
    expect(last).toMatch(/run:\s*rm -rf ~\/\.ssh\s*$/m);
  });
});

describe('a reader never sees half of a build (FR-024)', () => {
  const script = (): string => DEPLOY!.runLines.join('\n');

  it('refuses to start when a coordinate is missing', () => {
    // `mkdir -p "$DOCS_DEPLOY_PATH/releases"` with an empty path is `/releases`.
    const steps = stepsOf(DEPLOY!);
    const guard = steps.findIndex((step) => step.includes('exit 1') && step.includes('DOCS_DEPLOY_PATH'));
    const firstSsh = steps.findIndex((step) => /\b(ssh|scp|rsync) /.test(step) && !step.includes('cat >'));
    expect(guard, 'no step refuses an empty coordinate').toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstSsh);
  });

  it('uploads into a fresh release directory beside the live one, never into it', () => {
    const rsync = DEPLOY!.runLines.filter((line) => line.startsWith('rsync '));
    expect(rsync).toHaveLength(1);
    expect(rsync[0]).toContain('--delete');
    // Relative to the destination, `releases/<sha>/`, so two levels up.
    expect(rsync[0]).toContain('--link-dest=../../current');
    expect(rsync[0]).toMatch(/docs\/build\/ "[^"]*\$DOCS_DEPLOY_PATH\/releases\/\$RELEASE\/"$/);
    expect(script()).not.toMatch(/\$DOCS_DEPLOY_PATH\/current\b/);
  });

  it('swaps by one rename on the host, after the upload, and keeps earlier releases', () => {
    const lines = DEPLOY!.runLines;
    const upload = lines.findIndex((line) => line.startsWith('rsync '));
    const flip = lines.findIndex((line) => line.includes('publish-docs.sh') && line.startsWith('ssh '));
    expect(flip, 'the host script is never run').toBeGreaterThan(upload);
    for (const input of ['DOCS_DEPLOY_PATH', 'CI_COMMIT_SHA', 'CI_COMMIT_TIMESTAMP']) {
      expect(lines[flip], `the host script needs ${input}`).toContain(`${input}=`);
    }
    // The host script is shipped from this tree, so the swap is the one the
    // tree holds: a symlink renamed over `current`, one `rename(2)`.
    expect(script()).toContain('scp deploy/publish-docs.sh ');
    expect(HOST_SCRIPT).toContain('mv -Tf current.tmp current');
    expect(HOST_SCRIPT).toMatch(/^RELEASES_KEPT=([2-9]|\d{2,})$/m);
  });
});

describe('the file names no host, path or key — it is public', () => {
  it('contains no hostname, IP address or private key, comments included', () => {
    const names = [...WORKFLOW.matchAll(/\b(?:[a-z0-9-]+\.)+(?:software|com|pl|net|org|dev|app|io|eu)\b/gi)]
      .map((match) => match[0]);
    expect(names).toEqual([]);
    expect(WORKFLOW).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(WORKFLOW).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });

  it('names no absolute host path', () => {
    expect(CONFIGURATION).not.toMatch(/(?:^|[\s'"=:])\/(?:var|srv|opt|home|etc|usr|root)\//m);
  });
});
