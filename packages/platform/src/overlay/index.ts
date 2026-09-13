/**
 * `./overlay` — the overlay loader, and the platform's eleventh subpath
 * (`specs/110-instance-repository/` T114, FR-013).
 *
 * ## What is on it
 *
 * The code that turns a directory of client-only modules into things the kernel
 * container composes: the deterministic listing of an overlay root, the
 * `.js`/`.ts` unit resolution a compiled tree needs, the id-collision seam both
 * overlay readers go through, and the two loaders — manifests for the
 * deployment-resolved registry, `ModuleEntry`s for `composeModules`.
 *
 * ## What is *not* on it, and that is the whole shape of this move
 *
 * **Every path.** This directory derives none: the deployment root and the
 * claims already made on a module id both arrive as parameters. The first is a
 * fact about the application — `backend/src/overlay/overlay-roots.ts` derives it
 * once from its own `import.meta.url`, in one expression (D115-3;
 * `specs/110-instance-repository/contracts/application-root-supplier.md` R6.1
 * classifies a root directory as **wiring**) — and in an instance the
 * application is a member the CLI scaffolded, which this package cannot see. The
 * second's core half comes off the generated manifest index, which R7.4 says a
 * relocated platform file receives rather than reaches for.
 *
 * So the application keeps a **binding** at `backend/src/overlay/overlay-runtime.ts`
 * carrying every name and signature its consumers already write —
 * `discoverOverlayModuleManifests(env)` and `loadOverlayModuleEntries(env)`
 * among them — and an instance writes the same twenty lines over its own two
 * answers. That is `registered-manifests.ts`' split, one directory over.
 *
 * `deployment-roots.ts` joined it in T114a and is that split at its purest:
 * *"which directory holds `apps/`"* is a **parameter** of every function that
 * composes a path under it, so `overlay-roots.ts` keeps the derivation and
 * nothing else (R1.3).
 *
 * One file stayed behind for a reason of its own, written in place: `types.ts`,
 * named **by relative path** from every deployment's generated divergence
 * artefact, deliberately, so that a committed artefact's import does not depend
 * on the deployment's dependency graph. `divergence-loader.ts` is no longer one
 * of them: T114a deleted its `RUNNING_FROM_DIST` in favour of
 * {@link resolveOverlayUnit}, so it derives nothing and is movable (R3).
 *
 * **`divergence-report.ts` was named here as a second and is gone** — not to this
 * package but to `@endora-commerce/cli`, with the derivation that feeds it
 * (`specs/110-instance-repository/` T138a). The report has two hosts, a client's
 * instance renders one over its own `apps/` tree, and a build-time renderer has
 * no runtime reader that would justify a package every instance loads at boot
 * carrying it. This paragraph said it *"stays with them"*; it did not.
 *
 * ## Why no module may name it
 *
 * D-160.14's third state. An overlay module is the deployment's answer to
 * "customise without forking", and the loader that composes one decides which
 * modules a deployment runs at all — a module that could name this could compose
 * its siblings, which is `./composition`'s own argument. Declared by the
 * `exports` map, carried by no published barrel, and answered for a module's
 * reach with `host-internal-subpath`.
 */

export {
  activeOverlayModulesRoot,
  deploymentsOnDisk,
  overlayModulesRootFor,
  selectedDeployment,
} from './deployment-roots.js';

export {
  listOverlayModuleDirs,
  resolveOverlay,
  type OverlayResolution,
} from './resolve-overlay.js';

export {
  overlayModuleEntriesUnder,
  overlayModuleIdsUnder,
  overlayModuleManifestsUnder,
  resolveOverlayUnit,
  type OverlayModuleManifest,
} from './overlay-runtime.js';
