import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
function stubManifestIndex(ids: readonly string[]): string {
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
        `  { id: '${id}', manifest: { id: '${id}', name: '${id}', ` +
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
  // Bare specifiers (`typescript`, `@b2b/contracts`) resolve by walking up from
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
  cpSync(join(BACKEND_ROOT, 'scripts'), join(backend, 'scripts'), { recursive: true });
  cpSync(
    join(REPO_ROOT, 'packages', 'contracts', 'src'),
    join(root, 'packages', 'contracts', 'src'),
    { recursive: true },
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
  writeFileSync(
    join(backend, 'src', 'modules', KEPT_MODULE, 'manifest-index.generated.ts'),
    stubManifestIndex(options.registeredIds ?? DISCOVERED_MANIFESTS.map((entry) => entry.id)),
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
