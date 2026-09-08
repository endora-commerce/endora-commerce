// The application's **one** root derivation, and the bindings over it.
//
// Everything this file used to compute — deployment selection, a deployment's
// overlay modules root, the deployments on disk, the active overlay root — is
// `@endora-commerce/platform/overlay`'s since
// `specs/110-instance-repository/` T114a. What is left is R1.3's one expression:
// *which directory holds `apps/`*, which no package can derive because in an
// instance `apps/` is a sibling of the backend member and the platform came out
// of `node_modules`. `contracts/instance-tree.md:23` classifies exactly that as
// **wiring** — *"the smallest expression that hands the platform something it
// cannot derive: a database handle, **a root directory**, a process's argv."*
//
// **The four bindings below wrap, and none of them re-exports.** That is not a
// style choice: `test/helpers/platform-single-copy-probe.ts` classifies an
// application file by whether it re-exports out of the platform, because a file
// that does holds a second spelling of a platform value. A single
// `export … from '@endora-commerce/platform/overlay'` here would pull this whole
// file into that walk, where each wrapper compares unequal to the function it
// wraps and is reported as a duplication that is not there — measured on
// `overlay-runtime.ts`, three false entries from one line.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeOverlayModulesRoot as activeOverlayModulesRootUnder,
  deploymentsOnDisk as deploymentsOnDiskUnder,
  overlayModulesRootFor as overlayModulesRootUnder,
  selectedDeployment as selectedDeploymentIn,
} from '@endora-commerce/platform/overlay';

/**
 * `backend/src` under `tsx`, `backend/dist` under a compiled run — the one
 * expression, and this file lives at `backend/src/overlay/overlay-roots.ts`.
 */
const DEPLOYMENT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root (two levels up from `backend/src`). */
export function repoRoot(): string {
  return resolve(DEPLOYMENT_ROOT, '..', '..');
}

/**
 * The directory that holds `apps/` — the value every consumer is **given**
 * (`contracts/application-root-supplier.md` R1.1).
 *
 * Named `deploymentRoot` rather than `applicationSourceRoot`, and R1.2 says why
 * the rename is load-bearing rather than cosmetic: *source root* invites the
 * reader to keep it in step with a compiled tree, which is exactly the coupling
 * T114a removed when it deleted `divergence-loader.ts`' `RUNNING_FROM_DIST`.
 * *Deployment root* names the one thing it locates. In this repository the two
 * are the same directory and move between `src` and `dist`; in an instance the
 * value is the workspace root and moves nowhere, because `apps/` sits outside
 * the backend member.
 *
 * It is exported because it is the application's **one** derivation of that
 * root (D115-3; `specs/115-lifecycle-container-move/contracts/operator-half.md`
 * R4.3). `divergence.ts` carried a second copy of the expression above,
 * byte-identical, and that copy was one `dirname` too high for its own location
 * once — so every deployment read as declaring nothing and nothing could see it.
 * Two `import.meta.url` root derivations in one application are two answers
 * waiting to disagree; there is one.
 */
export function deploymentRoot(): string {
  return DEPLOYMENT_ROOT;
}

/**
 * The active deployment name, or `null` for a bare-core build.
 * Read from `DEPLOYMENT`; blank/whitespace is treated as unset.
 */
export function selectedDeployment(env: NodeJS.ProcessEnv = process.env): string | null {
  return selectedDeploymentIn(env);
}

/** Absolute path to a deployment's overlay modules root (whether or not it exists). */
export function overlayModulesRootFor(deployment: string): string {
  return overlayModulesRootUnder(DEPLOYMENT_ROOT, deployment);
}

/**
 * Every deployment shipped in this checkout, sorted — one directory under
 * `backend/src/apps/`.
 *
 * `DEPLOYMENT` selects which one a *build* composes; this is the whole set, and
 * it exists so the determinism gate can verify each deployment's committed
 * artefacts without being run once per deployment (issue #120). An artefact only
 * a run nobody makes would check is an artefact nothing checks.
 */
export function deploymentsOnDisk(): readonly string[] {
  return deploymentsOnDiskUnder(DEPLOYMENT_ROOT);
}

/**
 * The active overlay modules root, or `null` when there is no deployment or the
 * deployment ships no overlay directory. A non-directory path resolves to null
 * (core-only) rather than raising — a missing overlay is not an error.
 */
export function activeOverlayModulesRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return activeOverlayModulesRootUnder(DEPLOYMENT_ROOT, env);
}
