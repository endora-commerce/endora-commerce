import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DISCOVERED_MANIFESTS } from '../../src/modules/_lifecycle/manifest-index.generated.js';

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
 * per-module floor sees. `blog` is a routed module and its bundle carries
 * `errors.*` keys, which are both required for the discrimination.
 */
const KEPT_BUNDLE_MODULE = 'blog';

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
  /** Modules relocated into a declared workspace package. */
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

  for (const id of options.packaged) relocate(id, true);
  for (const id of options.stranded ?? []) relocate(id, false);

  writeFileSync(
    join(backend, 'src', 'modules', KEPT_MODULE, 'manifest-index.generated.ts'),
    splitManifestIndex(new Set([...options.packaged, ...(options.stranded ?? [])])),
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
