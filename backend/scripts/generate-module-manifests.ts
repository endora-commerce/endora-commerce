#!/usr/bin/env tsx
/**
 * Writes every module package's `package.json` from its layer inventory
 * (feature 080, T041).
 *
 *   pnpm --filter backend run manifests:generate     # write
 *   pnpm --filter backend run manifests:check        # refuse drift, write nothing
 *
 * The derivation itself is `lib/module-package-manifest.ts`; this is the thin
 * CLI half, in the shape `generate-composer.ts` established — a pure render, a
 * `--check` mode that never writes, and a `read:` line in the shared grammar.
 *
 * ## Why it is beside `composer:generate` rather than inside it
 *
 * Three reasons, and the first is the one that decides it.
 *
 * 1. **The composer *reads* what this writes.** `discoverModulePackages` takes
 *    each package's `exports` map and `tsconfig.build.json` and turns them into
 *    the bare specifiers the migration and entity registries import (D-149). One
 *    command that wrote the map and then read it in the same process would bake
 *    a manifest and a registry rendered from two different states of the same
 *    file into one commit, and the order of two passes would become load-bearing
 *    where nothing declares it. Two commands make the dependency one-directional
 *    and visible: generate the manifests, then regenerate the composer.
 * 2. **`overlay:check` cannot examine a JSON manifest.** Its containment
 *    verdict classifies the `import`/`export … from` specifiers a rendered
 *    artefact writes, and refuses a run in which any artefact contributed no
 *    site — issue #215's short-walk floor, per artefact. A `package.json`
 *    contributes none: its nearest equivalent is the `peerDependencies` key
 *    set, and those resolve into `node_modules` by design, which is the exact
 *    shape that check calls `foreign`. Adding the manifests there would mean
 *    either weakening that floor or teaching it a second notion of containment.
 * 3. **The move is when you want to run it.** A module that has just been
 *    `git mv`d into `packages/modules/<id>/src/` has no `package.json` at all,
 *    so it is not yet a workspace member and half of what the composer walks
 *    does not resolve. This command's population is deliberately the *glob*
 *    rather than the member list, so it is the first thing an author runs and
 *    `composer:generate` is the second.
 *
 * The drift gate is `test/unit/packages/module-package-manifest.test.ts`, which
 * renders the same artefacts in-process and byte-compares them to disk. It runs
 * in `test:backend:unit`, whose rung-1 `changes:` list includes `packages/**` —
 * so the merge request that hand-edits a manifest is exactly the one that runs
 * it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { reportReadSize } from './lib/read-size.js';
import {
  ModulePackageManifestError,
  nodeManifestFs,
  renderModulePackageManifests,
} from './lib/module-package-manifest.js';
import { findManifestIndex, findRepoRoot } from './lib/module-roots.js';

const PREFIX = '[module-manifests]';

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = findRepoRoot(here);
  if (repoRoot === null) {
    process.stderr.write(
      `${PREFIX} no pnpm-workspace.yaml above ${here} — the module packages are derived from ` +
        `the workspace globs, so there is nothing to walk.\n`,
    );
    process.exit(2);
  }

  const run = renderModulePackageManifests(
    repoRoot,
    nodeManifestFs(),
    findManifestIndex(repoRoot),
  );

  const check = process.argv.includes('--check');
  let stale = false;
  for (const artefact of run.rendered) {
    const onDisk = existsSync(artefact.outputPath)
      ? readFileSync(artefact.outputPath, 'utf8')
      : null;
    const where = relative(repoRoot, artefact.outputPath);
    if (onDisk === artefact.content) {
      if (check) process.stdout.write(`${PREFIX} ${where}: up to date ✓\n`);
      continue;
    }
    if (check) {
      stale = true;
      process.stderr.write(
        `${PREFIX} ${onDisk === null ? 'MISSING' : 'STALE'}: ${where}\n` +
          `  Regenerate and commit: pnpm --filter backend run manifests:generate\n`,
      );
      continue;
    }
    writeFileSync(artefact.outputPath, artefact.content, 'utf8');
    process.stdout.write(`${PREFIX} wrote ${where}\n`);
  }

  // What was read, beside what was found (issue #244). `files` counts every
  // file opened — sources, module manifests, build configurations, the two
  // application manifests and the index. `sites` is the finer population the
  // peer derivation actually answers over: every import specifier examined,
  // which is the number that moves when a module gains a dependency without
  // gaining a file. The independent derivation is the generated manifest index:
  // a module it registers by bare specifier is a module package, produced by a
  // different walk from a different input, and one this run did not render is
  // #215's short walk.
  const renderedNames = new Set(run.rendered.map((artefact) => artefact.packageName));
  reportReadSize({
    prefix: PREFIX,
    files: run.filesRead,
    sites: run.specifierSites,
    coverage: [
      {
        source: 'manifest-index',
        expected: run.registeredPackageNames.length,
        covered: run.registeredPackageNames.filter((name) => renderedNames.has(name)).length,
      },
    ],
  });

  if (stale) process.exit(1);
  if (check) {
    process.stdout.write(`${PREFIX} every module package manifest is up to date ✓\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error: unknown) {
    if (error instanceof ModulePackageManifestError) {
      process.stderr.write(`${PREFIX} ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
