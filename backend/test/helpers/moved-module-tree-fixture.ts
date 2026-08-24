import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISCOVERED_MANIFESTS } from '../../src/modules/_lifecycle/manifest-index.generated.js';
import { ERROR_TRANSLATION_KEYS } from '../../src/modules/_i18n/services/error-translation.js';
import { discoverModulePackages } from '../../scripts/lib/module-packages.js';

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

/** Single files of other modules a spawned check imports as code. */
const KEPT_MODULE_FILES: readonly string[] = [
  'admin_roles/permission-inventory.ts',
  // `check-error-translations` imports the routing table as *code*; without it
  // that spawn dies at module resolution and its proof would pass for the wrong
  // reason. The table is also what its floor is derived from, so a fixture
  // without it could not stage the shortfall at all.
  '_i18n/services/error-translation.ts',
];

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
 * per-module floor sees. It has to be a **routed** module — its bundle carries
 * the `errors.*` keys — and it has to still live in the application's own tree,
 * so it is derived rather than named: this constant read `'blog'` until that
 * module became a package (feature 080, T040b), at which point the `cpSync`
 * below threw ENOENT and took all 73 proofs in `moved-module-tree.test.ts` with
 * it. A fixture that names a module has an expiry date, and there are 64 more
 * moves to come.
 */
function firstRoutedModuleWithABundleInTheApplicationTree(): string {
  const routed = [
    ...new Set(Object.values(ERROR_TRANSLATION_KEYS).map((target) => target.moduleId)),
  ].sort();
  for (const moduleId of routed) {
    if (existsSync(join(BACKEND_ROOT, 'src', 'modules', moduleId, 'i18n', 'en.json'))) {
      return moduleId;
    }
  }
  throw new Error(
    '[moved-module-tree-fixture] no module that `ERROR_TRANSLATION_KEYS` routes a code to ' +
      'still keeps an i18n bundle under backend/src/modules. The fixture needs one to stage ' +
      "check-error-translations' per-module shortfall; with none, its proof would pass on " +
      'the pre-existing empty-walk guard instead.',
  );
}

const KEPT_BUNDLE_MODULE = firstRoutedModuleWithABundleInTheApplicationTree();

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

/** The modules `ERROR_TRANSLATION_KEYS` routes an operator-visible code to. */
export function routedModuleIds(): readonly string[] {
  return [
    ...new Set(Object.values(ERROR_TRANSLATION_KEYS).map((target) => target.moduleId)),
  ].sort();
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

export interface MovedModuleTreeOptions {
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

/** The real `activation` block of a registered module, or `undefined`. */
function realActivation(id: string): unknown {
  const entry = DISCOVERED_MANIFESTS.find((candidate) => candidate.id === id);
  return (entry?.manifest as { activation?: unknown } | undefined)?.activation;
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
  const pathFor = (id: string): string =>
    join(backendRoot, 'src', 'modules', id, 'manifest.ts').split('\\').join('/');
  return [
    '// Fixture stand-in for the generated manifest index.',
    '//',
    '// The ids are the real ones, read from the committed index when the fixture',
    '// was built, so the expected population tracks the tree rather than a list',
    '// typed out here. The manifests are otherwise inert: every consumer in this',
    '// fixture reads ids, and importing 65 real manifests would import 65 module',
    '// trees the fixture deliberately does not have.',
    '//',
    '// `activation` is the one field carried across verbatim (issue #216).',
    '// `lib/switchable-modules.ts` derives the locked set from it, and two checks',
    '// already read that set; a stub that dropped it made "no module is locked"',
    '// the answer in the fixture, which is a state those checks are right to',
    '// refuse — so they exited 2 over the residue for a reason that had nothing',
    '// to do with the residue, and their controls exited 2 as well.',
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
    '  };',
    '}',
    '',
    'export const DISCOVERED_MANIFESTS: ReadonlyArray<DiscoveredManifestEntry> = [',
    ...ids.map((id) => {
      const activation = realActivation(id);
      const tail = activation === undefined ? '' : `, activation: ${JSON.stringify(activation)}`;
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
  // a path that never passes through `backend/`, where the fixture's other
  // borrowed tree is. Without this the residue's shims die at module resolution
  // and every proof under them fails for a reason that is not the residue.
  symlinkSync(join(BACKEND_ROOT, 'node_modules'), join(destination, 'node_modules'));
  cpSync(join(source, 'package.json'), join(destination, 'package.json'));
  cpSync(join(source, 'src'), join(destination, 'src'), { recursive: true });
  cpSync(built, join(destination, 'dist'), { recursive: true });
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
  // Bare specifiers (`typescript`, `@endora-commerce/contracts`) resolve by walking up from
  // the importing file, so the fixture borrows the backend's installed tree
  // rather than carrying one.
  symlinkSync(join(BACKEND_ROOT, 'node_modules'), join(backend, 'node_modules'));
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
  cpSync(
    join(REPO_ROOT, 'packages', 'contracts', 'src'),
    join(root, 'packages', 'contracts', 'src'),
    { recursive: true },
  );
  cpSync(
    join(REPO_ROOT, 'packages', 'contracts', 'package.json'),
    join(root, 'packages', 'contracts', 'package.json'),
  );
  copyPlatformPackage(root);
  for (const directory of RESIDUE_ROOTS) {
    cpSync(join(BACKEND_ROOT, 'src', directory), join(backend, 'src', directory), {
      recursive: true,
    });
  }
  cpSync(
    join(BACKEND_ROOT, 'src', 'modules', KEPT_MODULE, 'services'),
    join(backend, 'src', 'modules', KEPT_MODULE, 'services'),
    { recursive: true },
  );
  cpSync(
    join(BACKEND_ROOT, 'src', 'modules', KEPT_MODULE, 'registered-manifests.ts'),
    join(backend, 'src', 'modules', KEPT_MODULE, 'registered-manifests.ts'),
  );
  cpSync(
    join(BACKEND_ROOT, 'src', 'modules', KEPT_MODULE, 'manifest.ts'),
    join(backend, 'src', 'modules', KEPT_MODULE, 'manifest.ts'),
  );
  // Same reason as the two files above: `check-action-route-permissions`
  // imports the gate-argument resolver as *code*, so without it that spawn dies
  // at module resolution and its proof would pass for the wrong reason. It is
  // one file of one module, so the fixture stays the hard case — the walk still
  // produces sources for two of the 65 registered modules.
  for (const file of KEPT_MODULE_FILES) {
    mkdirSync(join(backend, 'src', 'modules', dirname(file)), { recursive: true });
    cpSync(join(BACKEND_ROOT, 'src', 'modules', file), join(backend, 'src', 'modules', file));
  }
  cpSync(
    join(BACKEND_ROOT, 'src', 'modules', KEPT_BUNDLE_MODULE, 'i18n'),
    join(backend, 'src', 'modules', KEPT_BUNDLE_MODULE, 'i18n'),
    { recursive: true },
  );
  writeFileSync(
    join(backend, 'src', 'modules', KEPT_MODULE, 'manifest-index.generated.ts'),
    stubManifestIndex(
      options.registeredIds ?? DISCOVERED_MANIFESTS.map((entry) => entry.id),
      backend,
    ),
    'utf8',
  );

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
export interface SplitModuleTreeOptions {
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
const SPLIT_WORKSPACE_GLOBS: readonly string[] = ['backend', 'packages/*', 'packages/modules/*'];

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

/** The index, rewritten so a relocated module's manifest still resolves. */
function splitManifestIndex(relocated: ReadonlySet<string>): string {
  const ids = DISCOVERED_MANIFESTS.map((entry) => entry.id);
  const specifierOf = (id: string): string =>
    relocated.has(id) ? `../../../../packages/modules/${id}/src/manifest.js` : `../${id}/manifest.js`;
  return [
    '// Fixture stand-in for the generated manifest index, over a split tree.',
    '//',
    '// The entry array is the real one; only the specifiers move. The ids are',
    '// read off the entries rather than off the specifiers precisely so that',
    '// this rewrite changes nothing about which modules are registered.',
    '//',
    '// A relocated module keeps a **relative** specifier here, where the real',
    '// generator emits a bare one (D-149). That is deliberate and is a property',
    '// of the fixture rather than a claim about the generator: this tree borrows',
    '// the repository`s own `node_modules`, so no `@endora-commerce/mod-<id>`',
    '// link exists in it and a bare specifier would resolve to nothing. What the',
    '// fixture is staging is where the module sources sit, which is the question',
    '// the checks below answer; the emitted specifier shape is proved instead by',
    '// `test/unit/scripts/generate-registries.test.ts` and by',
    '// `test/unit/scripts/module-package-artefacts.test.ts`.',
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

export function createSplitModuleTreeFixture(
  options: SplitModuleTreeOptions,
): MovedModuleTreeFixture {
  const root = mkdtempSync(join(tmpdir(), 'split-module-tree-'));
  const backend = join(root, 'backend');
  mkdirSync(backend, { recursive: true });
  symlinkSync(join(BACKEND_ROOT, 'node_modules'), join(backend, 'node_modules'));
  // A second borrowed tree, at the fixture root. A relocated module resolves
  // `@endora-commerce/contracts` by walking up from `packages/modules/<id>/src`, which never
  // passes through `backend/`, so without this the manifest index cannot be
  // imported and every check dies at module resolution.
  symlinkSync(join(BACKEND_ROOT, 'node_modules'), join(root, 'node_modules'));
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
  cpSync(join(REPO_ROOT, 'packages', 'contracts', 'src'), join(root, 'packages', 'contracts', 'src'), {
    recursive: true,
  });
  cpSync(
    join(REPO_ROOT, 'packages', 'contracts', 'package.json'),
    join(root, 'packages', 'contracts', 'package.json'),
  );
  copyPlatformPackage(root);

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
    cpSync(pkg.dir, join(root, packagedModulePath(pkg.moduleId)), {
      recursive: true,
      filter: (source) => !source.endsWith(`${sep}node_modules`),
    });
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
  const toStrand = options.stranded ?? [];
  for (const id of toStrand) {
    if (modulesInTheApplicationTree([id]).length === 1) continue;
    throw new Error(
      `[moved-module-tree-fixture] cannot strand '${id}': backend/src/modules holds no such ` +
        'module. The half-moved state is a module the application tree still owns, moved to a ' +
        'package address with no `package.json`; pick the next candidate from the stranded ' +
        'pool instead of naming one that has already left.',
    );
  }

  for (const id of toRelocate) relocate(id, true);
  for (const id of toStrand) relocate(id, false);

  writeFileSync(
    join(backend, 'src', 'modules', KEPT_MODULE, 'manifest-index.generated.ts'),
    splitManifestIndex(
      new Set([...alreadyPackaged.map((pkg) => pkg.moduleId), ...toRelocate, ...toStrand]),
    ),
    'utf8',
  );

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
