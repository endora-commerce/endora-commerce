import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildArgFlags,
  buildInputsFor,
  INSTANCE_BUILD_INPUTS,
  type BuildTarget,
} from '@endora-commerce/cli/lib/instance-build-inputs.js';

/**
 * The four per-instance build inputs are declared once, and this pipeline is
 * held to that declaration (`specs/110-instance-repository/` FR-009;
 * `contracts/instance-repository.md` R2.1).
 *
 * ## What this replaces
 *
 * The set used to live in three places in `.gitlab-ci.yml` and nowhere else: a
 * comment block naming the CI/CD variables an operator must set, and two
 * `docker build` invocations spelling the mapping from an input to the build
 * argument the image reads. Nothing reconciled them, and one of the four —
 * `DEPLOYMENT` — reached **no build at all**, which is the member of the set
 * whose absence is silent by construction: `selectedDeployment` reads a blank
 * value as bare core, so a deployment whose overlay modules did not compose is
 * indistinguishable from a deployment that has none.
 *
 * ## Why a test rather than a generator
 *
 * `.gitlab-ci.yml` is YAML and cannot import TypeScript, and the build jobs run
 * in a `docker` image with no node toolchain, so nothing in a job could ask the
 * declaration at run time. The estate's answer to exactly this shape is a
 * predicate over the file — `toolchain-supply.test.ts` and
 * `image-build-inputs.test.ts` are the two precedents — so the declaration is
 * the author and this is the reconciliation.
 *
 * ## Both directions
 *
 * A declared input that no job passes is an input a client is told to set and
 * that reaches nothing. A `--build-arg` in a job that the declaration does not
 * name is the fourth spelling arriving through the door this closed. And an
 * argument a job passes that its Dockerfile declares no `ARG` for is a value
 * docker discards with a warning nobody reads.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CI_FILE = join(REPO_ROOT, '.gitlab-ci.yml');

const DOCKERFILES: Readonly<Record<BuildTarget, string>> = {
  backend: join(REPO_ROOT, 'backend/Dockerfile'),
  admin: join(REPO_ROOT, 'admin/Dockerfile'),
  storefront: join(REPO_ROOT, 'storefront/Dockerfile'),
};

/** The `script:` block of one job, as text. */
function jobScript(source: string, job: string): string {
  const start = source.indexOf(`\n${job}:\n`);
  if (start < 0) return '';
  const rest = source.slice(start + 1);
  const end = /\n(?=[A-Za-z.][\w:.-]*:\n)/.exec(rest.slice(job.length + 2));
  return end === null ? rest : rest.slice(0, job.length + 2 + end.index);
}

/** Every `--build-arg NAME=` a job passes, in the order it passes them. */
function buildArgsIn(script: string): readonly string[] {
  return [...script.matchAll(/--build-arg\s+([A-Z0-9_]+)=/g)].map((match) => match[1]!);
}

/** Every `ARG NAME` a Dockerfile declares. */
function declaredArgs(dockerfile: string): readonly string[] {
  return [...dockerfile.matchAll(/^ARG\s+([A-Z0-9_]+)/gm)].map((match) => match[1]!);
}

const CI = readFileSync(CI_FILE, 'utf8');
const JOBS: Readonly<Record<BuildTarget, string>> = {
  backend: jobScript(CI, 'build:backend'),
  admin: jobScript(CI, 'build:admin'),
  storefront: jobScript(CI, 'build:storefront'),
};
const TARGETS = Object.keys(JOBS) as BuildTarget[];

describe('the per-instance build inputs are declared once', () => {
  it('has a population to judge — a declaration, and three build jobs', () => {
    // Issue #113: a green that could mean "the file moved" is not a green. Both
    // sides of the reconciliation have to be non-empty before any of it means
    // anything.
    expect(INSTANCE_BUILD_INPUTS.length).toBeGreaterThan(0);
    for (const target of TARGETS) {
      expect(JOBS[target], `.gitlab-ci.yml declares no build:${target} job`).not.toBe('');
    }
    expect(
      INSTANCE_BUILD_INPUTS.flatMap((input) => input.consumers).length,
      'no declared input names a build — the mapping half would be vacuous',
    ).toBeGreaterThan(0);
  });

  it('says what each input means, what it looks like, and what happens without it', () => {
    // A client's developer reads this before they read anything else of ours.
    for (const input of INSTANCE_BUILD_INPUTS) {
      expect(input.name).toMatch(/^[A-Z][A-Z0-9_]*$/);
      expect(input.meaning.length, `${input.name} declares no meaning`).toBeGreaterThan(40);
      expect(input.example.length, `${input.name} declares no example`).toBeGreaterThan(0);
      // `default: null` is a decision — "the instance must supply one" — and is
      // distinguishable from a field nobody filled in, because the type demands
      // one of the two.
      expect(input.default === null || input.default.length > 0).toBe(true);
    }
  });

  it('is what the build jobs pass, flag for flag', () => {
    for (const target of TARGETS) {
      for (const flag of buildArgFlags(target)) {
        expect(
          JOBS[target].includes(flag),
          `build:${target} does not pass ${flag}. The declaration in ` +
            '`packages/cli/src/lib/instance-build-inputs.ts` is the author; this pipeline ' +
            'supplies what it says.',
        ).toBe(true);
      }
    }
  });

  it('passes no build argument the declaration does not name', () => {
    for (const target of TARGETS) {
      const declared = buildInputsFor(target).map(({ consumer }) => consumer.buildArg);
      expect(
        [...buildArgsIn(JOBS[target])].sort(),
        `build:${target} passes a build argument that is in no declaration — which is how the ` +
          'set came to be written in three places in the first place.',
      ).toEqual([...declared].sort());
    }
  });

  it('names only build arguments the image actually declares', () => {
    // Docker warns and carries on when a `--build-arg` matches no `ARG`, so this
    // is the one direction whose failure is a value silently dropped.
    for (const target of TARGETS) {
      const args = declaredArgs(readFileSync(DOCKERFILES[target], 'utf8'));
      for (const { consumer } of buildInputsFor(target)) {
        expect(
          args,
          `${DOCKERFILES[target]} declares no \`ARG ${consumer.buildArg}\`, so the value this ` +
            'pipeline passes is discarded with a warning nobody reads.',
        ).toContain(consumer.buildArg);
      }
    }
  });

  it('reaches the backend build, which is the input that reached none', () => {
    // FR-009's own sentence, as an assertion rather than as prose: `DEPLOYMENT`
    // is a build input and until this feature it was passed to no `docker build`
    // in this file.
    const deployment = INSTANCE_BUILD_INPUTS.find((input) => input.name === 'DEPLOYMENT');
    expect(deployment, 'DEPLOYMENT is no longer a declared build input').toBeDefined();
    expect(deployment!.consumers.map((consumer) => consumer.target)).toContain('backend');
    expect(JOBS.backend).toContain('--build-arg DEPLOYMENT=');
  });

  it('renders a default as the shell expansion that applies it', () => {
    // The default has one home. A consumer template naming an input with a
    // default renders `${NAME:-value}`, so the pipeline and a client's rendered
    // `.env` cannot disagree about what "unset" means.
    const withDefault = INSTANCE_BUILD_INPUTS.filter((input) => input.default !== null);
    expect(withDefault.length, 'no input declares a default — this rule is vacuous').toBeGreaterThan(
      0,
    );
    for (const input of withDefault) {
      const flags = input.consumers.flatMap((consumer) => buildArgFlags(consumer.target));
      const naming = flags.filter((flag) => flag.includes(input.name));
      expect(naming.length).toBeGreaterThan(0);
      for (const flag of naming) expect(flag).toContain(`\${${input.name}:-${input.default!}}`);
    }
  });
});
