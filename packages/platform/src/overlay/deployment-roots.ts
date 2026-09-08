// Where a deployment's files are, given the directory that holds `apps/`.
//
// Every function here takes that directory as its first argument and derives
// nothing from its own location. That is the whole of
// `specs/110-instance-repository/contracts/application-root-supplier.md` §1: the
// root is one value, it is a directory, and it is **supplied** — never derived
// by the file that uses it.
//
// The reason is not tidiness. `backend/src/overlay/overlay-roots.ts` derives it
// from `import.meta.url` and gets `backend/src` under `tsx` and `backend/dist`
// under a compiled run; three `dirname`s from a file in this package give
// `packages/platform/src` in both, which is a directory holding no `apps/` at
// all. The failure is **silent** in the one mechanism where it matters most —
// an absent declaration and an empty one are deliberately the same answer, and
// an overlay module the loader cannot see is skipped with no error and no
// warning (D115-3; D-165 step C). A derivation here would reproduce that state
// exactly, in every instance, because in an instance `apps/` is a sibling of
// the backend member rather than a directory inside it and this package came
// out of `node_modules`.
//
// So the application keeps one expression — R6.1 classifies a root directory as
// **wiring**, in so many words — and hands it in.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The active deployment name, or `null` for a bare-core build.
 *
 * Read from `DEPLOYMENT`; blank/whitespace is treated as unset. It names no
 * path, which is why it moved whole: the environment is the same environment in
 * every tree.
 *
 * `env` is an argument rather than an ambient read because one process resolves
 * both answers — a suite proves a module present with the deployment selected
 * and absent without it, in one run.
 */
export function selectedDeployment(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['DEPLOYMENT'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Absolute path to a deployment's overlay modules root (whether or not it
 * exists), under the supplied deployment root.
 */
export function overlayModulesRootFor(deploymentRoot: string, deployment: string): string {
  return join(deploymentRoot, 'apps', deployment, 'modules');
}

/**
 * Every deployment under the supplied root, sorted — one directory under
 * `<deploymentRoot>/apps/`.
 *
 * `DEPLOYMENT` selects which one a *build* composes; this is the whole set, and
 * it exists so the determinism gate can verify each deployment's committed
 * artefacts without being run once per deployment (issue #120). An artefact only
 * a run nobody makes would check is an artefact nothing checks.
 *
 * A root with no `apps/` is the empty list rather than a throw: a tree that
 * ships no deployment is bare core, which is a supported state and not an error.
 */
export function deploymentsOnDisk(deploymentRoot: string): readonly string[] {
  const appsRoot = join(deploymentRoot, 'apps');
  if (!existsSync(appsRoot)) return [];
  return readdirSync(appsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
}

/**
 * The active overlay modules root, or `null` when there is no deployment or the
 * deployment ships no overlay directory. A non-directory path resolves to null
 * (core-only) rather than raising — a missing overlay is not an error.
 */
export function activeOverlayModulesRoot(
  deploymentRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const deployment = selectedDeployment(env);
  if (deployment === null) return null;
  const root = overlayModulesRootFor(deploymentRoot, deployment);
  if (!existsSync(root)) return null;
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}
