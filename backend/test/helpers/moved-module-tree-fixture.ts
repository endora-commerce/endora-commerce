import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISCOVERED_MANIFESTS } from '../../src/manifest-index.generated.js';
import { discoverModulePackages } from '../../scripts/lib/module-packages.js';
import { MANIFEST_INDEX_FILENAME } from '../../scripts/lib/module-roots.js';
import {
  adminUiPackages,
  nodeWorkspaceFs,
  workspaceMembers,
} from '../../scripts/lib/workspace-packages.js';

/**
 * A backend whose module tree has moved, with the residue left behind — the
 * fixture issue #215 is about.
 *
 * Every `check-*` script that walks `backend/src` guarded its walk with
 * `files.length === 0`, which cannot see the failure that actually happens.
 * When `src/modules` moves, the walk does not come back empty: it comes back
 * with the other 105 files — `src/kernel`, `src/db`, `src/http`, `src/apps` —
 * reads them, finds nothing wrong in them, and prints a clean line. Eight
 * checks did that at once, at the moment a repository is most disturbed.
 *
 * So the proof has to be a **tree**, not a value: the fixture is a real backend
 * layout with the module sources gone and everything else in place, and each
 * check is spawned against it the way CI spawns it. Every script derives its
 * scan root from its own location (`<script>/../src`), so a copy of `scripts/`
 * beside a copy of `src/` scans the fixture and nothing else — the idiom
 * `check-nul-bytes`' companion test uses, and the reason its exit-2 guard is
 * assertable as behaviour rather than as source text.
 *
 * **The manifest index is left readable on purpose.** A tree whose index moved
 * with it fails at the first import, which is a guard of its own but not the
 * interesting one; a *package split* regenerates the index and points it at the
 * new home, so the index answers "65 modules" while the walk answers "one".
 * That is the shape only a per-module floor can see, and it is the shape the
 * fixture stages: a generated index listing every real module id, over a tree
 * that holds the sources of none of them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..');
const REPO_ROOT = join(BACKEND_ROOT, '..');
const TSX = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');

/**
 * Directly under `src/`, minus `modules`. Named rather than filtered from a
 * listing so the fixture stages a **fixed** residue: a copy driven by
 * `readdirSync` would silently start including the module tree again the day
 * the exclusion stopped matching, and the fixture would go quietly green.
 */
const RESIDUE_ROOTS: readonly string[] = [
  'apps',
  'commands',
  'db',
  'events',
  'http',
  'kernel',
  // Feature 080, D-160.11's second half. `_lifecycle`'s **host half** stayed
  // here when the module merged into the platform package: its manifest
  // registry, its divergence reader, the five `module:*` commands, and
  // the re-export shims every consumer of a moved file still names. Three
  // spawned checks import one of those files as code — `check-port-dependencies`
  // takes the gating graph and the deactivation ledger, `check-action-route-permissions`
  // takes `resolvedManifestEntries` — so a fixture without this root dies at
  // module resolution and every proof under it fails for a reason that has
  // nothing to do with a moved module tree. It is host code and not a module's:
  // the module's own sources arrive with `copyPlatformPackage`.
  'lifecycle',
  'overlay',
  // Feature 080, T031. `_lifecycle/registered-manifests.ts` — kept by
  // `KEPT_MODULE` — imports the package discovery, so a fixture without this
  // root dies at module resolution and every proof under it fails for a reason
  // that has nothing to do with a moved module tree.
  'packages',
  'seeds',
  'tenancy',
];

/**
 * The one module directory the fixture keeps: its `services/` and its manifest.
 *
 * `check-port-dependencies` imports the deactivation ledger and the gating
 * graph as *code*, and three other checks import that script; without them the
 * spawn would die at module resolution and every proof would pass for the wrong
 * reason. Keeping one module also makes the fixture the harder case: the walk
 * is not merely short, it produces files for exactly one of the 65 registered
 * modules, so a floor that only asked "did any module turn up?" would still
 * report clean.
 *
 * **`manifest.ts` is kept too** (issue #216). A module directory without its
 * manifest is not a module directory any deployment could hold, and a check
 * whose population *is* the manifests — `check-lock-claims` reads the reason
 * strings and comments in them — then finds nothing for the kept module either.
 * Its control would refuse the population it is supposed to agree with, and the
 * refusal would prove nothing.
 */
export const KEPT_MODULE = '_lifecycle';

/**
 * Single files of other modules a spawned check imports as code.
 *
 * **Empty, and it drained rather than being emptied.** Two entries stood here.
 * `admin_roles/permission-inventory.ts` went when batch five packaged that
 * module: `check-action-route-permissions` reaches the gate-argument resolver
 * through `@endora-commerce/mod-admin-roles/backend`, which resolves through the
 * fixture's own scope directory — at the host's copy in the moved tree, which
 * stages no module package, and at the fixture's own in the split tree — so the
 * file arrives with the package rather than with a copy of one module's source.
 * `_i18n/services/error-translation.ts` went the same way when T040b packaged
 * `_i18n` — `check-error-translations` imports the routing table as *code* from
 * `@endora-commerce/mod-i18n/backend` now.
 *
 * The list stays because the property it encodes has not changed: a spawned
 * check that imports one application-tree module's file as code needs that file
 * copied in, and copying a whole module would stop the fixture being the hard
 * case. `_lifecycle` is the only module left in the application tree, and its
 * own files are copied above by name.
 */
const KEPT_MODULE_FILES: readonly string[] = [];

/**
 * The one i18n bundle the fixture keeps, and the reason it keeps exactly one.
 *
 * `check-error-translations` walks each module's `i18n/en.json` and
 * `i18n/pl.json`. With no bundle
 * at all the walk yields no `errors.*` key, and the check's *pre-existing*
 * guard already exits 2 on that — so the fixture would prove nothing about the
 * floor T010 added. With one routed module's bundle present, the old guard is
 * green (keys were written, findings can be computed) while seventeen of the
 * eighteen routed modules contributed nothing, which is the residue only a
 * per-module floor sees. It has to be a **routed** module, because its bundle
 * is what carries the `errors.*` keys.
 *
 * **Where that module's bundle lives is no longer part of the question, and
 * that is this function's second correction.** It read `'blog'` until batch one
 * packaged that module and the `cpSync` below threw ENOENT, taking all 73
 * proofs in `moved-module-tree.test.ts` with it. The repair then was to derive
 * the id — but it derived it by asking which routed module still kept a bundle
 * **under `backend/src/modules`**, which is a property the T040b sweep is in the
 * business of removing from every module in turn. `orders` was the last one,
 * and this file went red on `master` the day it moved: not "the fixture needs a
 * different module" but "the fixture cannot be built at all", every proof in
 * the file failing at import. So the derivation now asks only what it needs —
 * *which routed module ships a bundle* — and reads it from the module's **own
 * directory**, `dirname(manifestPath)`, which is what the boot reconciler joins
 * `bundlesDir` to and is therefore correct for an application module and a
 * package alike. The fixture writes it to `backend/src/modules/<id>/i18n`,
 * because that is where the fixture's own layout puts a module.
 */
interface KeptBundle {
  readonly moduleId: string;
  /** The real directory the bundle is copied *from*, wherever the module lives. */
  readonly sourceDirectory: string;
}

function routedModuleShippingABundle(): KeptBundle {
  for (const moduleId of routedModuleIds()) {
    const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === moduleId);
    if (entry === undefined) continue;
    const directory = join(dirname(entry.manifestPath), 'i18n');
    if (existsSync(join(directory, 'en.json'))) {
      return { moduleId, sourceDirectory: directory };
    }
  }
  throw new Error(
    '[moved-module-tree-fixture] no module that declares an error code ships an i18n bundle ' +
      'anywhere the manifest index can find one. The fixture needs one to stage ' +
      "check-error-translations' per-module shortfall; with none, its proof would pass on " +
      'the pre-existing empty-walk guard instead.',
  );
}

/**
 * Where the real index says the kept module's manifest is, relative to the
 * repository root — the address the stub reproduces inside the fixture.
 *
 * It moved twice and both moves broke this file, which is why it is derived.
 * T040b put `_lifecycle` at `backend/src/lifecycle/`, and D-160.11's second
 * half put it inside `@endora-commerce/platform` — where its manifest is
 * imported at the package's **built** file, so this path names `dist`. That is
 * not an accident of the fixture: the real generated index names it exactly
 * that way, because the host publishes no subpath that reaches inside it, and
 * `dirname(manifestPath)` is what every reader joins `bundlesDir` to.
 *
 * `copyPlatformPackage` stages `src` and `dist` whole, so both the module's
 * sources and this address exist in the fixture without a copy of their own.
 * The refusal below is the fixture's own #215: a kept module the fixture does
 * not hold makes the walk produce files for *no* registered module, which is
 * the state every proof in this file is trying to tell apart from a moved tree.
 */
function keptModuleManifestPath(): string {
  const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === KEPT_MODULE);
  const path = entry?.manifestPath ?? null;
  if (path === null || !path.startsWith(REPO_ROOT + sep)) {
    throw new Error(
      `[moved-module-tree-fixture] the generated index gives '${KEPT_MODULE}' no manifest ` +
        'inside this checkout, so the fixture cannot stage the one module whose sources it ' +
        'holds. Point KEPT_MODULE at a module this repository ships.',
    );
  }
  return path;
}

const KEPT_MODULE_MANIFEST_RELATIVE = relative(REPO_ROOT, keptModuleManifestPath())
  .split(sep)
  .join('/');

const KEPT_BUNDLE = routedModuleShippingABundle();

// ---------------------------------------------------------------------------
// Which modules a split fixture relocates — the selection, not the choice
// ---------------------------------------------------------------------------

/**
 * The modules the application tree still holds, in the order they were offered.
 *
 * The split fixture relocates a module by copying `backend/src/modules/<id>` and
 * deleting the original, so a candidate that has really become a package fails
 * the copy outright — `ENOENT … lstat backend/src/modules/<id>`, which took all
 * 73 proofs of `moved-module-tree.test.ts` with it the day `google_analytics`
 * moved. Answering that question here is what lets the caller offer a **pool**
 * rather than a roster: a member that leaves needs no edit, because it stops
 * being available in the same commit that makes it a real package, and
 * `createSplitModuleTreeFixture` copies every real module package anyway.
 */
export function modulesInTheApplicationTree(candidates: readonly string[]): readonly string[] {
  return candidates.filter((id) => existsSync(join(BACKEND_ROOT, 'src', 'modules', id)));
}

/** The module packages this repository really ships, filtered to registered ids. */
export function packagedModuleIds(): readonly string[] {
  return discoverModulePackages(REPO_ROOT)
    .filter((pkg) => DISCOVERED_MANIFESTS.some((entry) => entry.id === pkg.moduleId))
    .map((pkg) => pkg.moduleId);
}

/**
 * The modules `check:error-translations` requires a bundle from — the ones that
 * **declare** an operator-visible error code.
 *
 * Read off the generated manifest index, which is what the check's own floor
 * reads since feature 090's Phase 4 deleted the prefix chain. It was
 * `ERROR_TRANSLATION_KEYS`' distinct `moduleId` values, and that set carried
 * `core` — a bundle namespace, not a module — so the loop above silently skipped
 * it (`DISCOVERED_MANIFESTS` has no entry with that id) and the split fixture's
 * candidate pool was one module short of what the check actually asks for. It is
 * eighteen module ids now, all of them real.
 */
export function routedModuleIds(): readonly string[] {
  return DISCOVERED_MANIFESTS.filter(
    (entry) => (entry.manifest.errorCodes ?? []).length > 0,
  )
    .map((entry) => entry.id)
    .sort();
}

/**
 * How many modules must sit **outside** the application tree for the split
 * fixture to be staging anything.
 *
 * Several, not one: a single module outside `backend/src` would leave every
 * check's walk more than 98% inside the application tree, which is comfortably
 * inside the shape that made issue #215 possible in the first place — a walk
 * that comes back short, is read, and reports clean. Six is the number T040a
 * measured the estate against and it is the floor rather than the target; the
 * relocation pool above it is headroom, and the real module packages count
 * toward it, because "outside the application tree" is the property and
 * "relocated by this fixture" is only one way of getting there.
 */
export const MINIMUM_MODULES_OUTSIDE_THE_APPLICATION_TREE = 6;

export interface SplitRelocationPlan {
  readonly candidates: readonly string[];
  /** Of those, the ones `backend/src/modules` still holds. */
  readonly available: readonly string[];
  /** The ids this repository already ships as module packages. */
  readonly alreadyPackaged: readonly string[];
  readonly floor?: number;
}

/**
 * Which candidates a split fixture relocates, and the refusal when there are
 * not enough modules outside the application tree for the fixture to mean
 * anything.
 *
 * Pure and injected, so the refusal is provable without building a 120-second
 * fixture: the inputs enter above the decision rather than being values the
 * builder has already computed.
 */
export function planSplitRelocation(plan: SplitRelocationPlan): readonly string[] {
  const packaged = new Set(plan.alreadyPackaged);
  const available = new Set(plan.available);
  const relocate = plan.candidates.filter((id) => available.has(id) && !packaged.has(id));
  const floor = plan.floor ?? MINIMUM_MODULES_OUTSIDE_THE_APPLICATION_TREE;
  const outside = new Set([...relocate, ...plan.alreadyPackaged]);
  if (outside.size < floor) {
    throw new Error(
      `[moved-module-tree-fixture] the split tree would hold ${outside.size} module(s) outside ` +
        `the application tree and needs at least ${floor}. The relocation pool ` +
        `(${plan.candidates.join(', ') || 'empty'}) has ${relocate.length} member(s) left under ` +
        'backend/src/modules. Add free modules to it — ones no artefact under backend/scripts ' +
        'keys on their location — rather than lowering the floor: below it every check\'s walk ' +
        'is inside the application tree by so much that a check reading one root passes, which ' +
        'is the shape this fixture exists to refuse.',
    );
  }
  return relocate;
}

/**
 * Restore the pre-feature-111 shape: a `node_modules` borrowed from this
 * repository by symlink, so every **relative** first-party link inside it
 * re-roots in the real checkout.
 *
 * It exists for one caller — the red proof of {@link endoraSpecifierResolutions},
 * which cannot be written any other way: the escape is silent by construction,
 * so a fixture that escapes has to be *built* for the guard to have something
 * to go red over. The input enters at the top of the analysis (issue #130)
 * rather than as a value the guard normally computes.
 */
export interface BorrowedNodeModulesOption {
  readonly borrowNodeModules?: boolean;
}

export interface MovedModuleTreeOptions extends BorrowedNodeModulesOption {
  /**
   * What the stub index registers. Defaults to every real module id — the
   * moved tree. Pass the ids the fixture actually holds to get the **control**:
   * the same residue, the same spawn, a registry that agrees with it, and
   * therefore no exit 2. Without that pair a red proof only shows the check
   * failing, not that it fails *because* the population went missing.
   */
  readonly registeredIds?: readonly string[];
}

export interface MovedModuleTreeFixture {
  readonly root: string;
  /** Runs `backend/scripts/<script>` inside the fixture. */
  run: (script: string, args?: readonly string[]) => { status: number | null; output: string };
  cleanup: () => void;
}

/**
 * The same check, spawned the same way, over **this checkout**.
 *
 * The comparison contract § 4.1 asks for: a conditional predicate is vacuously
 * clean over a tree whose packages ship nothing findable, so an exit code is not
 * evidence for `check-bundle-pairing` and a **count** is — and the count worth
 * comparing against is the one the same script reports here, rather than a
 * re-derivation of it in a test, which would be a second author for a number
 * that has one.
 */
export function runCheckInThisCheckout(
  script: string,
  args: readonly string[] = [],
): { status: number | null; output: string } {
  const result = spawnSync(TSX, [join(BACKEND_ROOT, 'scripts', script), ...args], {
    encoding: 'utf8',
    cwd: BACKEND_ROOT,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * The manifest specifiers a fixture's generated index really emits, in order.
 *
 * Read out of the file the fixture wrote — the artefact the spawned checks
 * import — so the mixed-shape assertion in `moved-module-tree.test.ts` is about
 * what is on disk and not about the branch that decided it.
 */
export function manifestIndexSpecifiers(root: string): readonly string[] {
  const source = readFileSync(join(root, 'backend', 'src', MANIFEST_INDEX_FILENAME), 'utf8');
  return [...source.matchAll(/^import \{ manifest as manifest\d+.*? \} from '([^']+)';$/gm)].map(
    (match) => match[1]!,
  );
}

/** The real `activation` block of a registered module, or `undefined`. */
function realActivation(id: string): unknown {
  const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === id);
  return (entry?.manifest as { activation?: unknown } | undefined)?.activation;
}

/**
 * The real `errorCodes` declaration of a registered module, or `undefined`.
 *
 * Carried across for the same reason `activation` is, and it was measured the
 * same way (feature 090, Phase 4). `check-error-translations` derives its
 * population floor's **exclusion** from the modules that declare a code — a
 * module that declares none is not required to ship a bundle — so a stub that
 * dropped the field made every registered module excluded, which switched the
 * floor off entirely and left the check exiting 2 on "no manifest declares an
 * error code": a refusal with nothing to do with the residue, in place of the
 * residue refusal this fixture exists to prove.
 *
 * Only the codes are copied, not the `tokens` beside them: the floor and the
 * exclusion read `code` and nothing else, and copying a module's whole
 * declaration would make this stub a second copy of eighteen manifests.
 */
function realErrorCodes(id: string): readonly { code: string }[] | undefined {
  const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === id);
  const declared = (entry?.manifest as { errorCodes?: readonly { code: string }[] } | undefined)
    ?.errorCodes;
  return declared === undefined ? undefined : declared.map(({ code }) => ({ code }));
}

/** The stub the fixture puts where the generated index lives. */
function stubManifestIndex(ids: readonly string[], backendRoot: string): string {
  // Feature 080, T041a — the real generator emits `manifestPath` per entry and
  // `coreManifestEntries` refuses an entry without one, so a stub that omitted
  // it would kill every spawn at module resolution and each proof below would
  // fail for a reason that has nothing to do with a moved module tree. The
  // fixture writes the path the residue *would* have had: it is the moved
  // module's old address, which for this fixture is a directory that is
  // deliberately not there — and that is fine, because the refusal is about the
  // field being absent, never about the file being present. It is written here,
  // in a fixture whose job is to be a concrete layout, and not derived, so that
  // the stub keeps saying what a pre-move index said.
  // The kept module is the exception, and it has to be: its files are really
  // there, so an entry pointing at its pre-move address would leave the layout
  // unable to place them and every ledger keyed on where they are reading stale.
  const pathFor = (id: string): string =>
    (id === KEPT_MODULE
      ? join(backendRoot, '..', KEPT_MODULE_MANIFEST_RELATIVE)
      : join(backendRoot, 'src', 'modules', id, 'manifest.ts')
    )
      .split('\\')
      .join('/');
  return [
    '// Fixture stand-in for the generated manifest index.',
    '//',
    '// The ids are the real ones, read from the committed index when the fixture',
    '// was built, so the expected population tracks the tree rather than a list',
    '// typed out here. The manifests are otherwise inert: every consumer in this',
    '// fixture reads ids, and importing 65 real manifests would import 65 module',
    '// trees the fixture deliberately does not have.',
    '//',
    '// `activation` and `errorCodes` are carried across verbatim (issue #216,',
    '// feature 090 Phase 4). `lib/switchable-modules.ts` derives the locked set',
    '// from the first and two checks read it; `check-error-translations` derives',
    '// its floor exclusion from the second. A stub that dropped either made the',
    '// derived answer empty in the fixture, which is a state those checks are',
    '// right to refuse — so they exited 2 over the residue for a reason that had',
    '// nothing to do with the residue, and their controls exited 2 as well.',
    'export interface DiscoveredManifestEntry {',
    '  id: string;',
    '  manifestPath: string;',
    '  manifest: {',
    '    id: string;',
    '    name: string;',
    '    version: string;',
    '    dependencies: string[];',
    '    activation?: {',
    '      settingCode?: string;',
    '      default?: boolean;',
    '      nonDeactivatable?: boolean;',
    '      reason?: string;',
    '    };',
    '    errorCodes?: { code: string }[];',
    '  };',
    '}',
    '',
    'export const DISCOVERED_MANIFESTS: ReadonlyArray<DiscoveredManifestEntry> = [',
    ...ids.map((id) => {
      const activation = realActivation(id);
      const errorCodes = realErrorCodes(id);
      const tail =
        (activation === undefined ? '' : `, activation: ${JSON.stringify(activation)}`) +
        (errorCodes === undefined ? '' : `, errorCodes: ${JSON.stringify(errorCodes)}`);
      return (
        `  { id: '${id}', manifestPath: '${pathFor(id)}', ` +
        `manifest: { id: '${id}', name: '${id}', ` +
        `version: '1.0.0', dependencies: []${tail} } },`
      );
    }),
    '];',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// The fixture's own `@endora-commerce` scope — feature 111, Phase 1
// ---------------------------------------------------------------------------

/** The workspace scope every first-party package in this repository carries. */
const WORKSPACE_SCOPE = '@endora-commerce';

/**
 * The `node_modules` locations a fixture needs, `''` being the fixture root.
 *
 * The first is the real directory; the rest are symlinks to it, so there is one
 * scope in a fixture rather than three that can disagree. Node resolves a bare
 * specifier by walking up from the **importing** file, and the fixture's sources
 * sit under three roots whose walk never meets: `backend/`, `packages/modules/…`
 * (which reaches the fixture root) and `packages/platform/dist/…`.
 */
const FIXTURE_NODE_MODULES = [
  join('backend', 'node_modules'),
  'node_modules',
  join('packages', 'platform', 'node_modules'),
] as const;

/** Is `candidate` inside `dir`? Both absolute, both already real. */
function contains(dir: string, candidate: string): boolean {
  const within = relative(dir, candidate);
  return within !== '' && !within.startsWith('..') && !isAbsolute(within);
}

/**
 * The fixture's own `node_modules`, so a first-party specifier cannot leave it
 * (feature 111, FR-003; `contracts/split-fixture-package-naming.md` § 2).
 *
 * **The fixture used to borrow this repository's tree by symlink**, and the
 * consequence is issue #255 arriving inside the one instrument whose job is to
 * notice that a module is not where the registry says it is. Every link in
 * `backend/node_modules` is **relative** — `mod-blog -> ../../../packages/modules/blog`
 * — and a relative link is resolved against its own *real* directory, so
 * following the borrowed symlink re-roots every one of them in the **real
 * checkout**. Measured from `<fixture>/backend/src/`:
 * `@endora-commerce/mod-blog/package.json` answered
 * `<repo>/packages/modules/blog/package.json`. A fixture that claims to have
 * moved a module while every reader still finds it at its real address cannot
 * refuse anything: the check reads a complete package and reports clean, which
 * is the exact state the fixture exists to catch.
 *
 * So the scope is re-rooted rather than borrowed, and the construction is this
 * repository's own idiom one level finer — `scripts/setup-worktree.sh --link`
 * symlinks the third-party tree, which is identical on every branch, and gives
 * each workspace its own first-party links. Here:
 *
 *   1. one **absolute** symlink per top-level entry of the host's
 *      `backend/node_modules`, at that entry's realpath. Absolute, so a link
 *      that is relative in the host tree cannot re-root anywhere;
 *   2. except an entry whose realpath is a package of this checkout that the
 *      fixture has **staged**, which points at the fixture's copy.
 *
 * Both populations are `readdir`ed rather than written down (D-100), and (2) is
 * one rule applied uniformly: it happens to be the whole `@endora-commerce`
 * scope today because that is what this checkout's own packages are.
 *
 * Third-party packages stay borrowed, deliberately (FR-004). They are identical
 * on every branch, and re-installing them costs 1.3 GB and four seconds per
 * fixture instance against the milliseconds this takes.
 *
 * A package the fixture does **not** stage — the moved tree stages no module
 * package at all, by construction — keeps the host's copy, because a spawned
 * check that imports one as *code* would otherwise die at module resolution and
 * its proof would fail for a reason that is not the residue. The escape guard
 * knows the difference: {@link endoraSpecifierResolutions} judges only the
 * packages the fixture holds.
 */
function installFixtureNodeModules(root: string, borrowed: boolean): void {
  const hostModules = join(BACKEND_ROOT, 'node_modules');
  const [primary, ...aliases] = FIXTURE_NODE_MODULES;
  const primaryPath = join(root, primary);
  for (const location of FIXTURE_NODE_MODULES) {
    mkdirSync(dirname(join(root, location)), { recursive: true });
  }
  if (borrowed) {
    // The red proof's shape, and its only caller is the test that asserts the
    // guard goes red over it: the fixture exactly as it stood before Phase 1.
    for (const location of FIXTURE_NODE_MODULES) {
      symlinkSync(hostModules, join(root, location));
    }
    return;
  }
  const realCheckout = realpathSync(REPO_ROOT);
  const realRoot = realpathSync(root);
  /** Where the fixture's copy of a host package would be, or `null`. */
  const stagedCopyOf = (real: string): string | null => {
    if (!contains(realCheckout, real)) return null;
    const candidate = join(realRoot, relative(realCheckout, real));
    return existsSync(candidate) ? candidate : null;
  };
  const linkInto = (directory: string, from: string): void => {
    mkdirSync(directory, { recursive: true });
    for (const entry of readdirSync(from)) {
      const real = realpathSync(join(from, entry));
      symlinkSync(stagedCopyOf(real) ?? real, join(directory, entry));
    }
  };
  linkInto(primaryPath, hostModules);
  // The scope is a real directory rather than one of those links, so that its
  // members can be re-pointed one at a time.
  rmSync(join(primaryPath, WORKSPACE_SCOPE), { force: true });
  linkInto(join(primaryPath, WORKSPACE_SCOPE), join(hostModules, WORKSPACE_SCOPE));
  for (const alias of aliases) symlinkSync(primaryPath, join(root, alias));
}

/**
 * Every `@endora-commerce/*` specifier the fixture's own sources name, resolved
 * from inside the fixture (feature 111, FR-003; contract § 2.1).
 *
 * The population is derived from the files, not sampled and not listed: the
 * failure it guards is **silent** by construction, so a guard that checked one
 * specifier would agree with a tree in which every other one escaped.
 *
 * A specifier is judged only when the fixture **holds** the package it names,
 * and "holds" is read from the fixture's own staged `package.json` files rather
 * than from the derivation that built the links — two authors for one question,
 * so a builder that stopped staging something cannot also stop judging it.
 */
export type EndoraSpecifierVerdict =
  /** Resolved, and under the fixture root — what FR-003 asks for. */
  | 'inside'
  /** Resolved into another checkout. The failure this guard exists for. */
  | 'escaped'
  /**
   * Did not resolve, **and this checkout's own backend can reach it** — so the
   * fixture lost a link it should have. A failure, and reported apart from
   * `escaped` because the repair is a different one.
   */
  | 'unresolvable'
  /**
   * Did not resolve, and this checkout's backend cannot reach it either. Not a
   * fact about the fixture: `@endora-commerce/page-builder-admin` is named by a
   * module package's emitted admin layer and is a dependency of the **admin**,
   * so no `backend/node_modules` entry has ever existed for it — borrowed or
   * re-rooted. Disclosed rather than silently dropped, because a package that
   * stopped being reachable would otherwise leave the population quietly.
   */
  | 'unlinked';

export interface EndoraSpecifierResolution {
  readonly specifier: string;
  /** The fixture file that names it, repo-relative to the fixture root. */
  readonly from: string;
  readonly verdict: EndoraSpecifierVerdict;
  /** The resolved realpath, absolute; `null` when nothing resolved. */
  readonly target: string | null;
}

/** Source files a bare specifier can be written in. */
const SPECIFIER_BEARING_EXTENSIONS: readonly string[] = ['.ts', '.tsx', '.js', '.mjs', '.cjs'];

/**
 * Quoted `@endora-commerce/<name>[/subpath]` strings.
 *
 * Quoted, so a template literal's `@endora-commerce/mod-${id}` prefix — which
 * the estate writes seven times — is out of the population by construction
 * rather than by a filter, and a computed specifier is never resolved as if it
 * were a literal one.
 */
const ENDORA_SPECIFIER = /['"](@endora-commerce\/[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._/-]*)?)['"]/g;

/** Walk the fixture, skipping symlinks — a borrowed tree is not its sources. */
function fixtureSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      fixtureSourceFiles(join(dir, entry.name), out);
      continue;
    }
    if (SPECIFIER_BEARING_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** The package names the fixture itself declares — the independent author. */
function packagesTheFixtureHolds(root: string, dir: string, names: Set<string> = new Set()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      packagesTheFixtureHolds(root, join(dir, entry.name), names);
      continue;
    }
    if (entry.name !== 'package.json') continue;
    try {
      const { name } = JSON.parse(readFileSync(join(dir, entry.name), 'utf8')) as { name?: string };
      if (typeof name === 'string' && name.startsWith(`${WORKSPACE_SCOPE}/`)) names.add(name);
    } catch {
      // A staged manifest that will not parse is not a package the fixture can
      // be said to hold, and it is not this guard's finding either.
    }
  }
  return names;
}

/**
 * Where a bare specifier's **package** lands, walking up from `from` exactly as
 * node does; `null` when no ancestor carries it.
 *
 * Deliberately not `createRequire(...).resolve(...)`, and the reason was
 * measured rather than reasoned about: `tsx` patches `Module._resolveFilename`
 * with `tsconfig.base.json`'s `paths`, so under it
 * `@endora-commerce/contracts` answers this checkout's
 * `packages/contracts/src/index.ts` from **inside a fixture that holds its own
 * copy** — a false escape, and one whose colour would depend on which runner
 * the guard happened to be spawned from. `paths` is a fact about the host's
 * build configuration and about nothing in the fixture, and a guard whose
 * subject is a symlink has no business consulting it.
 *
 * The package directory is also the honest granularity for this question. What
 * issue #255 is about is which *checkout* a first-party link re-roots in; the
 * subpath decides which file inside that package, which is FR-001's question
 * and not this one's.
 */
function packageDirectoryFor(from: string, packageName: string): string | null {
  let directory = from;
  for (;;) {
    const candidate = join(directory, 'node_modules', ...packageName.split('/'));
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function endoraSpecifierResolutions(root: string): readonly EndoraSpecifierResolution[] {
  const realRoot = realpathSync(root);
  const held = packagesTheFixtureHolds(root, root);
  const seen = new Set<string>();
  const resolutions: EndoraSpecifierResolution[] = [];
  // Node answers a bare specifier from the nearest ancestor carrying a
  // `node_modules`, so two files under one such ancestor cannot disagree. That
  // is the deduplication key — resolving once per file would compute the same
  // answer tens of thousands of times.
  const baseOf = new Map<string, string>();
  const resolutionBase = (from: string): string => {
    const cached = baseOf.get(from);
    if (cached !== undefined) return cached;
    let directory = from;
    while (!existsSync(join(directory, 'node_modules')) && directory !== dirname(directory)) {
      directory = dirname(directory);
    }
    baseOf.set(from, directory);
    return directory;
  };
  for (const file of fixtureSourceFiles(root)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes(`${WORKSPACE_SCOPE}/`)) continue;
    const base = resolutionBase(dirname(file));
    for (const match of source.matchAll(ENDORA_SPECIFIER)) {
      const specifier = match[1] ?? '';
      const packageName = specifier.split('/').slice(0, 2).join('/');
      if (!held.has(packageName)) continue;
      const key = `${base}|${packageName}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const target = packageDirectoryFor(base, packageName);
      const reachableFromHost = packageDirectoryFor(BACKEND_ROOT, packageName) !== null;
      resolutions.push({
        specifier: packageName,
        from: relative(root, file).split(sep).join('/'),
        verdict:
          target !== null
            ? contains(realRoot, target)
              ? 'inside'
              : 'escaped'
            : reachableFromHost
              ? 'unresolvable'
              : 'unlinked',
        target,
      });
    }
  }
  return resolutions;
}

/**
 * The platform package, copied whole — manifest, `src` and `dist`.
 *
 * Three things need it and each fails differently without it. The residue
 * includes `backend/src/{kernel,http,tenancy,commands,events}`, which since the
 * relocation are re-export shims naming `packages/platform/dist/…`, so a check
 * that *imports* one — `check-entity-tenant-classification` reads the tenancy
 * decorators as code — dies at module resolution and its proof passes for the
 * wrong reason. `scripts/lib/platform-root.ts` finds the platform by its own
 * `endora: { type: 'platform' }` block over the workspace members, so a fixture
 * without the manifest has no platform root and the checks that refuse on
 * `null` refuse for the wrong reason. And `src` is what those checks walk.
 *
 * `dist` is a build artefact and may legitimately be absent in a fresh
 * checkout; the fixture refuses rather than staging a tree whose shims resolve
 * to nothing, because that failure is indistinguishable from a moved module
 * tree, which is the one thing this fixture exists to tell apart.
 */
function copyPlatformPackage(root: string): void {
  const source = join(REPO_ROOT, 'packages', 'platform');
  const built = join(source, 'dist');
  if (!existsSync(built)) {
    throw new Error(
      `${built} does not exist — the platform package is not built, and the residue's ` +
        're-export shims name it. Run `pnpm run build:packages`; without it every proof ' +
        'under this fixture would fail at module resolution rather than on what it measures.',
    );
  }
  const destination = join(root, 'packages', 'platform');
  mkdirSync(destination, { recursive: true });
  // The copied `dist` imports `@mikro-orm/core`, `fastify` and `awilix` by bare
  // specifier, and node resolves those by walking up from the *importing* file —
  // a path that never passes through `backend/`. That is why
  // `FIXTURE_NODE_MODULES` names this directory; the tree itself is installed
  // once, at the end, when the fixture knows which packages it holds.
  cpSync(join(source, 'package.json'), join(destination, 'package.json'));
  // `src` first and `dist` with the source's own timestamps, both (FR-011).
  // `emitted-freshness.ts` calls an artefact **stale** — exit 2 — when its
  // source is strictly newer, and `cpSync` stamps its copies with the moment it
  // made them, in `readdir` order: `dist` sorts before `src`, so a single
  // recursive copy of a package hands the estate a build that predates the
  // sources it was built from. Preserving the timestamps carries the real
  // relationship across instead of inventing one, so the fixture answers the
  // freshness question exactly as this checkout does.
  cpSync(join(source, 'src'), join(destination, 'src'), {
    recursive: true,
    preserveTimestamps: true,
  });
  cpSync(built, join(destination, 'dist'), { recursive: true, preserveTimestamps: true });
}

/**
 * The contracts package — `package.json`, `src` and, since feature 111,
 * `dist`.
 *
 * `src` is what `check-port-shape` walks. `dist` is what every *importer*
 * reads: the exports map names `./dist/index.js` and nothing else, and with the
 * scope re-rooted into the fixture the host's build is no longer reachable
 * through it. Without this the residue's own sources — and the platform's
 * `dist`, which imports contracts by bare specifier — die at module resolution
 * and every proof under them fails for a reason that is not the residue.
 */
function copyContractsPackage(root: string): void {
  const source = join(REPO_ROOT, 'packages', 'contracts');
  const built = join(source, 'dist');
  if (!existsSync(built)) {
    throw new Error(
      `${built} does not exist — the contracts package is not built, and this fixture's own ` +
        'scope directory resolves `@endora-commerce/contracts` to it. Run ' +
        '`pnpm run build:packages`; without it every proof under this fixture would fail at ' +
        'module resolution rather than on what it measures.',
    );
  }
  const destination = join(root, 'packages', 'contracts');
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'package.json'), join(destination, 'package.json'));
  cpSync(join(source, 'src'), join(destination, 'src'), {
    recursive: true,
    preserveTimestamps: true,
  });
  cpSync(built, join(destination, 'dist'), { recursive: true, preserveTimestamps: true });
}

export function createMovedModuleTreeFixture(
  options: MovedModuleTreeOptions = {},
): MovedModuleTreeFixture {
  // A repository, not a backend: `check-port-shape` walks
  // `<script>/../../packages/contracts/src`, so the fixture has to have the
  // level above `backend/` as well or that check dies on the contracts walk
  // instead of on the module one.
  const root = mkdtempSync(join(tmpdir(), 'moved-module-tree-'));
  const backend = join(root, 'backend');
  mkdirSync(backend, { recursive: true });
  // Without it tsx compiles the scripts as CommonJS and the ones using
  // top-level await die at transform time — a failure that looks like a red
  // proof and proves nothing.
  writeFileSync(
    join(backend, 'package.json'),
    `${JSON.stringify({ name: 'moved-module-tree-fixture', type: 'module', private: true }, null, 2)}\n`,
    'utf8',
  );
  // The fixture is a pnpm workspace (feature 080, T040a). The module roots are
  // derived from the globs — the application is the member holding the
  // generated index — so a fixture without this file is refused before a single
  // rule runs, which is a correct refusal for the wrong reason and would prove
  // nothing about the residue.
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - backend\n  - packages/*\n',
    'utf8',
  );
  cpSync(join(BACKEND_ROOT, 'scripts'), join(backend, 'scripts'), { recursive: true });
  copyApplicationTests(backend);
  copyContractsPackage(root);
  copyPlatformPackage(root);
  for (const directory of RESIDUE_ROOTS) {
    cpSync(join(BACKEND_ROOT, 'src', directory), join(backend, 'src', directory), {
      recursive: true,
    });
  }
  // Same reason as the two files above: a spawned check imports one of these as
  // *code*, so without it that spawn dies at module resolution and its proof
  // would pass for the wrong reason. They are single files of single modules, so
  // the fixture stays the hard case — the walk produces sources for a handful of
  // the modules the registry lists, never for all of them.
  for (const file of KEPT_MODULE_FILES) {
    mkdirSync(join(backend, 'src', 'modules', dirname(file)), { recursive: true });
    cpSync(join(BACKEND_ROOT, 'src', 'modules', file), join(backend, 'src', 'modules', file));
  }
  cpSync(
    KEPT_BUNDLE.sourceDirectory,
    join(backend, 'src', 'modules', KEPT_BUNDLE.moduleId, 'i18n'),
    { recursive: true },
  );
  writeFileSync(
    join(backend, 'src', MANIFEST_INDEX_FILENAME),
    stubManifestIndex(
      options.registeredIds ?? DISCOVERED_MANIFESTS.map((entry) => entry.id),
      backend,
    ),
    'utf8',
  );
  // Last, because which packages the fixture holds is read off what it staged.
  installFixtureNodeModules(root, options.borrowNodeModules ?? false);

  return {
    root,
    run: (script, args = []) => {
      const result = spawnSync(TSX, [join(backend, 'scripts', script), ...args], {
        encoding: 'utf8',
        cwd: backend,
      });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// ---------------------------------------------------------------------------
// The split tree — feature 080, T040a
// ---------------------------------------------------------------------------

/**
 * A backend whose modules live in **two** roots at once, which is every
 * intermediate state of the layout move.
 *
 * The fixture above proves the estate refuses a tree that moved. Refusing is
 * not following, and the difference is what decides whether T040b can be
 * incremental: because the population floor is per module, the *first* module
 * that leaves `backend/src/modules` reds every check that has one — the index
 * still registers it and no walk produces a file for it. So the discrimination
 * this fixture stages is the one the moved-tree fixture cannot make:
 *
 *   * **`packaged`** — the module is at `packages/modules/<id>/src`, and its
 *     directory is a workspace member declaring `endora: { type: 'module', id }`.
 *     The globs produce it, the root list covers it, the floor is satisfied by
 *     the union, and every check must report exactly what it reports on the
 *     one-root tree.
 *   * **`stranded`** — the module is at the same address with **no**
 *     `package.json`. Nothing declares it, so no glob produces it and no root
 *     covers it: the index registers a module the walk cannot see, which is the
 *     half-moved state, and every check must exit 2.
 *
 * The two differ by one file. That is deliberate — it is the narrowest thing
 * that can tell "the check follows both roots" from "the check happens to read
 * a tree that is all there".
 *
 * Unlike the moved-tree fixture this one is a **faithful copy** of the
 * repository's backend: every check here is expected to return its real verdict,
 * so it needs the real sources, the real ledgers and the real `package.json`
 * (`check-entry-scope` derives half its population from that file's `scripts`
 * block). What it stages is only where the modules sit.
 */
export interface SplitModuleTreeOptions extends BorrowedNodeModulesOption {
  /**
   * Candidates for relocation into a declared workspace package — a pool, and
   * every member of it that `backend/src/modules` still holds is relocated. One
   * that has meanwhile become a real package is skipped rather than refused;
   * see `planSplitRelocation`.
   */
  readonly packaged: readonly string[];
  /** Modules relocated into a directory nothing declares — the half-moved state. */
  readonly stranded?: readonly string[];
}

/** The workspace globs the fixture declares — the authority for what a member is. */
const SPLIT_WORKSPACE_GLOBS: readonly string[] = [
  'backend',
  // The admin is a member because `check-module-boundary`'s population includes
  // module-owned admin code (feature 091, FR-017) and the derivation that finds
  // it walks the workspace members for the one declaring a `"@/*"` tsconfig
  // path. See {@link copyAdminApplication}.
  'admin',
  // The documentation site is a member for the same reason, one feature over:
  // `check-module-docs`' population is the pages under the modules category, and
  // the site is derived from the workspace member holding a Docusaurus
  // configuration (feature 100). A fixture without it answers "no workspace
  // member holds a Docusaurus configuration" — true of the fixture, and silent
  // about the module tree, which is what this file exists to measure. See
  // {@link copyDocumentationSite}.
  'docs',
  'packages/*',
  'packages/modules/*',
];

/**
 * Where a relocated module's sources land, relative to the fixture root.
 *
 * `packages/modules/<id>/src` is not written into the check estate anywhere —
 * D-100 — it is written *here*, because a fixture's job is to be a concrete
 * layout. The estate finds it through the workspace globs above.
 */
function packagedModulePath(id: string): string {
  return join('packages', 'modules', id);
}

/** Every `.ts` file under `dir`. */
function typeScriptFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) typeScriptFilesUnder(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Re-point the relative specifiers of a module that has just been relocated.
 *
 * A module's own internal specifiers (`./services/x.js`) are untouched — they
 * travel with it. One that **escapes** the module directory named a platform
 * file at a depth that is now wrong: `packages/modules/<id>/src` happens to sit
 * exactly as deep as `backend/src/modules/<id>`, so `../../kernel/index.js`
 * still *resolves* and resolves to `packages/modules/kernel/index.js` — a
 * directory that does not exist and, worse, one every module walk reads as a
 * module called `kernel`. Left alone it turns this fixture into a report about a
 * defect it invented.
 *
 * In the real move those specifiers become bare host-package ones, which is
 * T042a's deliverable and does not exist yet; here they are re-pointed at the
 * same file through its new relative distance, which is the same edge with the
 * same owner. The rewrite is the ~20 lines the F4 spike measured, and it is a
 * property of the fixture rather than of the check estate.
 */
function repointEscapingSpecifiers(root: string, id: string): void {
  const oldPrefix = `backend/src/modules/${id}`;
  const newPrefix = `${packagedModulePath(id)}/src`.split('\\').join('/');
  for (const file of typeScriptFilesUnder(join(root, newPrefix))) {
    const within = relative(join(root, newPrefix), file).split('\\').join('/');
    const oldDir = posix.dirname(posix.join(oldPrefix, within));
    const newDir = posix.dirname(posix.join(newPrefix, within));
    const source = readFileSync(file, 'utf8');
    const rewritten = source.replace(/'(\.[^']*)'/g, (whole, specifier: string) => {
      const target = posix.normalize(posix.join(oldDir, specifier));
      if (target === oldPrefix || target.startsWith(`${oldPrefix}/`)) return whole;
      const repointed = posix.relative(newDir, target);
      return `'${repointed.startsWith('.') ? repointed : `./${repointed}`}'`;
    });
    if (rewritten !== source) writeFileSync(file, rewritten, 'utf8');
  }
}

/**
 * The bare specifier the fixture's index names a module by, or `null` when the
 * fixture staged no package it could name (feature 111, FR-001; contract § 1).
 *
 * **Derived from what the fixture staged, never from a list.** The question the
 * table in § 1 asks is *"did the fixture put a package with an `exports` map
 * here?"*, and the answer is on disk by the time the index is written — the
 * relocation, the stranding and the copy of every real module package have all
 * run. So a module that becomes a package for real changes this answer by
 * existing, and nothing here has to be edited (D-100).
 *
 * The two subpaths are the ones the specifier depends on and both are required:
 * `"."` is where `import { manifest }` lands, and `"./package.json"` is what
 * `resolveManifestPath` resolves to get the module's own directory — R1 makes it
 * mandatory for exactly that reason, and a package without it would throw at the
 * index's first import.
 *
 * A **relocated** module fails this test because the fixture writes it a
 * `package.json` with no `exports` at all, and a **stranded** one because the
 * fixture withheld the file. Both then keep a relative specifier, which is what
 * § 1 asks for and what a half-finished `git mv` really leaves.
 */
function stagedPackageSpecifier(root: string, id: string): string | null {
  const manifestFile = join(root, packagedModulePath(id), 'package.json');
  if (!existsSync(manifestFile)) return null;
  let declared: { name?: unknown; exports?: unknown };
  try {
    declared = JSON.parse(readFileSync(manifestFile, 'utf8')) as { name?: unknown; exports?: unknown };
  } catch {
    return null;
  }
  const { name, exports } = declared;
  if (typeof name !== 'string' || typeof exports !== 'object' || exports === null) return null;
  const subpaths = exports as Record<string, unknown>;
  if (subpaths['.'] === undefined || subpaths['./package.json'] === undefined) return null;
  return name;
}

/** The index, rewritten so a relocated module's manifest still resolves. */
function splitManifestIndex(root: string): string {
  const ids = DISCOVERED_MANIFESTS.map((entry) => entry.id);
  // Computed from the two paths rather than written as a shape, because the
  // index moved out of the module tree with T040b (D-160.3) and every one of
  // these specifiers is relative to wherever it sits.
  const indexDirectory = posix.join('backend', 'src');
  const relativeTo = (target: string): string => {
    const specifier = posix.relative(indexDirectory, target);
    return specifier.startsWith('.') ? specifier : `./${specifier}`;
  };
  const specifierOf = (id: string): string => {
    const bare = stagedPackageSpecifier(root, id);
    if (bare !== null) return bare;
    // The kept module is neither: it lives inside the platform package and its
    // manifest is imported at that package's built file, exactly as the real
    // index imports it (D-160.11). The address is the real one, rebased on the
    // fixture root by being repository-relative already.
    if (id === KEPT_MODULE) return relativeTo(KEPT_MODULE_MANIFEST_RELATIVE);
    const packageAddress = packagedModulePath(id).split(sep).join('/');
    // Sources at a package address that the test above did not name: a
    // relocated module, or a stranded one whose `package.json` was withheld.
    if (existsSync(join(root, packagedModulePath(id), 'src', 'manifest.ts'))) {
      return relativeTo(posix.join(packageAddress, 'src', 'manifest.js'));
    }
    return relativeTo(posix.join(indexDirectory, 'modules', id, 'manifest.js'));
  };
  return [
    '// Fixture stand-in for the generated manifest index, over a split tree.',
    '//',
    '// The entry array is the real one; only the specifiers move. The ids are',
    '// read off the entries rather than off the specifiers precisely so that',
    '// this rewrite changes nothing about which modules are registered.',
    '//',
    '// A module the fixture staged as a **package with an `exports` map** is',
    '// named by a **bare** specifier, exactly as the real generator names it',
    '// (D-149); a **relocated** or **stranded** module keeps a relative one',
    '// (feature 111, FR-001; `contracts/split-fixture-package-naming.md` § 1).',
    '// The mixed result is the design and not a transitional state — the tree',
    '// this fixture models was mixed for the whole of F4.',
    '//',
    '// What the spelling decides is the **anchor**, not the address:',
    '// `resolveManifestPath` answers a bare specifier with the resolved',
    '// `package.json` and a relative one with the manifest module file, and every',
    '// package-root asset — `i18n/`, `docs/` — is found by joining a manifest',
    '// declaration to `dirname(manifestPath)`. With a relative specifier that',
    '// anchor was `<pkg>/src`, so this fixture staged `docs/` a second time',
    '// underneath it and `check-bundle-pairing` read one module as shipping',
    '// bundles and 70 as shipping none — a conditional predicate reporting a tree',
    '// it could not see as clean.',
    '//',
    '// The bare spelling is safe here only because the fixture owns its',
    '// `@endora-commerce` scope (Phase 1): borrowed, the same specifier answered',
    '// the **real checkout**, and every reader would have found a complete module',
    '// at the address this fixture claims it has moved away from.',
    '//',
    '// `manifestPath` is resolved by the real helper (feature 080, T041a), so',
    '// this stub answers the location question the way the artefact does — and',
    '// so a relocated module whose sources did not travel is a throw here rather',
    '// than an i18n directory nobody looks at.',
    "import { resolveManifestPath } from './manifest-locations.js';",
    ...ids.map((id, index) => `import { manifest as manifest${index} } from '${specifierOf(id)}';`),
    'export const DISCOVERED_MANIFESTS = [',
    ...ids.map(
      (id, index) =>
        `  { id: '${id}', manifest: manifest${index}, ` +
        `manifestPath: resolveManifestPath(import.meta.url, '${specifierOf(id)}') },`,
    ),
    '];',
    '',
  ].join('\n');
}

/**
 * The documentation site, as `check-module-docs` reads it (feature 100).
 *
 * Copied whole rather than stubbed, for `copyAdminApplication`'s reason: the
 * check's population is the pages under the modules category and its second
 * author is the committed sidebar fragment, so a synthetic site would prove that
 * the check can read a synthetic site. The build outputs are left behind —
 * nothing here builds the site, and `.docusaurus` is a cache of a previous run.
 */
function copyDocumentationSite(root: string): void {
  const source = join(REPO_ROOT, 'docs');
  const destination = join(root, 'docs');
  mkdirSync(destination, { recursive: true });
  for (const file of ['package.json', 'docusaurus.config.js', 'sidebars.js', 'sidebars.modules.generated.js']) {
    cpSync(join(source, file), join(destination, file));
  }
  cpSync(join(source, 'docs'), join(destination, 'docs'), { recursive: true });
}

/**
 * The page-builder packages, as `check-block-names` reads them (feature 096).
 *
 * They are members for `copyAdminApplication`'s reason, one feature over: the
 * check's renderer-map population is the workspace members that declare one, and
 * without these four the fixture answers *"this repository renders eleven of its
 * 74 declared blocks"* — 63 `declared-without-renderer` findings, an exit 1, and
 * a red that has nothing to do with where the **modules** are, which is what
 * this file exists to measure.
 *
 * Copied whole rather than stubbed, for the same reason as the other two: a
 * synthetic renderer map would prove that the check can read a synthetic
 * renderer map. 1.4 MB across the four, less than the admin application this
 * fixture already carries. `packages/*` already globs them, so the workspace
 * needs no new entry.
 */
/**
 * One workspace package, staged as `package.json`, `src` and — where it has one
 * — `dist`.
 *
 * `src` first and `dist` after it, both with the source's own timestamps
 * (FR-011): `emitted-freshness.ts` calls an artefact **stale**, which is exit 2,
 * when its source is strictly newer, and `cpSync` stamps its copies with the
 * moment it made them in `readdir` order, where `dist` sorts before `src`.
 *
 * **Staging the build is not optional even for a package no check walks**
 * (feature 111, FR-003). With the fixture's `@endora-commerce` scope re-rooted
 * into itself, a package staged without its build is one the fixture *holds*
 * and cannot *resolve*: the exports map names `./dist/...` and the host's copy
 * is no longer reachable through it. `cms`' manifest imports
 * `page-builder-core/dist/types/responsive.js`, and every check that reads the
 * manifest index died there. It changes no walk — every module walk in the
 * estate skips `dist` by name.
 *
 * **Staged once.** Two derivations name `@endora-commerce/page-builder-admin`
 * (the page-builder family below, and the admin-ui family the workspace
 * declares), and copying a package twice would re-stamp its `src` after its
 * `dist` and hand the estate the `stale-artefact` this function's copy order
 * exists to prevent.
 */
function stageWorkspacePackage(root: string, source: string): void {
  const destination = join(root, relative(REPO_ROOT, source));
  if (existsSync(join(destination, 'package.json'))) return;
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'package.json'), join(destination, 'package.json'));
  cpSync(join(source, 'src'), join(destination, 'src'), {
    recursive: true,
    preserveTimestamps: true,
  });
  const built = join(source, 'dist');
  if (existsSync(built)) {
    cpSync(built, join(destination, 'dist'), { recursive: true, preserveTimestamps: true });
  }
}

function copyPageBuilderPackages(root: string): void {
  for (const name of ['cms-components', 'email-components', 'page-builder-core', 'page-builder-admin']) {
    stageWorkspacePackage(root, join(REPO_ROOT, 'packages', name));
  }
}

/**
 * The admin-ui workspace family, as `check-admin-zones` and
 * `check-admin-surface` read it (feature 091; feature 111, FR-007).
 *
 * Both checks refuse a workspace with no kit, and each refuses it in its own
 * words: `check-admin-surface` because *"nothing in this repository publishes an
 * admin surface and every reach would read as unpublished"*, `check-admin-zones`
 * because its kit-namespace population — R6 of `admin-kit-surface.md`, module
 * knowledge inside the kit — has no subject. Measured on the split fixture
 * before this existed: both exited 2, over a tree that holds every module
 * package's `src/admin` and the whole admin application. The refusals were
 * correct and were about the **fixture**, which is the state
 * `contracts/split-fixture-package-naming.md` § 6 is about: a check that cannot
 * be spawned here records that its population is not the module tree, while its
 * own source says it is.
 *
 * **The family is derived, never listed** (D-100): a member declares
 * `endora: { type: 'admin-ui' }` about itself, and `adminUiPackages` is the same
 * derivation both checks use, so a third member changes this answer by existing.
 * Today it is `packages/admin-kit` and `packages/page-builder-admin`, and the
 * second is already staged as part of the page-builder family — hence the
 * stage-once rule above rather than a subtraction written here.
 *
 * The **split** fixture alone, deliberately. The moved fixture is a backend with
 * no admin application at all, so neither check reaches its kit population, and
 * each stops earlier in its own words — measured: `check-admin-surface` on the
 * admin source root the `"@/*"` alias would have declared, `check-admin-zones`
 * on a walk that found neither a zone render nor a contribution. Both are facts
 * about that fixture's shape and not about a moved module tree, and staging the
 * kit there would change neither answer. Whether either check *discriminates*
 * over a moved tree is its author's question and § 7 leaves it open. ~2.9 MB.
 */
function copyAdminUiPackages(root: string): void {
  const family = adminUiPackages(workspaceMembers(REPO_ROOT, nodeWorkspaceFs()));
  if (family.length === 0) {
    throw new Error(
      '[moved-module-tree-fixture] no workspace member declares `endora: { type: "admin-ui" }`, ' +
        'so the fixture cannot stage the population `check-admin-zones` and ' +
        '`check-admin-surface` refuse without. Both would exit 2 over every tree this file ' +
        'builds, which asserts no discrimination at all.',
    );
  }
  for (const member of family) stageWorkspacePackage(root, member.dir);
}

/**
 * The application's own test tree (feature 111, FR-006).
 *
 * `check-test-ownership`'s population is the union of `backend/test` and the
 * module packages' own tests, and it floors both addends separately — a union
 * whose addends are not separately floored reports the half that went to zero as
 * clean. Measured on the split fixture before this existed: exit 2 on *"the walk
 * opened no test file under `backend/test/`"*, so the check could be spawned
 * here and could never reach a verdict.
 *
 * It is the second population `check-singleton-identity` reads as well — its
 * consumer walk is the whole application member, `backend/scripts` and
 * `backend/test` included — and that is where this staging stops being a
 * convenience: two of `WHOLE_FILE_REACHES_ALLOWED`'s entries name
 * `backend/test/unit/{blog,cms}/boot-hook-split.test.ts`, and staleness is
 * judged only in the tree that holds the file. Without a test tree those two
 * entries were *skipped* here, so the fixture agreed with a ledger it could not
 * read; with one they are judged, and § 4.3's assertion becomes a statement
 * about the repository rather than about the fixture's gap.
 *
 * Copied whole rather than filtered: a check that walks this root walks all of
 * it, and a fixture that staged the files somebody thought were relevant would
 * be staging a third thing that neither CI nor a developer's machine ever runs.
 * 16 MB and ~50 ms, against the 81 MB the fixture already carries.
 */
function copyApplicationTests(backend: string): void {
  cpSync(join(BACKEND_ROOT, 'test'), join(backend, 'test'), { recursive: true });
}

/**
 * The admin application, copied whole — manifest, tsconfig and `src`
 * (feature 091, FR-017).
 *
 * `check-module-boundary`'s population now includes module-owned admin code,
 * and its ledger holds 72 entries keyed on files under `admin/src/modules`. A
 * fixture that copies this repository's `backend/scripts` — which is where the
 * ledger lives — and no admin therefore stages a tree in which every one of
 * those entries describes a file the walk never opened. Measured on the split
 * fixture before this existed: one `misfiled` entry (`warehouses` is
 * `inventory`'s surface directory, and with no admin layout to say so the
 * attribution falls back to the directory name) and 71 stale ones, so the check
 * exited 1 for a reason that has nothing to do with where the *modules* are.
 *
 * Three files are what the derivation needs and all three are load-bearing:
 * `tsconfig.json` declares the `"@/*"` alias the admin source root comes from,
 * `package.json` makes the directory a workspace member the search reaches, and
 * `src` holds the route table, the nav and the surface directories. 4.8 MB,
 * about the same as the platform package this fixture already carries.
 */
function copyAdminApplication(root: string): void {
  const source = join(REPO_ROOT, 'admin');
  const destination = join(root, 'admin');
  mkdirSync(destination, { recursive: true });
  cpSync(join(source, 'package.json'), join(destination, 'package.json'));
  cpSync(join(source, 'tsconfig.json'), join(destination, 'tsconfig.json'));
  cpSync(join(source, 'src'), join(destination, 'src'), { recursive: true });
}

export function createSplitModuleTreeFixture(
  options: SplitModuleTreeOptions,
): MovedModuleTreeFixture {
  const root = mkdtempSync(join(tmpdir(), 'split-module-tree-'));
  const backend = join(root, 'backend');
  mkdirSync(backend, { recursive: true });
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:\n${SPLIT_WORKSPACE_GLOBS.map((glob) => `  - ${glob}`).join('\n')}\n`,
    'utf8',
  );
  // The checkout's own manifest, and it is load-bearing for one reason: a
  // relocated module that is **not** a declared package has no `package.json`
  // above it until this one, so node reads its sources as CommonJS and the
  // manifest index fails to import them. The stranded case has to fail because
  // nothing declares the module, not because tsx compiled it in the other
  // module system.
  writeFileSync(
    join(root, 'package.json'),
    `${JSON.stringify({ name: 'split-module-tree-fixture', type: 'module', private: true }, null, 2)}\n`,
    'utf8',
  );
  // The real manifest, not a stub: `check-entry-scope`'s second population
  // source is this file's `scripts` block, and a fixture without it exits 2 for
  // a reason that has nothing to do with where the modules are.
  cpSync(join(BACKEND_ROOT, 'package.json'), join(backend, 'package.json'));
  cpSync(join(BACKEND_ROOT, 'scripts'), join(backend, 'scripts'), { recursive: true });
  cpSync(join(BACKEND_ROOT, 'src'), join(backend, 'src'), { recursive: true });
  copyApplicationTests(backend);
  copyContractsPackage(root);
  copyPlatformPackage(root);
  copyAdminApplication(root);
  copyDocumentationSite(root);
  copyPageBuilderPackages(root);
  copyAdminUiPackages(root);

  const relocate = (id: string, declared: boolean): void => {
    const from = join(backend, 'src', 'modules', id);
    const to = join(root, packagedModulePath(id));
    cpSync(from, join(to, 'src'), { recursive: true });
    rmSync(from, { recursive: true, force: true });
    repointEscapingSpecifiers(root, id);
    if (!declared) return;
    writeFileSync(
      join(to, 'package.json'),
      `${JSON.stringify(
        {
          name: `@endora-commerce/mod-${id.replace(/_/g, '-')}`,
          version: '1.0.0',
          private: true,
          type: 'module',
          endora: { type: 'module', id, platform: '0.x' },
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
  };

  // Modules this repository has **already** moved (feature 080, T040b). They
  // are not under `backend/src` for `cpSync` to have brought over, so without
  // this the stub index below would import a manifest from a directory the
  // fixture does not hold and every proof would die at module resolution. They
  // are copied whole rather than `src`-only, because a package keeps its `i18n/`
  // bundles beside `src/` and `check-error-translations` walks them.
  //
  // **`dist` travels with them, and it did not until the fourth package**
  // (`credit_limits`, which publishes a `./ports`). D-171 designates a subpath
  // contract surface iff its **emitted** module exports no runtime binding, and
  // a subpath whose emitted module cannot be read is a *refusal* — exit 2 —
  // never an exemption, which is the one direction a silence must not go. So a
  // fixture that copied a package's sources and dropped its build handed
  // `check-module-boundary` a package it could not classify, and the split tree
  // went red for a defect it had introduced. Copying `dist` costs little and
  // makes the fixture what it claims to be: this repository's packages, where
  // this repository's layout move would put them. It changes no walk — every
  // module walk skips `dist` by name (`module-roots.ts`, and the package walk in
  // `check-module-boundary.ts`), which is why the real tree's numbers do not
  // move for having one.
  const alreadyPackaged = discoverModulePackages(REPO_ROOT).filter((pkg) =>
    DISCOVERED_MANIFESTS.some((entry) => entry.id === pkg.moduleId),
  );
  for (const pkg of alreadyPackaged) {
    const staged = join(root, packagedModulePath(pkg.moduleId));
    // Everything but the build first, then the build, and both with the real
    // timestamps (FR-011). `emitted-freshness.ts` calls an artefact **stale** —
    // exit 2 — when its source is strictly newer, and a single recursive copy
    // stamps its files with the moment it made them in `readdir` order, where
    // `dist` sorts before `src`. That would hand the estate a build that
    // predates the sources it was built from, intermittently, in a fixture 22
    // proofs rest on — the one failure mode that teaches a reader to re-run
    // rather than to read. Preserving the timestamps carries the real
    // relationship across instead of inventing one, so a package that really is
    // stale in this checkout is reported here too, and one that is not is not.
    const built = join(pkg.dir, 'dist');
    cpSync(pkg.dir, staged, {
      recursive: true,
      preserveTimestamps: true,
      filter: (source) =>
        !source.endsWith(`${sep}node_modules`) && source !== built && !contains(built, source),
    });
    if (existsSync(built)) {
      cpSync(built, join(staged, 'dist'), { recursive: true, preserveTimestamps: true });
    }
    // **`i18n/` and `docs/` need no staging of their own**, and that is feature
    // 111 Phase 2's result rather than an omission. Both are package-root assets
    // — located by joining a manifest declaration to `dirname(manifestPath)` —
    // and the copy above brings them across with the rest of the package, so a
    // reader anchored at the package root finds them where the real tree has
    // them.
    //
    // This block used to stage `docs/` a **second** time at `<pkg>/src/docs`,
    // because a relative specifier put the anchor at the package's `src/`. That
    // was the fixture compensating for its own spelling, and the compensation
    // only ever covered one of the two assets: `check-bundle-pairing` read 1
    // module as shipping bundles and 70 as shipping none over this tree, which
    // its conditional predicate reported as clean. The anchor is the package
    // root now (`splitManifestIndex`), so both assets are found at one address
    // and a fixture holding a package's pages at two of them — which can agree
    // with a check that looks at either — is gone with the workaround.
  }

  // `options.packaged` is a **pool**, not a roster: a candidate this repository
  // has meanwhile packaged for real is carried by the loop above, at the same
  // address and with its own real `package.json`, and relocating it as well
  // would be an ENOENT on a directory that is correctly gone. The refusal that
  // matters is the other one — too few modules outside the application tree for
  // the split to stage anything — and `planSplitRelocation` raises it here,
  // before a single file is copied.
  const toRelocate = planSplitRelocation({
    candidates: options.packaged,
    available: modulesInTheApplicationTree(options.packaged),
    alreadyPackaged: alreadyPackaged.map((pkg) => pkg.moduleId),
  });
  // The half-moved state has **two** sources, and the second is what makes the
  // stranded pool stop draining (feature 080, T040b, batch five).
  //
  // Until now it could only be staged out of `backend/src/modules`: relocate a
  // module the application tree still owns and withhold its `package.json`. That
  // pool shrank with every batch — its members have to be routed by
  // `routedModuleIds()` *and* unkeyed by any check's ledger *and* still
  // unmoved — and batch four measured it down to one. Batch five took that one.
  //
  // A module that has **already** become a package stages the identical state
  // for free: the `alreadyPackaged` loop above has just copied it to
  // `packages/modules/<id>/`, so deleting the manifest it copied leaves sources
  // at a package address that no glob produces and no root covers — which is
  // exactly what the relocation built by hand. Nothing moves, so no path
  // changes, so a ledger keyed on this module stays valid; and the population
  // this draws from grows with every batch instead of shrinking.
  const packagedIds = new Set(alreadyPackaged.map((pkg) => pkg.moduleId));
  const toStrand = options.stranded ?? [];
  for (const id of toStrand) {
    if (modulesInTheApplicationTree([id]).length === 1) continue;
    if (packagedIds.has(id)) continue;
    throw new Error(
      `[moved-module-tree-fixture] cannot strand '${id}': it is neither under ` +
        'backend/src/modules nor a module package this repository ships. The half-moved state ' +
        'is a module whose sources sit at a package address with no `package.json` beside ' +
        'them; pick a candidate from the stranded pool instead of naming one that exists ' +
        'nowhere.',
    );
  }

  for (const id of toRelocate) relocate(id, true);
  for (const id of toStrand) {
    if (packagedIds.has(id)) {
      rmSync(join(root, packagedModulePath(id), 'package.json'), { force: true });
      continue;
    }
    relocate(id, false);
  }

  // After the relocation and the stranding, because which spelling each module
  // takes is read off what the fixture staged for it and not off the sets that
  // drove the staging (feature 111, FR-001).
  writeFileSync(
    join(backend, 'src', MANIFEST_INDEX_FILENAME),
    splitManifestIndex(root),
    'utf8',
  );
  // Last, and after the stranding: which packages the fixture holds is read off
  // what it staged. A stranded module's *sources* are staged, so the scope
  // points at them and the specifier is unresolvable for want of the
  // `package.json` that was withheld — which is the half-moved state itself,
  // and not the borrowed tree's answer, where it resolved to the real
  // checkout's complete package.
  installFixtureNodeModules(root, options.borrowNodeModules ?? false);

  return {
    root,
    run: (script, args = []) => {
      const result = spawnSync(TSX, [join(backend, 'scripts', script), ...args], {
        encoding: 'utf8',
        cwd: backend,
      });
      return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
