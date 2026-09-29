import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mustBeNonProduction } from '@endora-commerce/platform/demo';

import { readWorkflowJobs, type WorkflowJob } from '../../helpers/actions-workflows.js';

/**
 * `.github/workflows/demo.yml` builds and deploys the open-source demo, and no
 * code that has not been merged and approved can reach its deploy credential
 * (D-274 clause 1; `specs/136-open-source-publication/` FR-100, FR-102, FR-104,
 * FR-106, plan W7.5).
 *
 * ## Why this file is held so tightly
 *
 * It lives in a public repository that accepts pull requests from forks, and one
 * of its jobs holds an SSH key that is root-equivalent on the demo host (the
 * deploy user is in the `docker` group). Every property below is one way that key
 * could be handed to code nobody reviewed while the workflow still ran green:
 *
 *   * a `pull_request`, `pull_request_target` or `workflow_run` trigger runs, or
 *     can be steered by, a fork's code;
 *   * a job that reads a secret without naming the `demo` environment escapes
 *     the environment's branch policy and required reviewer — the approval that
 *     replaced GitLab's manual `deploy` click;
 *   * a third-party action pinned by tag runs whatever that tag points at on the
 *     day, including after a compromise of the action's repository;
 *   * a token that may write packages, granted to the job that holds the key,
 *     turns a leak of one into a leak of both.
 *
 * FR-104's half is the reseed: demo data is seeded only by an explicit act —
 * the dispatch input — never by the deploy a push starts, and the command the
 * step types is one the seed guard lets through, measured by running the guard.
 *
 * ## Why a reader and not a YAML library
 *
 * Constitution IV, as for `compose-prod.test.ts` and `actions-floor-parity.test.ts`:
 * the workflow is written to a fixed two-space shape, `readWorkflowJobs` reads
 * its jobs, and the floors below fail rather than pass over a file the reader
 * understood as empty.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WORKFLOW_PATH = join(REPO_ROOT, '.github/workflows/demo.yml');
const WORKFLOW = existsSync(WORKFLOW_PATH) ? readFileSync(WORKFLOW_PATH, 'utf8') : '';
const COMPOSE = readFileSync(join(REPO_ROOT, 'deploy/compose.prod.yml'), 'utf8');

/**
 * The file without its comments. The header names every refused trigger and
 * every hostname rule in order to state them — `commandLines()`' trap in
 * `ci-jobs.ts` — so the configuration is what the rules are asserted over.
 */
const CONFIGURATION = WORKFLOW.split('\n')
  .filter((line) => !line.trim().startsWith('#'))
  .join('\n');

const JOBS = readWorkflowJobs(WORKFLOW);

/** One top-level block's lines (`on:`, `permissions:`, …), comments dropped. */
function topLevelBlock(key: string): readonly string[] {
  const lines = CONFIGURATION.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return [];
  const block = [lines[start]!];
  for (const line of lines.slice(start + 1)) {
    if (line !== '' && !/^\s/.test(line)) break;
    if (line.trim() !== '') block.push(line);
  }
  return block;
}

/**
 * A job's steps, each as its own text without comment lines — split at the
 * six-space `- ` opener; a step's own keys sit at eight spaces or deeper.
 */
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

/** The job's configuration without comment lines. */
function configurationOf(job: WorkflowJob): string {
  return job.body
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

/** Whether a job names the `demo` environment, in either YAML spelling. */
function namesDemoEnvironment(job: WorkflowJob): boolean {
  const body = configurationOf(job);
  return (
    /^ {4}environment:\s*demo\s*$/m.test(body) ||
    /^ {4}environment:\s*\n {6}name:\s*demo\s*$/m.test(body)
  );
}

const BUILD = JOBS.find((job) => job.runLines.some((line) => line.startsWith('docker build')));
const DEPLOY = JOBS.find((job) => job.runLines.some((line) => line.includes('deploy/compose.prod.yml')));

describe('the demo workflow exists and reads as two jobs', () => {
  /** The floor (issue #244): every rule below is vacuous over an empty parse. */
  it('parses a build job and a deploy job', () => {
    expect(WORKFLOW, '.github/workflows/demo.yml does not exist').not.toBe('');
    expect(JOBS.length, 'the reader found no job in demo.yml').toBeGreaterThanOrEqual(2);
    expect(BUILD, 'no job runs `docker build`').toBeDefined();
    expect(DEPLOY, 'no job ships deploy/compose.prod.yml').toBeDefined();
    expect(BUILD).not.toBe(DEPLOY);
  });
});

describe('no fork and no unmerged code can reach the deploy credential (FR-102)', () => {
  it('is triggered by a push to master and by a dispatch, and by nothing else', () => {
    const block = topLevelBlock('on');
    expect(block.length, 'demo.yml declares no `on:` block').toBeGreaterThan(1);
    const triggers = block.flatMap((line) => /^ {2}([a-z_]+):/.exec(line)?.[1] ?? []);
    expect(triggers).toEqual(['push', 'workflow_dispatch']);
    const push = block.join('\n');
    expect(push).toMatch(/^ {2}push:\s*\n {4}branches:\s*\[master\]\s*$/m);
  });

  it('names no pull-request, pull-request-target or workflow-run trigger anywhere', () => {
    for (const trigger of ['pull_request', 'pull_request_target', 'workflow_run']) {
      expect(
        CONFIGURATION,
        `\`${trigger}\` runs, or can be steered by, code from a fork. D-274 clause 3 refuses it ` +
          'in any workflow whose job can see the deploy key.',
      ).not.toContain(trigger);
    }
  });

  it('grants nothing at the top, and each job widens only what it needs', () => {
    expect(CONFIGURATION).toMatch(/^permissions:\s*\{\}\s*$/m);
    const missing = JOBS.filter((job) => !/^ {4}permissions:\s*$/m.test(job.body)).map(
      (job) => job.id,
    );
    expect(missing, 'a job with no permissions block of its own').toEqual([]);
  });

  it('puts every job that reads a secret in the `demo` environment', () => {
    const readingSecrets = JOBS.filter((job) => configurationOf(job).includes('secrets.'));
    expect(
      readingSecrets.length,
      'no job reads a secret, so this rule would be vacuous — the deploy job reads five',
    ).toBeGreaterThan(0);
    const outside = readingSecrets.filter((job) => !namesDemoEnvironment(job)).map((job) => job.id);
    expect(
      outside,
      'a job reading `secrets.` without `environment: demo` escapes the branch policy and the ' +
        'required reviewer; the key then reaches any run of this workflow.',
    ).toEqual([]);
    // And the environment is not decoration: no secret is read at the workflow's
    // top level, where no job's environment applies to it.
    const outsideJobs = CONFIGURATION.split(/^jobs:\s*$/m)[0]!;
    expect(outsideJobs).not.toContain('secrets.');
  });

  it('runs every job only on master, whatever ref a dispatch names', () => {
    // The environment's branch policy says the same thing, but it is a setting
    // outside this tree (O-e); the condition here is what holds before anybody
    // has configured it.
    for (const job of JOBS) {
      expect(
        configurationOf(job),
        `${job.id} can run from a dispatched branch that was never merged`,
      ).toMatch(/^ {4}if:\s*github\.ref == 'refs\/heads\/master'\s*$/m);
    }
  });

  it('lets only the build job write packages', () => {
    const writing = JOBS.filter((job) => /^\s+packages:\s*write\s*$/m.test(configurationOf(job)));
    expect(writing.map((job) => job.id)).toEqual([BUILD!.id]);
    expect(topLevelBlock('permissions').join('\n')).not.toContain('packages');
  });

  it('keeps the build job out of the environment and away from every secret', () => {
    // It pushes with the run's own token, which is `github.token` — spelled that
    // way so the one job that can write packages reads no `secrets.` value at all.
    expect(configurationOf(BUILD!)).not.toContain('secrets.');
    expect(namesDemoEnvironment(BUILD!)).toBe(false);
  });

  it('pins every action to a full commit SHA', () => {
    const uses = JOBS.flatMap((job) => job.uses);
    expect(uses.length, 'the reader found no `uses:` — a pin rule over nothing').toBeGreaterThan(0);
    const unpinned = uses.filter((action) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(action));
    expect(
      unpinned,
      'a tag is whatever the action repository says it is on the day of the run; in a job ' +
        'beside a deploy key that is a supply-chain path to the key.',
    ).toEqual([]);
  });

  it('interpolates no input or secret into a shell line', () => {
    // An expression expanded into `run:` is script injection; values arrive
    // through `env:` and are read as shell variables.
    for (const job of JOBS) {
      for (const line of job.runLines) {
        expect(line, `${job.id}: ${line}`).not.toMatch(/\$\{\{\s*(inputs|secrets|vars|github\.event)\./);
      }
    }
  });
});

describe('the deploy (FR-100, FR-104, FR-106)', () => {
  it('waits for the build, and never cancels a deploy in flight', () => {
    const body = configurationOf(DEPLOY!);
    expect(body).toMatch(new RegExp(`^ {4}needs:\\s*(?:\\[\\s*)?${BUILD!.id}(?:\\s*\\])?\\s*$`, 'm'));
    expect(body).toMatch(/^ {4}concurrency:\s*\n {6}group:\s*\S+/m);
    expect(body).toMatch(/^ {6}cancel-in-progress:\s*false\s*$/m);
    expect(body).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it('pulls and starts its own compose project, from the file this tree ships', () => {
    const script = DEPLOY!.runLines.join('\n');
    expect(script).toContain('deploy/compose.prod.yml');
    for (const verb of ['pull', 'up -d']) {
      expect(script).toContain(
        `docker compose -p endora-demo --env-file .env -f compose.prod.yml ${verb}`,
      );
    }
    // FR-106: without `-p`, the project is the directory's name — a second stack
    // on a shared host would share its volumes with whichever stack had it first.
    const compose = [...script.matchAll(/docker compose ([^&"\n]*)/g)].map((match) => match[1]!);
    expect(compose.length).toBeGreaterThan(0);
    for (const call of compose) expect(call, call).toMatch(/^-p endora-demo /);
  });

  it('deploys the images the build job pushed, by commit', () => {
    const build = configurationOf(BUILD!);
    expect(build).toMatch(/^ {6}REGISTRY_IMAGE:\s*ghcr\.io\/\$\{\{ github\.repository \}\}\s*$/m);
    expect(build).toMatch(/^ {6}IMAGE_TAG:\s*\$\{\{ github\.sha \}\}\s*$/m);
    const pushed = BUILD!.runLines.flatMap(
      (line) => /^docker push "\$REGISTRY_IMAGE\/([a-z]+):\$IMAGE_TAG"$/.exec(line)?.[1] ?? [],
    );
    expect([...pushed].sort()).toEqual(['admin', 'backend', 'storefront']);
    const deploy = configurationOf(DEPLOY!);
    expect(deploy).toMatch(/^ {6}REGISTRY_IMAGE:\s*ghcr\.io\/\$\{\{ github\.repository \}\}\s*$/m);
    expect(deploy).toMatch(/^ {6}IMAGE_TAG:\s*\$\{\{ github\.sha \}\}\s*$/m);
  });

  it('logs in to no registry on the host — the images are public', () => {
    // D-274 clause 1.2: no registry credential exists on the open-source host.
    expect(DEPLOY!.runLines.join('\n')).not.toContain('docker login');
  });

  it('trusts only the host key it was given', () => {
    expect(CONFIGURATION).not.toMatch(/StrictHostKeyChecking[= ]+no/i);
    expect(DEPLOY!.runLines.join('\n')).toMatch(/StrictHostKeyChecking[= ]+yes/);
  });
});

describe('demo data is seeded only by an explicit act (FR-104, D-274 clause 1.5)', () => {
  const seeding = (): readonly string[] =>
    JOBS.flatMap((job) => stepsOf(job)).filter((step) => /\bdemo seed\b/.test(step));

  it('declares a boolean `reseed` dispatch input that defaults to false', () => {
    const on = topLevelBlock('on').join('\n');
    expect(on).toMatch(/^ {4}inputs:\s*\n {6}reseed:\s*$/m);
    const reseed = on.slice(on.indexOf('      reseed:'));
    expect(reseed).toMatch(/^ {8}type:\s*boolean\s*$/m);
    expect(reseed).toMatch(/^ {8}default:\s*false\s*$/m);
  });

  it('seeds in one step, in the deploy job, only when the input says so', () => {
    const steps = seeding();
    expect(steps, 'no step, or more than one, runs `demo seed`').toHaveLength(1);
    expect(stepsOf(DEPLOY!)).toContain(steps[0]);
    const condition = /^ {8}if:\s*(.+)$/m.exec(steps[0]!)?.[1] ?? '';
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain('inputs.reseed == true');
    // After the stack is up, never before it.
    const deploySteps = stepsOf(DEPLOY!);
    const up = deploySteps.findIndex((step) => step.includes('up -d'));
    expect(up).toBeGreaterThan(-1);
    expect(deploySteps.indexOf(steps[0]!)).toBeGreaterThan(up);
  });

  /** `${NAME:-default}` resolved to its default, the way an unset `.env` would. */
  const withDefaults = (value: string): string => value.replace(/\$\{[A-Z_]+:-([^}]*)\}/g, '$1');

  it('types overrides the seed guard lets through, over the stack it runs in', () => {
    const nodeEnv = /^ {2}NODE_ENV: (\S+)$/m.exec(COMPOSE)?.[1];
    const databaseUrl = /^ {2}DATABASE_URL: (\S+)$/m.exec(COMPOSE)?.[1];
    expect(nodeEnv).toBe('production');
    expect(databaseUrl).toBeDefined();
    const stack: NodeJS.ProcessEnv = { NODE_ENV: nodeEnv, DATABASE_URL: withDefaults(databaseUrl!) };
    // Not vacuous: the stack alone is refused.
    expect(() => mustBeNonProduction(stack)).toThrow();

    const overrides: NodeJS.ProcessEnv = {};
    for (const [, name, value] of seeding()[0]!.matchAll(/-e ([A-Z_]+)=([^\s"']+)/g)) {
      overrides[name!] = value;
    }
    expect(() => mustBeNonProduction({ ...stack, ...overrides })).not.toThrow();
  });
});

describe('the file names no host, address or secret — it is public (D-274 clause 4, D-279)', () => {
  it('reads every domain from a variable', () => {
    for (const name of ['API_DOMAIN', 'STOREFRONT_DOMAIN']) {
      expect(CONFIGURATION).toMatch(new RegExp(`^\\s+${name}:\\s*\\$\\{\\{ vars\\.${name} \\}\\}\\s*$`, 'm'));
    }
  });

  it('reads every deploy coordinate and key from an environment secret', () => {
    for (const name of ['SSH_PRIVATE_KEY', 'SSH_KNOWN_HOSTS', 'DEPLOY_HOST', 'DEPLOY_USER', 'DEPLOY_PATH']) {
      expect(configurationOf(DEPLOY!)).toMatch(
        new RegExp(`^\\s+${name}:\\s*\\$\\{\\{ secrets\\.${name} \\}\\}\\s*$`, 'm'),
      );
    }
  });

  it('contains no hostname or IP address, comments included', () => {
    // `ghcr.io` is the registry every GitHub repository publishes to, not a
    // deployment's host; anything else shaped like a name is refused.
    const names = [...WORKFLOW.matchAll(/\b(?:[a-z0-9-]+\.)+(?:software|com|pl|net|org|dev|app|io|eu)\b/gi)]
      .map((match) => match[0])
      .filter((name) => name !== 'ghcr.io');
    expect(names).toEqual([]);
    expect(WORKFLOW).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/);
    expect(WORKFLOW).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});
