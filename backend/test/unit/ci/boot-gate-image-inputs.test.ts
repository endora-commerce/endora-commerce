import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { pullRequestPaths } from '../../helpers/actions-workflows.js';
import { readCopy, readStages } from '../../helpers/dockerfile.js';

/**
 * A pull request that changes what the image is built from runs the boot gate.
 *
 * ## The defect this is the rule for
 *
 * `boot-gate.yml` runs on a pull request only when it touches a path in the
 * workflow's `paths` filter, and that filter was a hand-written restatement of
 * `backend/Dockerfile`'s inputs. It named three files under `scripts/` one by
 * one while the Dockerfile copied `scripts/` whole — because a workspace
 * package's build runs `scripts/copy-package-assets.mjs`, which the list did
 * not name. A pull request changing that script changed the image and was not
 * judged; the break would have surfaced on `master`, for the next author.
 *
 * A `paths` filter cannot call a script, so the list cannot be generated. What
 * can be done is to derive the image's inputs from the Dockerfile and refuse a
 * filter that does not cover them, which is this file.
 *
 * ## What counts as an input
 *
 *  1. every source the image's final stage copies out of the build context; and
 *  2. for a stage the final stage copies `--from`, every repository script that
 *     stage runs.
 *
 * ## What it cannot see
 *
 * The `manifests` stage copies the whole context and keeps the workspace's
 * manifests, lockfile and workspace file. Its `COPY . .` is not read as "every
 * path is an input" — that would demand a filter that filters nothing — so a
 * manifest of a member outside the copied source roots is not held here. The
 * lockfile moves with any dependency change in one, and the filter names it.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const DOCKERFILE = 'backend/Dockerfile';
const WORKFLOW = '.github/workflows/boot-gate.yml';

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), 'utf8');
}

/** What the image is built from, repo-relative, trailing slashes dropped. */
function imageInputs(dockerfileSource: string): readonly string[] {
  const stages = readStages(dockerfileSource);
  const final = stages[stages.length - 1];
  if (final === undefined) return [];
  const copies = final.instructions
    .map(readCopy)
    .filter((copy): copy is NonNullable<typeof copy> => copy !== null);
  const fromContext = copies.filter((copy) => copy.fromStage === null).flatMap((c) => c.sources);
  const feeders = new Set(copies.map((copy) => copy.fromStage).filter((name) => name !== null));
  const feederScripts = stages
    .filter((stage) => stage.name !== null && feeders.has(stage.name))
    .flatMap((stage) => stage.instructions.filter((instruction) => instruction.keyword === 'RUN'))
    .flatMap((run) => [...run.rest.matchAll(/(?:^|\s)(scripts\/[\w./-]+)/g)].map((m) => m[1]!));
  return [...new Set([...fromContext, ...feederScripts].map((s) => s.replace(/\/$/, '')))].sort();
}

/** `<dir>` + `/` + `**`, optionally + `/` + `*`. */
const RECURSIVE = /^(.+)\/\*\*(?:\/\*)?$/;

/**
 * Does one `paths` pattern cover everything under `input`?
 *
 * Two shapes, which are the two this workflow uses: a directory followed by a
 * double-star segment (spelled out in `RECURSIVE` below, because the pattern
 * itself would close this comment) covers that directory and everything below
 * it, and anything else is a literal that covers exactly the file it spells. A literal never covers a directory —
 * naming three files under one is the defect, not a way to satisfy this.
 */
function covers(pattern: string, input: string, isDirectory: boolean): boolean {
  const recursive = RECURSIVE.exec(pattern);
  if (recursive !== null) {
    const root = recursive[1]!;
    return input === root || input.startsWith(`${root}/`);
  }
  return !isDirectory && pattern === input;
}

function uncovered(
  inputs: readonly string[],
  patterns: readonly string[],
  isDirectory: (input: string) => boolean,
): readonly string[] {
  return inputs.filter(
    (input) => !patterns.some((pattern) => covers(pattern, input, isDirectory(input))),
  );
}

const onDisk = (input: string): boolean => statSync(join(REPO_ROOT, input)).isDirectory();

describe('boot-gate — the pull-request filter covers what the image is built from', () => {
  const inputs = imageInputs(read(DOCKERFILE));
  const patterns = pullRequestPaths(read(WORKFLOW));

  it('derives a real population from the Dockerfile and the workflow', () => {
    expect(inputs.length, `${DOCKERFILE} yielded no input`).toBeGreaterThan(0);
    expect(patterns.length, `${WORKFLOW} yielded no pull_request path`).toBeGreaterThan(0);
    expect(
      inputs.filter((input) => !existsSync(join(REPO_ROOT, input))),
      'the Dockerfile copies a path that is not in the repository',
    ).toEqual([]);
  });

  it('covers every input', () => {
    expect(
      uncovered(inputs, patterns, onDisk),
      `${WORKFLOW}'s pull_request paths do not cover these inputs of ${DOCKERFILE}. A pull ` +
        'request changing one changes the image and does not run the gate.',
    ).toEqual([]);
  });

  it('covers the Dockerfile and the workflow themselves', () => {
    expect(uncovered([DOCKERFILE, WORKFLOW], patterns, () => false)).toEqual([]);
  });
});

describe('boot-gate — the coverage rule can go red', () => {
  const directories = new Set(['scripts', 'packages']);
  const isDirectory = (input: string): boolean => directories.has(input);

  it('refuses a copied directory answered by naming some of its files', () => {
    expect(
      uncovered(
        ['packages', 'scripts'],
        ['packages/**/*', 'scripts/boot-gate.sh', 'scripts/lib/boot-gate-assert.sh'],
        isDirectory,
      ),
    ).toEqual(['scripts']);
  });

  it('accepts a directory under a recursive pattern, and a file under its own name', () => {
    expect(
      uncovered(
        ['scripts', 'scripts/collect-workspace-manifests.sh', 'tsconfig.base.json'],
        ['scripts/**/*', 'tsconfig.base.json'],
        isDirectory,
      ),
    ).toEqual([]);
  });

  it('reads a feeder stage for the scripts it runs', () => {
    const source = [
      'FROM node AS manifests',
      'COPY . .',
      'RUN sh scripts/collect.sh /out',
      'FROM node AS unused',
      'RUN sh scripts/never.sh',
      'FROM node AS app',
      'COPY --from=manifests /out/ ./',
      'COPY backend/ backend/',
    ].join('\n');
    expect(imageInputs(source)).toEqual(['backend', 'scripts/collect.sh']);
  });
});
