/**
 * CI check — a module reaches only the platform surface the host publishes
 * (D-160.8). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/platform-surface.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its five findings, its two specifier spellings, its refusals and
 * its population walk. This file resolves this repository's module walk roots,
 * its platform barrels and its floors, and it holds
 * `UNPUBLISHED_PLATFORM_REACHES` below: a ledger is a statement about *this*
 * tree's debt and does not travel. The forwarding specifier is **bare**, never a
 * path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkPlatformSurface,
  collectPlatformSurfaceSources as walk,
  hostDependentCoverage,
  isPackageToolingConfig,
  keyOf,
  platformSurfaceRefusal,
  remedyOf,
  resolveTarget,
  type LedgeredReach,
  type ModulePackageDeclaration,
} from '@endora-commerce/cli/rules/platform-surface.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import {
  barrelKeyOf,
  publishedSurface,
  PUBLISHED_SUBPATHS,
  type HostPackage,
} from './lib/platform-surface.js';
import { requireModuleLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/platform-surface.js';

/**
 * Not a module's file at all.
 *
 * `src/apps/<deployment>/` holds a deployment's divergence declaration and its
 * generated override manifest **beside** its overlay modules, and the walk
 * covers that root whole. The rule is about modules, and a deployment's own
 * files are never packaged (D-104).
 *
 * They are ledgered rather than filtered out on purpose: a filter would make
 * every file the attribution loses invisible, and a *module* file that stopped
 * resolving to its id would hide among them behind a full-length `read:` line
 * — which is #215 one layer in (!879).
 */
const DEPLOYMENT_FILE =
  'a per-deployment file, not a module\'s: `src/apps/<deployment>/` holds the ' +
  'divergence declaration and the generated divergence report beside its overlay ' +
  'modules, and none of them is ever packaged (D-104). Ledgered rather than filtered so a ' +
  'module file the attribution loses cannot hide among them.';

export const UNPUBLISHED_PLATFORM_REACHES: Readonly<Record<string, LedgeredReach>> = {
  // === DEPLOYMENT_FILE (4) ===
  'backend/src/apps/acceptance/divergence.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/acceptance/divergence.generated.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/divergence.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },
  'backend/src/apps/example/divergence.generated.ts|(unattributed)': { symbols: ['?'], reason: DEPLOYMENT_FILE },

};

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const prefix = '[platform-surface]';
  const layout = await requireModuleLayout(prefix);

  // Every root a module's source can live in, derived (feature 080, T040a):
  // the application's own tree, the per-deployment overlay tree, and each
  // module that has become a workspace package.
  // Repo-relative, one namespace — see the header. `layout.keyOf` has two bases
  // and a resolver cannot straddle them.
  const repoKeyOf = (absolutePath: string): string =>
    relative(layout.repoRoot, absolutePath).split('\\').join('/');

  const moduleFiles = layout.moduleWalkRoots.flatMap((root) =>
    walk(root).filter((file) => !isPackageToolingConfig(root, file)),
  );
  const sources = new Map<string, string>();
  for (const file of moduleFiles) sources.set(repoKeyOf(file), readFileSync(file, 'utf8'));

  // What a specifier can resolve to: the whole source tree, module files and
  // platform files alike. A relative specifier naming nothing in it is a
  // finding, never a skip.
  const files = new Set<string>(
    layout.sourceRoots.flatMap((root) => walk(root)).map((file) => repoKeyOf(file)),
  );
  for (const key of sources.keys()) files.add(key);

  // The published surface, read out of the barrels — the same parse
  // `published-surface.test.ts` holds those barrels to §1.3 with, resolved
  // against the same file list a module reach is resolved against.
  // The platform's own sources, wherever the workspace says they are. `null` is
  // a stop and not an empty surface: this check *is* the platform's barrels, so
  // a run without them would refuse every reach in the tree.
  const platformRoot = layout.platformRoot;
  if (platformRoot === null) {
    console.error(
      `${prefix} no workspace member declares \`endora.type: "platform"\` — there are no ` +
        'barrels to read and no published surface to judge a reach against',
    );
    process.exit(2);
  }
  // Shim key → the platform file it forwards to. Built from the platform tree,
  // so a shim with no counterpart is simply absent from it rather than mapped
  // to a file that is not there.
  const canonicalTargets = new Map<string, string>();
  for (const file of walk(platformRoot)) {
    const withinPlatform = relative(platformRoot, file).split('\\').join('/');
    canonicalTargets.set(`${repoKeyOf(layout.srcRoot)}/${withinPlatform}`, repoKeyOf(file));
  }
  const canonicalTargetOf = (key: string): string => canonicalTargets.get(key) ?? key;

  const barrelSources = new Map<string, string>();
  const missing: string[] = [];
  for (const subpath of PUBLISHED_SUBPATHS) {
    const absolute = join(platformRoot, barrelKeyOf(subpath));
    if (!existsSync(absolute)) {
      missing.push(barrelKeyOf(subpath));
      continue;
    }
    barrelSources.set(repoKeyOf(absolute), readFileSync(absolute, 'utf8'));
  }
  const surface = publishedSurface(barrelSources, (fromKey, specifier) =>
    resolveTarget(fromKey, specifier, files),
  );
  const refusal = platformSurfaceRefusal({ missingBarrels: missing, surface });
  if (refusal !== null) {
    console.error(`${prefix} ${refusal}`);
    process.exit(2);
  }

  // The host as a packaged module names it (feature 080, T060): the npm name off
  // its own manifest, and one entry per published subpath pointing at the barrel
  // this run just read. Both derived — a scope written here would break on D-161
  // and a subpath list would break on the sixth published directory.
  const hostName = layout.platformPackageName;
  if (hostName === null) {
    console.error(
      `${prefix} the workspace member holding the platform publishes under no name — a ` +
        'packaged module reaches the platform by that name, so every one of those reaches ' +
        'would leave the population unjudged',
    );
    process.exit(2);
  }
  const host: HostPackage = {
    name: hostName,
    subpathTargets: new Map(
      PUBLISHED_SUBPATHS.map((subpath) => [
        subpath,
        repoKeyOf(join(platformRoot, barrelKeyOf(subpath))),
      ]),
    ),
  };

  // The population is the module tree, and the rest of `src/` is a small
  // fraction of it: a walk that read only the remainder would find no reach at
  // all and print the same green as a clean tree (issue #215). Derived from the
  // manifest index, so nothing here is a number anybody chose.
  const attribute = (key: string): string | null =>
    layout.moduleIdOfPath(join(layout.repoRoot, key));

  const coverage = await refuseVacuousModulePopulation({
    prefix,
    manifestIndexPath: layout.manifestIndexPath,
    files: [...sources.keys()],
    moduleIdOf: attribute,
  });

  const result = checkPlatformSurface(
    {
      sources,
      files,
      surface,
      moduleIdOf: attribute,
      canonicalTargetOf,
      host,
      platformSourceRoot: repoKeyOf(platformRoot),
    },
    UNPUBLISHED_PLATFORM_REACHES,
  );

  // The floor that follows the sweep. Every module package's manifest is
  // rendered from the bare specifiers its sources import (`manifests:generate`),
  // so a package that declares the host and contributed no host reach means this
  // walk stopped reading them — which is exactly what happened, unseen, for two
  // batches. A manifest that will not parse is exit 2 and never a package
  // credited with declaring nothing (issue #113).
  const declarations: ModulePackageDeclaration[] = [];
  for (const root of layout.moduleRoots) {
    if (root.origin !== 'workspace-package' || root.moduleId === null) continue;
    const manifestPath = join(root.directory, 'package.json');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch (error: unknown) {
      console.error(
        `${prefix} ${manifestPath} could not be read (${String(error)}) — it is what says ` +
          'whether this package reaches the host, and a package credited with declaring ' +
          'nothing lowers the floor it belongs to',
      );
      process.exit(2);
    }
    const names = ['dependencies', 'peerDependencies'].flatMap((field) => {
      const block = manifest[field];
      return typeof block === 'object' && block !== null && !Array.isArray(block)
        ? Object.keys(block as Record<string, unknown>)
        : [];
    });
    declarations.push({ moduleId: root.moduleId, dependsOnHost: names.includes(hostName) });
  }
  const hostDependents = hostDependentCoverage(declarations, result.hostReachModules);

  if (listMode) {
    for (const finding of result.findings) {
      const tag =
        UNPUBLISHED_PLATFORM_REACHES[keyOf(finding)]?.symbols.includes(finding.symbol) === true
          ? 'LEDGERED'
          : 'REACH   ';
      console.log(
        `${tag} ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${finding.target}#${finding.symbol}  (${finding.kind})`,
      );
    }
    console.log('');
  }

  // What was read, beside what was found (issue #244). `files` is the module
  // sources opened; `sites` is the (specifier, symbol) reaches judged inside
  // them, which is the finer population and the one that moves when a barrel
  // changes. The two `sources=` derivations have different authors: the module
  // count comes from the generated manifest index, and the barrel count from
  // D-160.7's subpath list reconciled against the tree.
  reportReadSize({
    prefix,
    files: sources.size,
    sites: result.reaches,
    coverage: [
      coverage,
      {
        source: 'platform-barrels',
        expected: PUBLISHED_SUBPATHS.length,
        covered: surface.barrelsWithExports,
      },
      ...(hostDependents === null ? [] : [hostDependents]),
    ],
  });
  console.log(
    `${prefix} module reaches into unpublished platform surface=${result.findings.length} ` +
      `violations=${result.violations.length} ledgered=${result.ledgered.length} ` +
      `ledger-size=${Object.keys(UNPUBLISHED_PLATFORM_REACHES).length} ` +
      `stale=${result.staleKeys.length + result.staleSymbols.length}`,
  );

  if (result.violations.length > 0) {
    console.error(
      '\nA module reached platform surface the host does not publish (feature 080 §1,\n' +
        'D-160.8). Take the published symbol from the directory barrel, take the port\n' +
        'where the contract says the class is `O`, or repair the call site before the\n' +
        'module can be packaged — an `exports` map will refuse it at resolution time.\n',
    );
    for (const finding of result.violations) {
      console.error(
        `  - ${finding.file}:${finding.line}  [${finding.moduleId ?? '-'}] ` +
          `${remedyOf(finding)}  (${finding.kind})`,
      );
    }
  }
  if (result.staleKeys.length > 0) {
    console.error('\nStale ledger keys (no longer describe a reach — delete them):');
    for (const key of result.staleKeys) console.error(`  - ${key}`);
  }
  if (result.staleSymbols.length > 0) {
    console.error('\nStale ledger symbols (the reach no longer takes them — delete them):');
    for (const key of result.staleSymbols) console.error(`  - ${key}`);
  }

  const failed =
    result.violations.length > 0 ||
    result.staleKeys.length > 0 ||
    result.staleSymbols.length > 0;
  process.exit(failed ? 1 : 0);
}

// CLI only — importing this module (the unit self-test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
