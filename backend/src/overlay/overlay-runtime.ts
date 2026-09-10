/**
 * The overlay loader's **binding** — two suppliers, and nothing else
 * (`specs/110-instance-repository/` T114, FR-013/FR-014).
 *
 * The loader is `@endora-commerce/platform/overlay`'s: the deterministic
 * listing, the `.js`/`.ts` unit resolution a compiled tree needs, the
 * id-collision seam both readers go through, and the two loaders themselves.
 * None of it derives a path any more, because none of it can — in an instance
 * the application is a member the CLI scaffolded and the package cannot see it.
 *
 * What is left here is the wiring an instance must own anyway, and it is two
 * questions:
 *
 *  - **which directory holds `apps/<deployment>/modules`** — `overlay-roots.ts`,
 *    the application's one `import.meta.url` root derivation (D115-3). Since
 *    T114a that root is also a **parameter** of each function below, defaulting
 *    to the one derivation: `composeApp` supplies its own, which is what an
 *    instance's entry point does with a root no package can see
 *    (`contracts/application-root-supplier.md` R1.1, R2.1), and
 *  - **who already claims a module id** — `claimsOutsideTheOverlay`, whose core
 *    half comes off the generated manifest index and which R7.4 therefore keeps
 *    out of the package.
 *
 * **Every exported name and signature is kept deliberately.** The composition
 * root, the manifest registry, a check and the overlay test tree all import this
 * path, so moving the *file* would be a rewrite whose entire content is a path,
 * and moving the *loader* is this one. It is the split
 * `registered-manifests.ts` took in `specs/115-lifecycle-container-move/`
 * Phase 3, one directory over.
 *
 * The claims are computed **per call** rather than captured, because
 * `claimsOutsideTheOverlay` reads this instance's `node_modules`: a captured set
 * would answer the first caller's question forever, and a suite proves a module
 * present and absent in one run.
 */

import {
  activeOverlayModulesRoot as activeOverlayModulesRootUnder,
  overlayModuleEntriesUnder as loadEntriesUnder,
  overlayModuleIdsUnder as idsUnder,
  overlayModuleManifestsUnder as loadManifestsUnder,
  type OverlayModuleManifest,
} from '@endora-commerce/platform/overlay';
import type { ModuleEntry } from '@endora-commerce/platform/composition';
import { claimsOutsideTheOverlay } from '../packages/claimed-module-ids.js';
import { deploymentRoot } from './overlay-roots.js';

/**
 * The manifest shape a caller of {@link discoverOverlayModuleManifests} names.
 *
 * Re-exported **without a `from`**, and that is not a style choice.
 * `test/helpers/platform-single-copy-probe.ts` classifies an application file by
 * whether it re-exports out of the platform, because a file that does holds a
 * second spelling of a platform value and a file that does not holds the
 * application's own. This file is the second kind: it imports the loader once
 * and wraps it, so its three exported functions are its own — a wrapper, not a
 * copy. A `export … from '@endora-commerce/platform/overlay'` here would put the
 * whole binding in that walk, where the wrappers compare unequal to the
 * functions they wrap and are reported as a duplication that is not there.
 * Measured: three false `distinct` entries, one per wrapper.
 */
export type { OverlayModuleManifest };

/**
 * The overlay module ids under one root, with this instance's claims applied.
 *
 * `env` is an argument rather than an ambient read for the reason
 * `resolvedManifestEntries` gives: one process resolves both answers, and a
 * `DEPLOYMENT` read at import time could answer only one of them.
 */
export function overlayModuleIdsUnder(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return idsUnder(root, claimsOutsideTheOverlay(env));
}

/**
 * Discover overlay MODULE manifests for the active deployment WITHOUT composing
 * them. Used early in composition to build the deployment-resolved registry the
 * permission catalogue + lifecycle consume (FR-009, FR-012).
 * Empty for a bare-core build.
 */
export async function discoverOverlayModuleManifests(
  env: NodeJS.ProcessEnv = process.env,
  deploymentDir: string = deploymentRoot(),
): Promise<OverlayModuleManifest[]> {
  const root = activeOverlayModulesRootUnder(deploymentDir, env);
  if (root === null) return [];
  return loadManifestsUnder(root, overlayModuleIdsUnder(root, env));
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
  ids: readonly string[] = overlayModuleIdsUnder(root, process.env),
): Promise<OverlayModuleManifest[]> {
  return loadManifestsUnder(root, ids);
}

/**
 * The active deployment's converted overlay modules, as composer entries
 * (D-103/D-104). A root appends these to the core list and passes the single
 * array to `composeModules`, so an overlay module receives an ordinary
 * `ModuleContext` and reaches every seam a core module reaches.
 *
 * Empty for a bare-core build: no `DEPLOYMENT`, or a deployment that ships no
 * overlay directory, and composition is byte-for-byte unchanged (FR-008).
 */
export async function loadOverlayModuleEntries(
  env: NodeJS.ProcessEnv = process.env,
  deploymentDir: string = deploymentRoot(),
): Promise<ModuleEntry[]> {
  const root = activeOverlayModulesRootUnder(deploymentDir, env);
  if (root === null) return [];
  return loadEntriesUnder(root, claimsOutsideTheOverlay(env));
}

/**
 * {@link loadOverlayModuleEntries} against an explicit root.
 *
 * Exported so the loader can be driven over a fixture tree that enters at the
 * top of the analysis — a directory on disk, scanned and imported by the same
 * code the deployment path runs — rather than by handing the last function a
 * pre-built entry (issue #130).
 */
export async function overlayModuleEntriesUnder(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ModuleEntry[]> {
  return loadEntriesUnder(root, claimsOutsideTheOverlay(env));
}
