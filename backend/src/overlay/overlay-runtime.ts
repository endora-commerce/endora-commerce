// Overlay resolution — runtime loader used by composition.
//
// The resolver (`resolve-overlay.ts`) decides WHICH core units a deployment
// overrides; this module dynamically imports the overlay implementations so
// composition can wire them. It runs ONCE at composeApp() startup. For a
// bare-core build (no DEPLOYMENT / no overlay dir) both loaders return empty and
// composition is byte-for-byte unchanged (FR-008).
//
// Runtime path mapping: overlay files are authored under `backend/src/apps/…`
// and compiled to `backend/dist/apps/…`. Which of the two this process reads
// needs no detection — `overlay-roots.ts` derives every root from its own
// `import.meta.url`, so a compiled run is already rooted at `backend/dist`.
// What did not follow was the **file names**: this module spelled `manifest.ts`
// and `backend.ts` into `join(...)` and an `existsSync`, and a compiled tree
// spells both `.js`. `overlayModuleEntriesUnder` therefore skipped every
// overlay module in production — `if (!existsSync(...)) continue`, no error and
// no warning. Measured: the same binary with `DEPLOYMENT=example` logs
// `decoratedBy: 'example_overlay'` under `tsx` and produces zero overlay lines
// under `node dist/index.js` (feature 080, D-165 step C).
//
// So a unit is **resolved** rather than derived — see {@link resolveOverlayUnit}
// — and the path that comes back is the file that exists, which is what every
// consumer of `filePath` needs anyway.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';
import type { ModuleEntry } from '../kernel/compose.js';
import {
  activeOverlayDecorationsRoot,
  activeOverlayModulesRoot,
  coreModulesRoot,
} from './overlay-roots.js';
import { indexCore, scanOverlay } from './resolve-overlay.js';

/**
 * The two spellings one unit has: `<stem>.js` in a compiled tree, `<stem>.ts`
 * under `tsx` and `vitest`. Compiled first, for the reason
 * `manifest-locations.ts` gives about the same pair — the compiled tree is the
 * one where picking up a stray source file would be wrong.
 */
const UNIT_EXTENSIONS = ['.js', '.ts'] as const;

/**
 * The real path of the overlay unit `<dir>/<stem>`, or `null` when the module
 * ships neither spelling.
 *
 * A **resolution**, never a derivation. The path this returns is a file that
 * exists, so `existsSync` on it is redundant by construction and a caller
 * cannot end up importing a name the build never emitted.
 */
export function resolveOverlayUnit(dir: string, stem: string): string | null {
  for (const extension of UNIT_EXTENSIONS) {
    const candidate = join(dir, `${stem}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** The candidates {@link resolveOverlayUnit} tried, for a message that names them. */
function unitCandidates(dir: string, stem: string): string {
  return UNIT_EXTENSIONS.map((extension) => join(dir, `${stem}${extension}`)).join(' and ');
}

/** Convert an absolute path to an importable URL. */
function importUrlFor(absPath: string): string {
  return pathToFileURL(absPath).href;
}

// ---- Decorations (feature 072, T066) ---------------------------------------

/**
 * A client override, in the one shape D-28 permits: it receives the
 * implementation it replaces and returns one that wraps it.
 *
 * This is what replaced the service-class override of feature 057. That
 * mechanism *replaced* the core class, so a deployment stopped receiving core
 * fixes to the overridden methods the day the override was written — whatever
 * core did there next happened in a file the deployment no longer ran.
 * Delegation keeps core in the call path unless the override deliberately
 * intercepts.
 */
export type OverlayDecorator = (inner: unknown) => unknown;

/** `pricing-service` → `pricingService`: the registration name, not a path. */
function camelCase(fileStem: string): string {
  const [head, ...rest] = fileStem.split(/[-_.]/).filter(Boolean);
  return [head ?? '', ...rest.map((p) => p.charAt(0).toUpperCase() + p.slice(1))].join('');
}

/**
 * Load the active deployment's decorations, keyed by the **registration name**
 * they wrap. Empty for a bare-core build, and empty is the whole story: a
 * deployment with no decorations composes byte-for-byte like core.
 *
 * Each file under `apps/<deployment>/decorations/` exports `decorate` (or a
 * default) and is named after its target registration —
 * `pricing-service.ts` decorates `pricingService`.
 */
export async function loadOverlayDecorations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Map<string, OverlayDecorator>> {
  const map = new Map<string, OverlayDecorator>();
  const root = activeOverlayDecorationsRoot(env);
  if (root === null) return map;

  for (const file of readdirSync(root).sort()) {
    if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
    if (file.endsWith('.d.ts')) continue;
    const mod = (await import(importUrlFor(join(root, file)))) as Record<string, unknown>;
    const decorate = mod['decorate'] ?? mod['default'];
    if (typeof decorate !== 'function') continue;
    map.set(camelCase(file.replace(/\.[jt]s$/, '')), decorate as OverlayDecorator);
  }
  return map;
}

// ---- Overlay-only modules (US2, D-103/D-104) -------------------------------

/** An overlay module's manifest + on-disk location (no registration wiring yet). */
export interface OverlayModuleManifest {
  id: string;
  manifest: ModuleManifest;
  filePath: string;
  /** Install-time work lives in `manifest.ts` (D-46), overlay modules included. */
  installHook?: ModuleManifestExports['installHook'];
  uninstallHook?: ModuleManifestExports['uninstallHook'];
  /**
   * This module's interest in every *other* module's install and hard
   * uninstall — feature 080, T036a / D-159. Read here for the same reason the
   * two hooks are: the export travels with the manifest, so an overlay module
   * and an installed package declare one on exactly core's terms.
   */
  lifecycleParticipant?: ModuleManifestExports['lifecycleParticipant'];
  /**
   * The operator commands this module declares — feature 080, T042b / D-160.9.
   * Read here for the same reason the hooks are: the export travels with the
   * manifest, so an overlay module declares one on exactly core's terms.
   */
  cliCommands?: ModuleManifestExports['cliCommands'];
  /**
   * The module's recent-activity eligibility — feature 080, T042j / D-163.1.
   * Read here for the same reason the hooks are: the export travels with the
   * manifest, so an overlay module declares one on exactly core's terms.
   */
  recentActivity?: ModuleManifestExports['recentActivity'];
}

/** Ids of client-only overlay modules for the active deployment (absent from core). */
function newOverlayModuleIds(env: NodeJS.ProcessEnv): { root: string; ids: string[] } | null {
  const overlayRoot = activeOverlayModulesRoot(env);
  if (overlayRoot === null) return null;
  return { root: overlayRoot, ids: overlayModuleIdsUnder(overlayRoot) };
}

/** The module ids under one overlay modules root that core does not already own. */
function overlayModuleIdsUnder(root: string): string[] {
  return scanOverlay(root, indexCore(coreModulesRoot())).newModules;
}

/**
 * Discover overlay MODULE manifests for the active deployment WITHOUT composing
 * them. Used early in composition to build the deployment-resolved registry the
 * permission catalogue + lifecycle consume (FR-009, FR-012).
 * Empty for a bare-core build.
 */
export async function discoverOverlayModuleManifests(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OverlayModuleManifest[]> {
  const found = newOverlayModuleIds(env);
  if (found === null) return [];
  return overlayModuleManifestsUnder(found.root, found.ids);
}

/**
 * {@link discoverOverlayModuleManifests} against an explicit root.
 *
 * Exported for the same reason {@link overlayModuleEntriesUnder} is: the
 * fixture is then a directory on disk, scanned and imported by the code the
 * deployment path runs, rather than a value handed to the last function in the
 * chain (issue #130).
 */
export async function overlayModuleManifestsUnder(
  root: string,
  ids: readonly string[] = overlayModuleIdsUnder(root),
): Promise<OverlayModuleManifest[]> {
  const out: OverlayModuleManifest[] = [];
  for (const id of ids) {
    const moduleDir = join(root, id);
    const manifestPath = resolveOverlayUnit(moduleDir, 'manifest');
    if (manifestPath === null) {
      // The scan already reported this directory as a module, so an absent
      // manifest is not "a directory that ships nothing" — it is a module with
      // no id and no version to compose it under. Refused here rather than left
      // to `import()`, whose ERR_MODULE_NOT_FOUND names a `.ts` path that never
      // existed in a compiled tree and sends the reader looking for the wrong
      // file (D-165 step C).
      throw new Error(
        `[overlay] the module directory ${moduleDir} carries no manifest — tried ` +
          `${unitCandidates(moduleDir, 'manifest')}. An overlay module is discovered by its ` +
          `directory and identified by its manifest; without one it has no id and no version.`,
      );
    }
    const mod = (await import(importUrlFor(manifestPath))) as Record<string, unknown>;
    const manifest = mod['manifest'] as ModuleManifest | undefined;
    if (!manifest) continue;
    // `exactOptionalPropertyTypes`: an absent key is not `{ hook: undefined }`,
    // and the lifecycle asks `entry.installHook !== undefined`.
    const installHook = mod['installHook'] as ModuleManifestExports['installHook'] | undefined;
    const uninstallHook = mod['uninstallHook'] as
      | ModuleManifestExports['uninstallHook']
      | undefined;
    const lifecycleParticipant = mod['lifecycleParticipant'] as
      | ModuleManifestExports['lifecycleParticipant']
      | undefined;
    const cliCommands = mod['cliCommands'] as ModuleManifestExports['cliCommands'] | undefined;
    const recentActivity = mod['recentActivity'] as
      | ModuleManifestExports['recentActivity']
      | undefined;
    out.push({
      id,
      manifest,
      filePath: manifestPath,
      ...(installHook ? { installHook } : {}),
      ...(uninstallHook ? { uninstallHook } : {}),
      ...(lifecycleParticipant ? { lifecycleParticipant } : {}),
      ...(cliCommands ? { cliCommands } : {}),
      ...(recentActivity ? { recentActivity } : {}),
    });
  }
  return out;
}

/**
 * The active deployment's converted overlay modules, as composer entries
 * (D-103/D-104).
 *
 * This is the **one** composition path for an overlay module: a root appends
 * these to the core list and passes the single array to `composeModules`, so an
 * overlay module receives an ordinary `ModuleContext` and reaches every seam a
 * core module reaches — `ctx.routes` and its lifecycle gate, `ctx.worker`,
 * `ctx.subscribe`, `ctx.interceptors`, `ctx.onBoot`, ports, and the decoration
 * exemption. The path it replaces handed a frozen seven-field context to a
 * `plugin.ts` factory and could gate nothing.
 *
 * **Discovered at runtime, not baked into a generated core artefact** (D-104).
 * A deployment's manifests already resolve this way and for the stated reason:
 * the answer depends on which deployment the *process* runs as, not on which
 * tree a generator was run against. Registrations have the identical property
 * and used to be given the opposite treatment, which made
 * `composition.generated.ts` and `manifest-index.generated.ts` environment-
 * dependent — an artefact that is always stale for a deployment is one nobody
 * can use to detect a genuinely stale one (issue #120, applied to the family it
 * was missed in).
 *
 * `overlay: true` is set **from the root the module was found under**, which is
 * what `ModuleEntry.overlay`'s own contract requires: it exempts the module
 * from the rule that a module may decorate only what it registered, so it may
 * never be a claim a module makes about itself.
 *
 * Ordering is structural rather than sorted: the entries come back in id order
 * and a root appends them after a frozen core list, so a deployment's
 * decoration always wraps a core registration that is already there.
 *
 * A module directory with no backend entry point **in either spelling** is
 * skipped, not thrown at — a deployment may ship an overlay directory that only
 * shadows core files. "Either spelling" is the whole of D-165 step C's repair
 * here: this used to ask `existsSync('backend.ts')`, so a compiled deployment's
 * every module took the skip and vanished with no error. A `backend.js`/`.ts`
 * that exports no `registerModule` is a different thing and is refused:
 * skipping it would compose nothing, and the first symptom would be a 404
 * nobody connects to this file.
 */
export async function loadOverlayModuleEntries(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModuleEntry[]> {
  const root = activeOverlayModulesRoot(env);
  if (root === null) return [];
  return overlayModuleEntriesUnder(root);
}

/**
 * {@link loadOverlayModuleEntries} against an explicit root.
 *
 * Exported so the loader can be driven over a fixture tree that enters at the
 * top of the analysis — a directory on disk, scanned and imported by the same
 * code the deployment path runs — rather than by handing the last function a
 * pre-built entry (issue #130).
 */
export async function overlayModuleEntriesUnder(root: string): Promise<ModuleEntry[]> {
  const entries: ModuleEntry[] = [];
  for (const id of overlayModuleIdsUnder(root)) {
    const moduleDir = join(root, id);
    const backendPath = resolveOverlayUnit(moduleDir, 'backend');
    if (backendPath === null) continue;
    const mod = (await import(importUrlFor(backendPath))) as Record<string, unknown>;
    const registerModule = mod['registerModule'];
    if (typeof registerModule !== 'function') {
      throw new Error(
        `[overlay] ${backendPath} exports no 'registerModule'. A module's backend.ts is its ` +
          `entry point (see backend/src/apps/example/modules/example_overlay/backend.ts); ` +
          `rename or remove the file if it is not one. It is not composed as written, and an ` +
          `overlay module that composes nothing is a 404 with no error behind it.`,
      );
    }
    const manifestPath = resolveOverlayUnit(moduleDir, 'manifest');
    if (manifestPath === null) {
      throw new Error(
        `[overlay] ${moduleDir} ships a composable backend entry point and no manifest — ` +
          `tried ${unitCandidates(moduleDir, 'manifest')}. The module has no id and no ` +
          `version to compose it under.`,
      );
    }
    const manifestMod = (await import(importUrlFor(manifestPath))) as Record<string, unknown>;
    const manifest = manifestMod['manifest'] as ModuleManifest | undefined;
    if (!manifest) {
      throw new Error(
        `[overlay] ${manifestPath} exports no lifecycle-shape manifest, so ` +
          `the module has no id and no version to compose it under.`,
      );
    }
    entries.push({
      id,
      version: manifest.version,
      registerModule: registerModule as ModuleEntry['registerModule'],
      // From the root, never from the module. See the note above.
      overlay: true,
    });
  }
  return entries;
}
