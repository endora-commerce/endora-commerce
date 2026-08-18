// Overlay resolution — runtime loader used by composition.
//
// The resolver (`resolve-overlay.ts`) decides WHICH core units a deployment
// overrides; this module dynamically imports the overlay implementations so
// composition can wire them. It runs ONCE at composeApp() startup. For a
// bare-core build (no DEPLOYMENT / no overlay dir) both loaders return empty and
// composition is byte-for-byte unchanged (FR-008).
//
// Runtime path mapping: overlay files are authored under `backend/src/apps/…`
// and compiled to `backend/dist/apps/…`. When this module runs from `dist/`
// (production) we import the compiled `.js`; under tsx/vitest (dev + tests) we
// import the `.ts` source directly. Detected from `import.meta.url`.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@b2b/contracts';
import type { ModuleEntry } from '../kernel/compose.js';
import {
  activeOverlayDecorationsRoot,
  activeOverlayModulesRoot,
  coreModulesRoot,
} from './overlay-roots.js';
import { indexCore, scanOverlay } from './resolve-overlay.js';

const RUNNING_FROM_DIST = import.meta.url.includes('/dist/');

/** Convert an absolute `backend/src/…/*.ts` overlay path to an importable URL. */
function importUrlFor(absSrcPath: string): string {
  const path = RUNNING_FROM_DIST
    ? absSrcPath.replace(`${'/src/'}`, '/dist/').replace(/\.ts$/, '.js')
    : absSrcPath;
  return pathToFileURL(path).href;
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
  const out: OverlayModuleManifest[] = [];
  for (const id of found.ids) {
    const manifestPath = join(found.root, id, 'manifest.ts');
    const mod = (await import(importUrlFor(manifestPath))) as Record<string, unknown>;
    const manifest = mod['manifest'] as ModuleManifest | undefined;
    if (!manifest) continue;
    // `exactOptionalPropertyTypes`: an absent key is not `{ hook: undefined }`,
    // and the lifecycle asks `entry.installHook !== undefined`.
    const installHook = mod['installHook'] as ModuleManifestExports['installHook'] | undefined;
    const uninstallHook = mod['uninstallHook'] as
      | ModuleManifestExports['uninstallHook']
      | undefined;
    out.push({
      id,
      manifest,
      filePath: manifestPath,
      ...(installHook ? { installHook } : {}),
      ...(uninstallHook ? { uninstallHook } : {}),
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
 * A module directory with no `backend.ts` is **skipped**, not thrown at — a
 * deployment may ship an overlay directory that only shadows core files. A
 * `backend.ts` that exports no `registerModule` is a different thing and is
 * refused: skipping it would compose nothing, and the first symptom would be a
 * 404 nobody connects to this file.
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
    const backendPath = join(root, id, 'backend.ts');
    if (!existsSync(backendPath)) continue;
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
    const manifestMod = (await import(importUrlFor(join(root, id, 'manifest.ts')))) as Record<
      string,
      unknown
    >;
    const manifest = manifestMod['manifest'] as ModuleManifest | undefined;
    if (!manifest) {
      throw new Error(
        `[overlay] ${join(root, id, 'manifest.ts')} exports no lifecycle-shape manifest, so ` +
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
