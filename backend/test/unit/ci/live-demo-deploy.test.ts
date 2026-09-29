import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { mustBeNonProduction } from '@endora-commerce/platform/demo';

import { commandLines, readJobs, type CiJob } from '../../helpers/ci-jobs.js';

/**
 * No job in this pipeline can replace the live demo (D-274 clause 3, order step 1;
 * `specs/136-open-source-publication/` FR-105, plan W7.1).
 *
 * ## The one click this refuses
 *
 * The live demo was deployed from this repository before the paid modules left it,
 * and it still serves them because its images predate their departure. The
 * `deploy` job that put it there shipped `deploy/compose.prod.yml` to
 * `$DEPLOY_PATH` and ran `docker compose … up` there, over images built from
 * today's tree — which no longer holds a paid module. One manual click would
 * therefore have replaced the full demo with a free-only one, and D-274 rules
 * that the full demo is never deployed over: it is replaced by a reversible
 * upstream switch after its successor, built by the paid repository, is verified.
 *
 * ## The rule, as a property of a job rather than a name
 *
 * A job named `deploy` is not the subject; a job that ships the application
 * compose file, or runs `docker compose` against the application stack's
 * directory, is. Renaming the job, or folding its script into another one, must
 * stay red. `publish:docs` shares the SSH variables and writes under
 * `$DOCS_DEPLOY_PATH`, never `$DEPLOY_PATH` (`docs-publication.test.ts` holds that
 * separation), so it is outside this rule by construction rather than by
 * exemption.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const JOBS = readJobs(readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8'));
const README = readFileSync(join(REPO_ROOT, 'deploy/README.md'), 'utf8');
const COMPOSE = readFileSync(join(REPO_ROOT, 'deploy/compose.prod.yml'), 'utf8');

/** What a job does that could replace the application stack on a host. */
function stackReplacements(job: CiJob): readonly string[] {
  const commands = commandLines([job]).join('\n');
  const found: string[] = [];
  if (/deploy\/compose\.prod\.yml/.test(commands)) {
    found.push('ships deploy/compose.prod.yml');
  }
  if (/\bdocker[ -]compose\b/.test(commands) && /\$\{?DEPLOY_PATH\b/.test(commands)) {
    found.push('runs docker compose against $DEPLOY_PATH');
  }
  return found;
}

describe('no job can deploy over the live demo (D-274, FR-105)', () => {
  /** The floor (issue #244): an empty parse is also "no job violates the rule". */
  it('parsed a pipeline that looks like this one', () => {
    expect(JOBS.map((job) => job.name)).toEqual(
      expect.arrayContaining(['quality', 'build:backend', 'publish:docs']),
    );
    expect(commandLines(JOBS).length).toBeGreaterThanOrEqual(100);
  });

  /**
   * The red proof: the predicate recognises the job this file retired. Without
   * it, a predicate that had stopped matching anything would pass the next case
   * over the very job it exists to refuse.
   */
  it("recognises the retired job's own shape", () => {
    const retired = readJobs(
      [
        'deploy:',
        '  stage: deploy',
        '  script:',
        '    - scp deploy/compose.prod.yml "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"',
        '    - ssh "$DEPLOY_USER@$DEPLOY_HOST"',
        '      "cd $DEPLOY_PATH &&',
        '       docker compose --env-file .env -f compose.prod.yml up -d --remove-orphans"',
        '',
      ].join('\n'),
    );
    expect(retired).toHaveLength(1);
    expect(stackReplacements(retired[0]!)).toEqual([
      'ships deploy/compose.prod.yml',
      'runs docker compose against $DEPLOY_PATH',
    ]);
  });

  it('no job ships the application compose file or runs compose in its directory', () => {
    const offenders = JOBS.filter((job) => stackReplacements(job).length > 0).map(
      (job) => `${job.name} (${stackReplacements(job).join('; ')})`,
    );
    expect(
      offenders,
      `${offenders.join(', ')}: a job that can replace the application stack on the demo ` +
        'host. The live demo carries the paid modules and this tree does not, so running it ' +
        'replaces the full demo with a free-only one. D-274 retired the job that did this; ' +
        'the open-source demo gets a workflow and a stack of its own (plan W7.5), and the ' +
        'full demo is built and deployed by the paid repository.',
    ).toEqual([]);
  });
});

/**
 * The demo-seed command `deploy/README.md` documents is one the guard lets through.
 *
 * `packages/platform/src/demo/guard.ts` asks two independent questions — is this
 * `NODE_ENV=production`, and is the database neither loopback nor named as a test
 * database — and each has its own override (issue #224). In this stack both are
 * true: the backend's environment says `production`, and its `DATABASE_URL` names
 * the compose service `postgres` and the database `b2b`. The README typed only the
 * first override, so the command it documented refused. Asserted by **running the
 * guard** over the environment the documented command produces, not by looking for
 * two strings: a third question added to the guard reds this without anybody
 * remembering the README.
 */
describe('the documented demo-seed command passes the seed guard', () => {
  /** `${NAME:-default}` resolved to its default, the way an unset `.env` would. */
  const withDefaults = (value: string): string => value.replace(/\$\{[A-Z_]+:-([^}]*)\}/g, '$1');

  /** The stack's own backend environment, as far as the guard reads it. */
  function stackEnvironment(): NodeJS.ProcessEnv {
    const nodeEnv = /^ {2}NODE_ENV: (\S+)$/m.exec(COMPOSE)?.[1];
    const databaseUrl = /^ {2}DATABASE_URL: (\S+)$/m.exec(COMPOSE)?.[1];
    expect(nodeEnv, 'deploy/compose.prod.yml declares no backend NODE_ENV').toBeDefined();
    expect(databaseUrl, 'deploy/compose.prod.yml declares no backend DATABASE_URL').toBeDefined();
    return { NODE_ENV: nodeEnv, DATABASE_URL: withDefaults(databaseUrl!) };
  }

  /** Every `-e NAME=value` of the README's fenced command that runs `demo seed`. */
  function documentedOverrides(): NodeJS.ProcessEnv {
    const blocks = [...README.matchAll(/```bash\n([\s\S]*?)```/g)]
      .map((match) => match[1]!)
      .filter((block) => /\bdemo seed\b/.test(block));
    expect(blocks, 'deploy/README.md documents no `demo seed` command').toHaveLength(1);
    const overrides: NodeJS.ProcessEnv = {};
    for (const [, name, value] of blocks[0]!.matchAll(/-e ([A-Z_]+)=(\S+)/g)) {
      overrides[name!] = value;
    }
    return overrides;
  }

  it('refuses the stack without an override, so the next case is not vacuous', () => {
    expect(stackEnvironment()['NODE_ENV']).toBe('production');
    expect(() => mustBeNonProduction(stackEnvironment())).toThrow();
  });

  it('lets the documented command through', () => {
    expect(() =>
      mustBeNonProduction({ ...stackEnvironment(), ...documentedOverrides() }),
    ).not.toThrow();
  });
});
