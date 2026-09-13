// Overlay resolution — runtime loader used by composition.
//
// The resolver (`resolve-overlay.ts`) decides WHICH core units a deployment
// overrides; this module dynamically imports the overlay implementations so
// composition can wire them. It runs ONCE at composeApp() startup. For a
// bare-core build (no DEPLOYMENT / no overlay dir) both loaders return empty and
// composition is byte-for-byte unchanged (FR-008).
//
// **This file derives no path of its own** (`specs/110-instance-repository/`
// T113/T114). It moved into `@endora-commerce/platform` and takes the overlay
// root, and the claims already made on a module id, as parameters — both are
// facts about the *application*, which in an instance is a member the CLI
// scaffolded and not a tree this package can see.
// `backend/src/overlay/overlay-runtime.ts` is the binding: it answers "the
// active deployment's root" from `overlay-roots.ts`' single `import.meta.url`
// derivation (D115-3) and "who already claims this id" from
// `packages/claimed-module-ids.ts` (R7.4), and keeps every name and signature
// its consumers already write.
//
// Runtime path mapping: overlay files are authored under `backend/src/apps/…`
// and compiled to `backend/dist/apps/…`. Which of the two this process reads
// needs no detection — the binding's root derivation answers `backend/dist`
// under a compiled run. What did not follow was the **file names**: this module spelled `manifest.ts`
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

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModuleManifest, ModuleManifestExports } from '@endora-commerce/contracts';
import type { ModuleEntry } from '../kernel/compose.js';
import {
  assertNoModuleIdCollisions,
  type ModuleIdClaim,
} from '../lifecycle/services/module-id-claims.js';
import { listOverlayModuleDirs } from './resolve-overlay.js';

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

/**
 * The overlay module ids under one overlay modules root, **and the one place
 * their claim on those ids is checked** (feature 103, FR-004).
 *
 * Both overlay seams go through here — `overlayModuleManifestsUnder`, which is
 * what `resolvedManifestEntries()` reads, and `overlayModuleEntriesUnder`,
 * which is what a composition root composes — so the two cannot answer
 * differently, which is exactly what they used to do: one dropped a colliding
 * manifest with a `continue` while the other composed the module, leaving it
 * with no registry row, no permission-catalogue entry and its routes gated on
 * the effective state of somebody else's module of the same id.
 *
 * The claimed set is derived from what this instance ships and what is
 * installed in it, never written down — so a module that arrives, moves or
 * leaves changes the answer in the same run. It arrives as
 * {@link claimsOutsideTheOverlay}, a **parameter**: its core half comes off the
 * generated manifest index, which is a fact about one tree (D-104, D-160.3), and
 * R7.4 is that a relocated platform file receives such a thing rather than
 * reaching for it. `backend/src/overlay/overlay-runtime.ts` is the binding that
 * supplies it, and an instance writes the same one.
 *
 * This used to be `scanOverlay(root, indexCore(coreModulesRoot())).newModules`
 * — a file-shadowing scan whose core index resolved `backend/src/modules`,
 * which has held no module since F4. With the index empty **every** overlay
 * directory came back as a new module claiming its id, unchecked (D-201).
 */
export function overlayModuleIdsUnder(
  root: string,
  claimsOutsideTheOverlay: readonly ModuleIdClaim[],
): string[] {
  const ids = listOverlayModuleDirs(root);
  assertNoModuleIdCollisions([
    ...claimsOutsideTheOverlay,
    ...ids.map((id) => ({
      id,
      origin: 'overlay' as const,
      // The directory, not a manifest that may not be there: an overlay module
      // with no manifest is refused a few lines down, by a message that names
      // both candidate spellings, and a claim built from a path that does not
      // exist would pre-empt it with a worse one.
      claimedBy: join(root, id),
    })),
  ]);
  return ids;
}

/**
 * Discover overlay MODULE manifests under one root WITHOUT composing them. Used
 * early in composition to build the deployment-resolved registry the permission
 * catalogue + lifecycle consume (FR-009, FR-012).
 *
 * The **root** is a parameter, not a derivation of this file's own path: which
 * directory holds `apps/<deployment>/modules` is a fact about the application,
 * derived once by `backend/src/overlay/overlay-roots.ts` from its own
 * `import.meta.url` (D115-3), and the platform is not in that tree. The binding
 * beside that derivation is what answers "the active deployment's" — see
 * `backend/src/overlay/overlay-runtime.ts`.
 *
 * The fixture is therefore a directory on disk, scanned and imported by the code
 * the deployment path runs, rather than a value handed to the last function in
 * the chain (issue #130).
 */
export async function overlayModuleManifestsUnder(
  root: string,
  ids: readonly string[],
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
 * One overlay root's converted modules, as composer entries (D-103/D-104).
 *
 * The root and the claims are parameters for the reason
 * {@link overlayModuleManifestsUnder} gives: both are facts about the
 * application, and `backend/src/overlay/overlay-runtime.ts` is the binding that
 * answers "the active deployment's" over them.
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
 * Ordering is deterministic — the entries come back in id order and a root
 * appends them after a frozen core list — and it decides nothing about
 * decoration. It used to: this paragraph read "so a deployment's decoration
 * always wraps a core registration that is already there", which was the
 * composer's array position doing policy work. Since D-176 every
 * `ctx.di.decorate` is queued during registration and drained once the last
 * module has registered, so where a module sits in the array cannot grant or
 * refuse a wrap; the ownership guard decides, alone.
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
export async function overlayModuleEntriesUnder(
  root: string,
  claimsOutsideTheOverlay: readonly ModuleIdClaim[],
): Promise<ModuleEntry[]> {
  return await overlayModuleEntriesForIds(root, overlayModuleIdsUnder(root, claimsOutsideTheOverlay));
}

/**
 * {@link overlayModuleEntriesUnder} over an id set already derived.
 *
 * It exists so a caller that needs **both** seams — the entries it composes and
 * the manifests the resolved registry is built from — asserts the id-collision
 * claim set once, over one array, rather than twice over two derivations that
 * `overlayModuleIdsUnder`'s own contract says must never be able to answer
 * differently. {@link overlayModulesUnder} is that caller's shape; this stays
 * private because an id set assembled anywhere but there has not been checked.
 */
async function overlayModuleEntriesForIds(
  root: string,
  ids: readonly string[],
): Promise<ModuleEntry[]> {
  const entries: ModuleEntry[] = [];
  for (const id of ids) {
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

/**
 * One deployment's overlay modules, read **once** for both seams
 * (`specs/124-instance-customisation-gap/` FR-001, FR-002).
 *
 * Every composition root that has an overlay root needs the same two answers —
 * the `ModuleEntry` list it composes and the `OverlayModuleManifest` list
 * `resolveManifestEntries` resolves the registry from — and needs them over the
 * **same** ids. Written out at each site that is three lines repeated, and the
 * repetition is what produced the defect this function exists to close:
 * `defaultComposition` composed `overlayModuleEntriesUnder(...)` and passed
 * `overlay: async () => []` four lines below it, so an instance's overlay module
 * reached the container, the permission gate and the presence projection and
 * never `lifecycleManifestRegistry` — the state `resolveManifestEntries`' own
 * doc block calls *"Principle XVII defeated in silence"*, reproduced by
 * construction on the one path an instance takes.
 *
 * `root` is `string | null` on purpose: "this deployment has no overlay root"
 * is the answer {@link activeOverlayModulesRoot} gives, and taking the ternary
 * in here is what stops a caller writing the empty case for one seam and
 * forgetting it for the other.
 *
 * The ids are derived **lazily and once**. Lazily, because the claim set is a
 * `node_modules` scan a root with no overlay must not pay for and because the
 * collision refusal must stay where it fires today — inside the supplier a
 * caller hands to `resolveManifestEntries`, not before it. Once, because
 * `overlayModuleIdsUnder` asserts the claims as it derives them, and asserting
 * the same set twice is wasteful rather than wrong only for as long as the two
 * derivations cannot drift.
 */
export interface OverlayModules {
  /** The overlay module ids under this root — `[]` when there is no root. */
  ids(): readonly string[];
  /** The manifest half: what the resolved registry is built from. */
  manifests(): Promise<OverlayModuleManifest[]>;
  /** The registration half: what a composition root composes. */
  entries(): Promise<ModuleEntry[]>;
}

export function overlayModulesUnder(
  root: string | null,
  claimsOutsideTheOverlay: () => readonly ModuleIdClaim[],
): OverlayModules {
  let derived: readonly string[] | undefined;
  const ids = (): readonly string[] => {
    if (derived === undefined) {
      derived = root === null ? [] : overlayModuleIdsUnder(root, claimsOutsideTheOverlay());
    }
    return derived;
  };
  return {
    ids,
    manifests: async () => (root === null ? [] : await overlayModuleManifestsUnder(root, ids())),
    entries: async () => (root === null ? [] : await overlayModuleEntriesForIds(root, ids())),
  };
}
