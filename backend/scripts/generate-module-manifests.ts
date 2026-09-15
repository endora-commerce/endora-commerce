#!/usr/bin/env tsx
/**
 * Writes every module package's `package.json` from its layer inventory
 * (feature 080, T041), and the admin application's dependency on the module
 * packages whose `./admin` layer the generated registry imports (feature 091).
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
import {
  PackageIdentityError,
  renderPackageIdentityFiles,
} from './lib/package-identity-files.js';
import { AdminLayoutUnresolvableError } from './lib/admin-surfaces.js';
import { UnreadableSubpathError } from './lib/module-package-subpaths.js';
import { TailwindSourceError } from './lib/tailwind-sources.js';
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

  const fs = nodeManifestFs();
  const run = renderModulePackageManifests(repoRoot, fs, findManifestIndex(repoRoot));
  // The two files npm force-includes into every tarball, for every publishable
  // member rather than for the module packages alone (T6-B/T6-C,
  // `specs/123-oss-install-experience/`). They are rendered from the manifests
  // **this run is about to write** and not from the ones on disk, so a single
  // regeneration can never leave a README a generation behind the `package.json`
  // it describes — the idempotence the manifest test asserts holds in one pass.
  const identity = renderPackageIdentityFiles(
    repoRoot,
    fs,
    new Map(
      [...run.rendered, ...run.familyRendered].map((artefact) => [
        dirname(artefact.outputPath),
        artefact.content,
      ]),
    ),
  );

  const check = process.argv.includes('--check');
  // D-181's predicate is a question about the built artefact — does this
  // specifier survive into the emitted `.d.ts`? — so a package that has never
  // been built has no answer, only this generator's fail-closed guess. Writing
  // that guess is right, because a package cannot be built before its manifest
  // exists; holding the tree to it is not, because it is not what the next run
  // after a build will render.
  if (check && run.unbuiltPackages.length > 0) {
    process.stderr.write(
      `${PREFIX} ${run.unbuiltPackages.length} package(s) have no emitted declarations, so ` +
        `D-181's derivation had nothing to read and every reach was taken to survive: ` +
        `${run.unbuiltPackages.join(', ')}\n` +
        `  Build them first: pnpm run build:packages\n`,
    );
    process.exit(2);
  }
  let stale = false;
  // The admin application's manifest is reconciled beside the module packages'
  // (feature 091): the generated admin registry names each contributing module
  // by bare specifier, and a bare specifier resolves only through a declared
  // dependency. It is written by the same command and refused by the same
  // `--check` so the two cannot land apart.
  //
  // The `./tailwind.css` files join them on the same terms (feature 110, T123;
  // `admin-stylesheet-composition.md` R1.4): the declaration and the file it
  // points at are two halves of one statement, and a run that wrote one and not
  // the other publishes a subpath naming a file that is not there — M9 at the
  // first consumer, which is loud, or a stylesheet nothing imports, which is
  // not.
  for (const artefact of [
    ...run.rendered,
    ...run.applicationRendered,
    ...run.familyRendered,
    ...run.stylesheets,
    // `LICENSE` and `README.md` write and `--check` through this same loop for
    // the reason the stylesheets do: they are what a published package shows a
    // stranger, and a gate that verified the manifest while leaving them to a
    // human is a gate over two thirds of the tarball.
    ...identity.licenses,
    ...identity.readmes,
  ]) {
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
  // application manifests, the index, and every owner manifest and emitted
  // module the D-171 surfaces predicate opened to decide whether a reach into
  // another module package is contract surface. `sites` is the finer population the
  // peer derivation actually answers over: every import specifier examined,
  // which is the number that moves when a module gains a dependency without
  // gaining a file. The independent derivation is the generated manifest index:
  // a module it registers by bare specifier is a module package, produced by a
  // different walk from a different input, and one this run did not render is
  // #215's short walk.
  const renderedNames = new Set(run.rendered.map((artefact) => artefact.packageName));
  reportReadSize({
    prefix: PREFIX,
    files: run.filesRead + identity.filesRead,
    sites: run.specifierSites,
    coverage: [
      // Every publishable member owes a `LICENSE`; the ones that do not appear
      // are the ones declaring a licence of their own, which is a state this
      // run has to be able to report rather than fail on. A walk that rendered
      // neither file for a member found by the workspace globs is the short
      // walk issue #215 is about, and it is invisible in the manifest counts
      // below — those are a statement about module packages, and 10 of the 82
      // are not one.
      {
        source: 'publishable-members',
        expected: identity.memberNames.length,
        covered: identity.licenses.length + identity.ownLicenceMembers.length,
      },
      {
        source: 'manifest-index',
        expected: run.registeredPackageNames.length,
        covered: run.registeredPackageNames.filter((name) => renderedNames.has(name)).length,
      },
      // D-181's own population, reconciled against the same set: a package
      // whose emitted declarations this run could not read answered the
      // survival question by guessing, and a run that guessed for all of them
      // is one that read no artefact at all.
      //
      // **A package this run is rendering a first manifest for is out of that
      // population**, and it has to be: nothing can build a package that is not
      // yet a workspace member, so a module just moved into place or scaffolded
      // has no `dist` by construction and never will until this command has run
      // once. Counting it made the floor refuse the one run that must succeed —
      // measured, `manifests:generate` wrote the new manifest and then exited 2
      // on `emitted-declarations 66/67`. The exclusion is derived from the
      // absence of the file this command writes, so it covers exactly the first
      // run and no later one; every already-manifested package that has not been
      // built is still a short walk and still refused.
      {
        source: 'emitted-declarations',
        expected: run.rendered.length - run.newPackages.length,
        covered:
          run.rendered.length -
          run.newPackages.length -
          run.unbuiltPackages.filter((name) => !run.newPackages.includes(name)).length,
      },
    ],
  });

  process.stdout.write(
    `${PREFIX} identity: licenses=${identity.licenses.length} ` +
      `readmes=${identity.readmes.length} ` +
      `hand-written-readmes=${identity.handWrittenReadmes.length} ` +
      `own-licence=${identity.ownLicenceMembers.length} of ${identity.memberNames.length} ` +
      `publishable member(s)\n`,
  );

  if (stale) process.exit(1);
  if (check) {
    process.stdout.write(`${PREFIX} every module package manifest is up to date ✓\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error: unknown) {
    // Two refusals, one exit code, and they are kept apart deliberately.
    // `ModulePackageManifestError` says the manifest cannot be derived;
    // `UnreadableSubpathError` says a subpath's emitted module could not be
    // read, which is a cold `dist` and not a coupling — R4's narrowing must
    // never dress the second up as the first (D-171, issue #113).
    if (
      error instanceof ModulePackageManifestError ||
      error instanceof UnreadableSubpathError ||
      // A fourth, on the same terms: a package ships scannable UI and declares
      // no build layout, so the emitted half of its `@source` lines cannot be
      // derived (feature 110, T123). Naming `dist` here instead would be the
      // host spelling a directory inside a package, which is the shape
      // `admin-stylesheet-composition.md` §4(b) rejects — and it fails
      // silently, because Tailwind says nothing about an `@source` naming a
      // directory that is not there.
      error instanceof TailwindSourceError ||
      // A third: the admin application could not be located, so the manifest
      // whose dependencies make the generated registry resolvable has no
      // subject. Ambiguity is refused there rather than resolved, for the
      // reason `lib/admin-surfaces.ts` gives — picking one of two members
      // narrows every admin derivation to it without saying so.
      error instanceof AdminLayoutUnresolvableError ||
      // A fifth: the root `LICENSE` is unreadable, a publishable member
      // declares no licence or no description, or a module publishes a subpath
      // the README renderer has no meaning for. Each is a tree this command
      // will not guess its way through, and guessing is the one thing a
      // licence renderer must never do.
      error instanceof PackageIdentityError
    ) {
      process.stderr.write(`${PREFIX} ${error.message}\n`);
      process.exit(2);
    }
    throw error;
  }
}
