/**
 * CI check — **the class vocabulary a design system publishes and the classes
 * packages render are reconciled, in both directions** (feature 110, T129b;
 * owner ruling **D-219**;
 * `specs/110-instance-repository/contracts/admin-stylesheet-composition.md` §3's
 * *"a module release renders a class the design system does not define"* row and
 * §7.1's two predicates).
 *
 * ## Why it exists, and why it is in D-219's own batch
 *
 * D-219 made **137 class names published package surface**, and a class name a
 * package publishes is something it owes semantic versioning on. The ruling
 * accepts that consequence and names this check as the mitigation *in the same
 * batch*, because both directions of the reconciliation were silent before it:
 *
 *   - a module renders `.b2b-something` that nothing defines — that element is
 *     unstyled in every instance, and no type-check, lint, build or test in this
 *     repository observes it. Tailwind emits no diagnostic for a class it does
 *     not recognise, CSS resolves an undefined selector to nothing, and the
 *     screen simply looks slightly wrong;
 *   - a design system defines a class nobody renders — dead published surface, a
 *     major version waiting for somebody to notice. T126 shipped 23 of them and
 *     T128 deleted them, and the measurement that put them there was a
 *     **substring** match. That is the defect this check makes impossible to
 *     repeat rather than periodic.
 *
 * No other instrument in this estate has a class token in its population:
 * `check:module-boundary` reads import specifiers and SQL tables,
 * `check:admin-zones` reads zone names and `useTranslation` scopes,
 * `i18n:hardcoded` reads JSX text and four attributes — none of which is
 * `className`'s value read as tokens — and `check:diacritic-folds` reads slug
 * construction.
 *
 * ## The populations, and both are derived
 *
 * **What defines** — every workspace package that declares `./theme.css`. The
 * ruling is deliberately stated as *the package every renderer already
 * declares*, so this check names no package: it reads the subpath off the
 * `exports` maps, which answers `@endora-commerce/admin-kit` today and would
 * answer `@endora-commerce/admin-shell` in the same run if the kit family folded
 * into it (D-100).
 *
 * **What renders** — the design system's **own hosts**: every package that
 * declares `./tailwind.css`, which is R2.2's population and therefore the exact
 * set whose classes the host compiles, plus the admin application's own source
 * roots. Two things fall out of that derivation rather than out of a list:
 * `@endora-commerce/cms-components` is excluded, because it declares
 * `./styles.css` and is R4.2's finished-stylesheet case whose every class is
 * `cmsc:`-prefixed; and the **storefront** is excluded, which matters because it
 * defines an unrelated `.b2b-cta` of its own and imports no admin stylesheet
 * (§7.3). Scoping by the `b2b-` prefix would have reported it; scoping by host
 * does not.
 *
 * ## The findings
 *
 * `undefined-render`, `unrendered-definition` and — a **finding and never a
 * skip** (issue #113) — `unresolvable-class`, a class name assembled from a
 * substitution inside a class attribute, which neither direction can be decided
 * for. Reading it as "some class is rendered" would excuse a definition and
 * reading it as "no class is rendered" would accuse a render; refusing it names
 * the one site whose spelling stops the reconciliation working.
 *
 * ## The two ledgers, and why neither is empty
 *
 * `UNDEFINED_CLASS_RENDERS` holds 24 renders standing today, each naming the
 * class and what the repair is; `UNRENDERED_CLASS_DEFINITIONS` holds the
 * definitions nothing renders, which D-219 says are *"recorded for a drain"*
 * rather than deleted, because unlike the shim they are part of a live
 * vocabulary. Both are two-way: an entry that no longer describes the tree is
 * `stale-ledger-entry`.
 *
 * Usage: `tsx scripts/check-class-vocabulary.ts [--list]`
 * Exit 0 = both directions reconcile; exit 1 = at least one finding;
 * exit 2 = the run could not see the population it judges — see
 * {@link vacuousReason}.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { UNDEFINED_CLASS_RENDERS } from './ledgers/undefined-class-renders.js';
import { UNRENDERED_CLASS_DEFINITIONS } from './ledgers/unrendered-class-definitions.js';
import { adminRegistryPathOf } from './lib/admin-surfaces.js';
import {
  checkClassVocabulary,
  type ClassVocabularyFinding,
} from './lib/class-vocabulary.js';
import { adminRegistryPresent, moduleAdminLayers } from './lib/module-admin-layers.js';
import { modulePopulationCoverage, vacuousModulePopulation } from './lib/module-population.js';
import { requireModuleLayout, type ModuleTreeLayout } from './lib/module-roots.js';
import { reportReadSize } from './lib/read-size.js';
import {
  declaresTailwindSources,
  THEME_STYLESHEET_SUBPATH,
} from './lib/tailwind-sources.js';
import { nodeWorkspaceFs, workspaceMembers } from './lib/workspace-packages.js';

const PREFIX = '[class-vocabulary]';

const PRUNED = new Set(['node_modules', 'dist', '.git', 'coverage', '.next']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Why this run must not report a pass, or `null`.
 *
 * Exit **2**, never 0 and never 1. Each entry is an input whose absence would
 * leave one or both directions vacuously clean rather than failing (issue #113).
 */
export function vacuousReason(input: {
  readonly designSystems: number;
  readonly definedClasses: number;
  readonly sourceFiles: number;
  readonly sites: number;
  readonly moduleAdminLayers: number | null;
}): string | null {
  if (input.designSystems === 0) {
    return (
      `no workspace package declares '${THEME_STYLESHEET_SUBPATH}', so there is no published ` +
      'design system for either direction to be about: every render would be undefined and no ' +
      'definition could be unrendered; refusing to report a vacuous pass'
    );
  }
  if (input.definedClasses === 0) {
    return (
      'a design system was read and its rule preludes named no class — with an empty ' +
      'vocabulary no namespace exists, so `undefined-render` can never fire and every ' +
      'definition is vacuously rendered; refusing to report a vacuous pass'
    );
  }
  if (input.sourceFiles === 0) {
    return (
      'the walk opened no source file, so every defined class would be reported unrendered ' +
      'for a reason that is about the walk rather than about the tree; refusing to report a ' +
      'vacuous pass'
    );
  }
  if (input.sites === 0) {
    return (
      'the walk opened source files and read no class-attribute position at all — a changed ' +
      'attribute or helper spelling would print a healthy `files=` beside a cheerful ' +
      '`findings=0` while the syntax walk was blind (issues #235/#237); refusing to report a ' +
      'vacuous pass'
    );
  }
  if (input.moduleAdminLayers === 0) {
    return (
      'the generated admin contribution registry is on disk and names no module package, so ' +
      'the render walk has no independent author and nothing corroborates the population it ' +
      'read; refusing to report a vacuous pass'
    );
  }
  return null;
}

function walk(directory: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      if (PRUNED.has(entry)) continue;
      walk(full, out);
      continue;
    }
    if (SOURCE_EXTENSIONS.some((extension) => entry.endsWith(extension))) out.push(full);
  }
  return out;
}

function isUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);
}

async function main(): Promise<void> {
  const listMode = process.argv.includes('--list');
  const layout: ModuleTreeLayout = await requireModuleLayout(PREFIX);
  const members = workspaceMembers(layout.repoRoot, nodeWorkspaceFs());
  const key = (file: string): string => relative(layout.repoRoot, file).split(sep).join('/');

  // What defines — read off the `exports` map, never off a package name.
  const stylesheets = new Map<string, string>();
  const designSystems: string[] = [];
  for (const member of members) {
    const exported = member.manifest['exports'];
    if (typeof exported !== 'object' || exported === null || Array.isArray(exported)) continue;
    const target = (exported as Record<string, unknown>)[THEME_STYLESHEET_SUBPATH];
    if (typeof target !== 'string') continue;
    designSystems.push(member.name);
    const path = join(member.dir, target.replace(/^\.\//, ''));
    if (!existsSync(path)) continue;
    stylesheets.set(key(path), readFileSync(path, 'utf8'));
  }

  // What renders — the design system's own hosts, in three derived parts.
  //
  // Every module the layout places, every **non-module** package that declares
  // `./tailwind.css` (R2.2's predicate — the kit, the shell and the page-builder
  // family), and the admin application's own source roots. Two exclusions fall
  // out of that rather than out of a list: `@endora-commerce/cms-components`,
  // which declares `./styles.css` and is R4.2's finished-stylesheet case, and
  // the **storefront**, which defines an unrelated `.b2b-cta` of its own and
  // loads no admin stylesheet (§7.3).
  //
  // The module half is `moduleWalkRoots` and not "module packages that declare
  // `./tailwind.css`", which would be the narrower and apparently tidier answer.
  // It is the wrong one: 16 of the 71 registered modules ship no admin layer and
  // therefore declare no such subpath, so the narrow walk produces no file for
  // them and issue #215's shared floor cannot tell that from a module tree that
  // moved. A module's backend sources carry no class attribute, so they cost the
  // judgement nothing and `sites` discloses exactly that.
  const familyDirectories = members
    .filter((member) => declaresTailwindSources(member) && !layout.modulePackageNames.has(member.name))
    .map((member) => join(member.dir, 'src'));
  const admin = await layout.adminSurfaces();
  const adminRoots = admin === null ? [] : admin.hostRoots;
  const hostFiles = [...layout.moduleWalkRoots, ...familyDirectories, ...adminRoots].flatMap(
    (root) => walk(root),
  );

  const sources = new Map<string, string>();
  for (const file of hostFiles) sources.set(key(file), readFileSync(file, 'utf8'));

  const registryPath = adminRegistryPathOf(members);
  const adminLayers = adminRegistryPresent(registryPath)
    ? moduleAdminLayers(layout, registryPath!)
    : null;

  const result = checkClassVocabulary({
    stylesheets,
    sources,
    unrendered: UNRENDERED_CLASS_DEFINITIONS,
    undefinedRenders: UNDEFINED_CLASS_RENDERS,
  });

  const moduleFiles = hostFiles.filter((file) => layout.moduleIdOfPath(file) !== null);

  const refusal =
    vacuousModulePopulation({
      registered: layout.registeredIds,
      files: moduleFiles,
      moduleIdOf: layout.moduleIdOfPath,
    }) ??
    vacuousReason({
      designSystems: designSystems.length,
      definedClasses: result.defined.size,
      sourceFiles: sources.size,
      sites: result.sites.length,
      moduleAdminLayers: adminLayers === null ? null : adminLayers.length,
    });
  if (refusal !== null) {
    console.error(`${PREFIX} ${refusal}`);
    process.exit(2);
  }

  if (listMode) {
    for (const name of designSystems) console.log(`DESIGN SYSTEM  ${name}`);
    for (const token of [...result.defined].sort()) {
      console.log(`${result.rendered.has(token) ? 'RENDERED ' : 'UNRENDERED'}  .${token}`);
    }
    console.log('');
  }

  reportReadSize({
    prefix: PREFIX,
    files: sources.size + stylesheets.size,
    sites: result.sites.length,
    coverage: [
      modulePopulationCoverage({
        registered: layout.registeredIds,
        files: moduleFiles,
        moduleIdOf: layout.moduleIdOfPath,
      }),
      // The design systems the `exports` maps declare against the stylesheets
      // this run actually opened. A subpath declared over a file that is not
      // there is the one way this check's defining half goes silently empty
      // while every other number stays healthy.
      {
        source: 'design-system',
        expected: designSystems.length,
        covered: stylesheets.size,
      },
      // The generated admin contribution registry's answer to *"which packages
      // ship admin code"* — a second program's, so a render walk that stopped
      // reaching a module's admin layer disagrees with it in the same run.
      // Omitted rather than printed `0/0` where the artefact is not on disk,
      // which `read-size.ts` refuses as `no-expectation`; a registry that is
      // there and names none is `vacuousReason`'s last refusal above.
      ...(adminLayers === null
        ? []
        : [
            {
              source: 'module-admin',
              expected: adminLayers.length,
              covered: adminLayers.filter((layer) =>
                hostFiles.some((file) => isUnder(resolve(file), resolve(layer.directory))),
              ).length,
            },
          ]),
    ],
  });

  console.log(
    `${PREFIX} design systems=${designSystems.length} defined=${result.defined.size} ` +
      `namespaces=${result.namespaces.size} rendered=${result.rendered.size} ` +
      `undefined-ledger=${Object.keys(UNDEFINED_CLASS_RENDERS).length} ` +
      `unrendered-ledger=${Object.keys(UNRENDERED_CLASS_DEFINITIONS).length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]`);
    for (const finding of result.findings.filter(
      (candidate: ClassVocabularyFinding) => candidate.kind === kind,
    )) {
      const where = finding.file === '' ? '' : `${finding.file}${finding.line === null ? '' : `:${finding.line}`} — `;
      console.error(`  - ${where}${finding.token}\n      ${finding.detail}`);
    }
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
