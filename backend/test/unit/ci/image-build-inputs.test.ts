import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The image compiles the committed tree; it does not re-derive it.
 *
 * ## The defect this is the rule for
 *
 * `pnpm --filter backend run build` is what `backend/Dockerfile`'s final stage
 * runs, and it began — from feature 018, the day the first generator was
 * written — with `overlay:divergence` and `composer:generate`. Both of those walk
 * the **whole workspace**; the image holds a strict subset of it (`packages/`,
 * `backend/`, `scripts/`, `tsconfig.base.json`, plus every member's
 * `package.json` from the `manifests` stage). For four months the subset was
 * large enough and nobody noticed.
 *
 * `specs/091-module-owned-admin-surfaces/` Phase 2 added a fifth composer
 * artefact, `admin/src/modules.generated.ts`, whose path is derived from the
 * workspace member declaring the `"@/*"` tsconfig alias. `admin/` is not copied
 * into the image, so `composer:generate` raised `AdminLayoutUnresolvableError`,
 * `tsc` never ran, and `build:backend` and `boot-gate` both went red on the
 * default branch — the second being the one gate in the pipeline whose subject
 * is the built tree.
 *
 * ## Why the rule is "no generator", and not "copy the admin"
 *
 * Tolerating the absence inside the generator is undecidable from where it would
 * have to be decided: `admin/package.json` **is** in the image, because the
 * `manifests` stage collects every member's manifest, so "the admin sources were
 * not copied" and "the admin stopped declaring its alias" are the same
 * observation there. A tolerance would have to guess, and guessing is the silent
 * skip this repository refuses everywhere else.
 *
 * Nothing is lost by not generating. Every artefact is committed and
 * `overlay:check` refuses a stale, non-deterministic or foreign one in the
 * `quality` job, which carries no `changes:` filter. Generating inside the image
 * never *added* a defence either: it wrote its answer into the image rather than
 * into the tree, so a build over a checkout with stale artefacts produced a
 * working image and reported nothing.
 *
 * ## What is asserted
 *
 *  1. the build script runs no artefact generator — the population derived from
 *     `backend/package.json`'s own script table, never a list written here, so a
 *     generator added tomorrow is covered by existing; and
 *  2. that this is not a vacuous rule: at least one committed artefact really
 *     does land outside the source roots the image's final stage copies, which
 *     is what makes running a generator there a demand the image cannot meet.
 *
 * The sibling file `dockerfile-workspace-supply.test.ts` states the containment
 * the other way round — every member arriving with the *sources* arrived with
 * the *manifests*. It cannot see this defect, and correctly: here a manifest
 * arrived whose sources did not, and a build step read the manifest side.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const BACKEND_MANIFEST = join(REPO_ROOT, 'backend/package.json');
const DOCKERFILE = join(REPO_ROOT, 'backend/Dockerfile');

// --------------------------------------------------------------------------
// The script table, and the generators in it
// --------------------------------------------------------------------------

function scriptTable(manifestSource: string): Readonly<Record<string, string>> {
  const parsed = JSON.parse(manifestSource) as { scripts?: Record<string, string> };
  return parsed.scripts ?? {};
}

/**
 * A script is an **artefact generator** when its command runs a
 * `scripts/generate-*.ts` file. Derived from the command, not from the script's
 * name: `overlay:divergence`, `composer:generate`, `manifest-index:generate` and
 * `manifests:generate` share no naming convention and a fifth will share none
 * either.
 */
function generatorScripts(scripts: Readonly<Record<string, string>>): readonly string[] {
  return Object.entries(scripts)
    .filter(([, command]) => /(^|[\s/])scripts\/generate-[\w-]+\.ts(\s|$)/.test(command))
    .map(([name]) => name)
    .sort();
}

/**
 * Every script `name` reaches, itself included, following `pnpm run <other>`
 * within this manifest. A build step is allowed to be one indirection deep —
 * the removed prefix was written exactly that way.
 */
function reachableScripts(
  scripts: Readonly<Record<string, string>>,
  name: string,
): readonly string[] {
  const seen = new Set<string>();
  const queue = [name];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const command = scripts[current];
    if (command === undefined) continue;
    for (const match of command.matchAll(/pnpm\s+run\s+([\w:.-]+)/g)) queue.push(match[1]!);
  }
  return [...seen].sort();
}

// --------------------------------------------------------------------------
// What the image's final stage copies
// --------------------------------------------------------------------------

/**
 * The repo-relative sources the last `FROM` stage of a Dockerfile copies out of
 * the build context. `COPY --from=<stage>` is excluded: it moves nothing from
 * this repository's tree.
 */
function finalStageContextSources(dockerfileSource: string): readonly string[] {
  const stages = dockerfileSource.split(/^FROM\s+/m);
  const last = stages[stages.length - 1] ?? '';
  const sources: string[] = [];
  for (const line of last.split('\n')) {
    const copy = /^COPY\s+(.+)$/.exec(line.trim());
    if (copy === null) continue;
    const tokens = copy[1]!.split(/\s+/).filter((token) => token !== '');
    if (tokens.some((token) => token.startsWith('--from='))) continue;
    // The last positional token is the destination.
    sources.push(...tokens.filter((token) => !token.startsWith('--')).slice(0, -1));
  }
  return [...new Set(sources)].sort();
}

/** Does `path` (repo-relative) sit under one of the copied sources? */
function copiedIntoImage(path: string, sources: readonly string[]): boolean {
  return sources.some((source) => {
    const normalised = source.replace(/\/$/, '');
    return path === normalised || path.startsWith(`${normalised}/`);
  });
}

// --------------------------------------------------------------------------
// The committed artefacts, from the generators that own their paths
// --------------------------------------------------------------------------

async function committedArtefactPaths(): Promise<readonly string[]> {
  const { generatedArtifactPaths } = await import('../../../scripts/generate-composer.js');
  const { divergenceOutputPaths } = await import('../../../scripts/generate-divergence.js');
  return [...generatedArtifactPaths(), divergenceOutputPaths(null).module].map((absolute) =>
    absolute.slice(REPO_ROOT.length).split('\\').join('/'),
  );
}

// --------------------------------------------------------------------------

describe('the backend build compiles the committed tree', () => {
  const manifestSource = readFileSync(BACKEND_MANIFEST, 'utf8');
  const scripts = scriptTable(manifestSource);
  const generators = generatorScripts(scripts);

  it('has a non-empty generator population to judge against', () => {
    // Issue #113: a green that could mean "the pattern matched nothing" is not a
    // green. The tree has four such scripts today; the floor is that it has any.
    expect(scripts.build, 'backend/package.json declares no `build` script').toBeDefined();
    expect(generators.length).toBeGreaterThan(0);
  });

  it('runs no artefact generator', () => {
    const reached = reachableScripts(scripts, 'build');
    const offenders = reached.filter((name) => name !== 'build' && generators.includes(name));
    expect(
      offenders,
      'A generator walks the whole workspace; the image holds a subset of it, and a generator ' +
        'that runs there writes its answer into the image rather than into the tree. ' +
        'Regenerate with `pnpm --filter backend run composer:generate` and commit; ' +
        '`overlay:check` is what refuses a stale artefact.',
    ).toEqual([]);
  });

  it('refuses a build script that reaches a generator, however indirectly', () => {
    const fixture: Record<string, string> = {
      build: 'pnpm run prepare:artefacts && tsc -p tsconfig.build.json',
      'prepare:artefacts': 'pnpm run composer:generate',
      'composer:generate': 'tsx scripts/generate-composer.ts',
    };
    const reached = reachableScripts(fixture, 'build');
    const offenders = reached.filter(
      (name) => name !== 'build' && generatorScripts(fixture).includes(name),
    );
    expect(offenders).toEqual(['composer:generate']);
  });
});

describe('the rule is not vacuous', () => {
  it('at least one committed artefact lands outside what the image copies', async () => {
    expect(existsSync(DOCKERFILE)).toBe(true);
    const sources = finalStageContextSources(readFileSync(DOCKERFILE, 'utf8'));
    expect(sources.length, 'read no COPY out of the Dockerfile final stage').toBeGreaterThan(0);

    const artefacts = await committedArtefactPaths();
    expect(artefacts.length, 'the generators named no artefact').toBeGreaterThan(0);

    const outside = artefacts.filter((path) => !copiedIntoImage(path, sources));
    expect(
      outside,
      'Every committed artefact now lands inside the image. The rule above still holds for ' +
        'its second reason — a generator writes into the image and not into the tree — but ' +
        'this half has stopped measuring anything and should be re-derived, not deleted.',
    ).not.toEqual([]);
  });
});
