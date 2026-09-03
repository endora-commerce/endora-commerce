/**
 * CI check — a module package's process singletons exist once (feature 080,
 * T061). **Repository-scope host** over the relocated analysis.
 *
 * The rule lives in `@endora-commerce/cli/rules/singleton-identity.js`
 * (`specs/101-endora-check/contracts/package-scope-layout.md` §6: one analysis,
 * two hosts) — its two conjuncts, both findings and its population walk. This
 * file derives this repository's consumer roots and its published module
 * packages, applies the #215 floor and holds `WHOLE_FILE_REACHES_ALLOWED`
 * below: a ledger is a statement about *this* tree's reaches and does not
 * travel. The forwarding specifier is **bare**, never a path into `dist`.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  checkSingletonIdentity,
  collectSingletonSources as walk,
  packagesInEntitiesRegistry,
  type ModulePackageSurface,
} from '@endora-commerce/cli/rules/singleton-identity.js';

import { refuseVacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

export * from '@endora-commerce/cli/rules/singleton-identity.js';

/**
 * Whole-file reaches into a module package's source that are right to stand.
 *
 * **Two-way**: a reach with no entry is a finding, and an entry that names no
 * reach is a `stale-allowance` finding. The key is `<file>:<target>` — line
 * independent, so moving the import does not need an edit here.
 *
 * Each entry says why the second copy is **right**, not that it is tolerated.
 */
export const WHOLE_FILE_REACHES_ALLOWED: Readonly<Record<string, string>> = {
  'backend/test/integration/blog/asset-reference-while-off.test.ts:packages/modules/blog/src/backend/index.ts':
    "composes `blog`'s own `registerModule` from source into a container of its own, to drive " +
    'the contribution half of its split boot hook in isolation (issue #146, D-67/D-68) — the ' +
    'published artefact composes into the harness container and cannot be re-composed there. ' +
    'The second copy is inert: the descriptor it contributes resolves references through SQL ' +
    'over the table `blog` owns (feature 077, D-87), so no entity class of the second copy ' +
    'ever reaches the ORM. Retires when the kernel offers a seam for composing one module ' +
    'twice, or when the contribution is readable without composing at all.',
  'backend/test/integration/cms/asset-reference-while-off.test.ts:packages/modules/cms/src/backend/index.ts':
    "the `cms` twin of the entry above, for the same boot-hook split and with the same reason: " +
    'the contributed descriptor resolves through SQL, so the second copy holds no ORM identity.',
  'backend/test/unit/blog/boot-hook-split.test.ts:packages/modules/blog/src/backend/index.ts':
    'the unit twin of the integration entry above (issue #146, D-68), and the artefact it ' +
    "shares the process with is the package's **root** export — the manifest, which " +
    '`manifest-index.generated.ts` imports and which is a descriptor the host reads and ' +
    'nobody mutates. Nothing behind `./backend` is loaded twice here: this test composes ' +
    "`blog` alone, over a stub `emFactory` that returns `{}`, so the second copy's entity " +
    'classes reach no ORM and its container is its own. Retires with the integration entry, ' +
    'on the same seam.',
  'backend/test/unit/cms/boot-hook-split.test.ts:packages/modules/cms/src/backend/index.ts':
    'the `cms` twin of the entry above, for the same boot-hook split and with the same reason: ' +
    'the artefact in the process is the root manifest, the composition is this test\'s own, and ' +
    'the stub `emFactory` means no entity class of the second copy reaches an ORM.',
};

/** Every directory a consumer of a module package's source can live in. */
function consumerRoots(layout: ModuleTreeLayout): string[] {
  const roots = [layout.applicationRoot];
  if (layout.platformRoot !== null) roots.push(layout.platformRoot);
  for (const root of layout.moduleRoots) {
    if (root.origin === 'workspace-package') roots.push(root.directory);
  }
  return roots.filter((root, index, all) => all.indexOf(root) === index);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout = await requireModuleLayout('[singleton-identity]');
  const packages: ModulePackageSurface[] = [];
  for (const [npmName, moduleId] of layout.modulePackageNames) {
    const root = layout.moduleRoots.find(
      (candidate) => candidate.origin === 'workspace-package' && candidate.moduleId === moduleId,
    );
    if (root === undefined) continue;
    packages.push({
      moduleId,
      npmName,
      root: relative(layout.repoRoot, root.directory).split(sep).join('/'),
    });
  }
  const files = consumerRoots(layout).flatMap((root) => walk(root));
  // #215's floor **first**, before every other refusal this check has. A tree
  // whose modules have moved out from under the walk fails all of them at once
  // — no module package is discovered either — and the first message wins, so
  // the order decides whether the author is told "the module tree moved" or
  // something downstream of that. It is also what
  // `test/unit/scripts/moved-module-tree.test.ts` reads.
  const moduleFiles = layout.moduleWalkRoots.flatMap((root) => walk(root));
  const modulePopulation = await refuseVacuousModulePopulation({
    prefix: '[singleton-identity]',
    manifestIndexPath: layout.manifestIndexPath,
    files: moduleFiles,
    moduleIdOf: layout.moduleIdOfPath,
  });
  if (packages.length === 0) {
    console.error(
      '[singleton-identity] this workspace declares no module package, so no module has a ' +
        'published artefact for a filesystem reach to duplicate — the rule has no subject; ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(relative(layout.repoRoot, file).split(sep).join('/'), readFileSync(file, 'utf8'));
  }
  const result = checkSingletonIdentity({ sources, packages }, WHOLE_FILE_REACHES_ALLOWED);
  if (result.singletons === 0) {
    console.error(
      `[singleton-identity] ${packages.length} module package(s) declare no composed ` +
        'singleton at all — no container registration and no entity class — so every reach ' +
        'into their sources reads clean whatever it names; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  if (result.unreadableChainParents.length > 0) {
    console.error(
      `[singleton-identity] ${result.unreadableChainParents.length} \`@TransitivelyScoped\` ` +
        'decorator(s) name a parent this walk cannot read, because the first argument is not a ' +
        `string literal — ${result.unreadableChainParents.join(', ')}. The chain-parent signal ` +
        'is exactly the set of those names, so an unreadable one is a subject silently missing ' +
        'from it; write the parent as a literal, or teach this check the shape. Refusing to ' +
        'report a population it could not name in full',
    );
    process.exit(2);
  }
  if (result.chainParentNames.length === 0) {
    console.error(
      '[singleton-identity] no `@TransitivelyScoped` decorator names a parent anywhere in the ' +
        'walk, so the chain-parent signal has no subject — a tenant chain is what makes a ' +
        'duplicated entity class a refusal rather than a silence; refusing to report a ' +
        'vacuous pass',
    );
    process.exit(2);
  }

  const npmNames = new Set(packages.map((pkg) => pkg.npmName));
  const registryPath = join(layout.srcRoot, 'db', 'entities-registry.generated.ts');
  let registryPackages: string[];
  try {
    registryPackages = packagesInEntitiesRegistry(readFileSync(registryPath, 'utf8'), npmNames);
  } catch (error: unknown) {
    console.error(
      `[singleton-identity] the generated entity registry at ${registryPath} could not be ` +
        `read (${String(error)}) — it is the independent derivation this walk is reconciled ` +
        'against; refusing to report a vacuous pass',
    );
    process.exit(2);
  }
  const derived = new Set(result.packagesWithEntities);
  const coverage: ReadCoverage[] = [
    modulePopulation,
    {
      source: 'entities-registry',
      expected: registryPackages.length,
      covered: registryPackages.filter((npmName) => {
        const pkg = packages.find((candidate) => candidate.npmName === npmName);
        return pkg !== undefined && derived.has(pkg.moduleId);
      }).length,
    },
    {
      source: 'tenant-chains',
      expected: result.chainParentNames.length,
      covered: result.resolvedChainParentNames.length,
    },
  ];

  if (listMode) {
    console.log(`[singleton-identity] ${packages.length} module package(s):`);
    for (const pkg of packages) console.log(`  - ${pkg.moduleId} (${pkg.npmName}) at ${pkg.root}`);
    console.log(
      `[singleton-identity] ${result.chainParentNames.length} tenant-chain parent(s), ` +
        `${result.chainParentSubjects.length} of them in a module package:`,
    );
    for (const subject of result.chainParentSubjects) {
      console.log(
        `  - ${subject.className} (${subject.moduleId}) at ${subject.file}, named by ` +
          subject.children.join(', '),
      );
    }
  }

  reportReadSize({
    prefix: '[singleton-identity]',
    files: files.length,
    sites: result.sites,
    coverage,
  });
  console.log(
    `[singleton-identity] packages=${packages.length} composed singletons=${result.singletons} ` +
      `ledger-size=${Object.keys(WHOLE_FILE_REACHES_ALLOWED).length} ` +
      `chain-parents=${result.chainParentSubjects.length}/${result.chainParentNames.length} ` +
      `violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      "\nA module package's process singletons must exist once. The platform composes the " +
        "package through its published artefact ('dist', via the bare specifier); a " +
        'filesystem path into the same package\'s source evaluates it a second time, and the ' +
        'second copy is empty rather than absent — a registry with no adapters, an entity the ' +
        'ORM never discovered, an `instanceof` that is false. Take the object from the ' +
        'composed container (`test/helpers/package-singletons.ts`) or the class from the ' +
        "package's published `entities` array (`test/helpers/package-entities.ts`); an " +
        '`import type` of the source is free, because it erases. For a ' +
        '`chain-parent-reach` the repair is usually the specifier itself: name the package\'s ' +
        '`dist` rather than its `src`, which is the module instance the composed platform ' +
        'already holds, and say in a comment why:',
    );
    for (const finding of result.findings) {
      const at = finding.line > 0 ? `:${finding.line}` : '';
      const binding = finding.binding === null ? '' : ` '${finding.binding}'`;
      console.error(
        `  - [${finding.kind}] ${finding.file}${at}${binding} <- ${finding.target}\n` +
          `      ${finding.why}`,
      );
    }
  }

  process.exit(result.findings.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
