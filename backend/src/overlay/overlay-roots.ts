// Overlay resolution — deployment selection + root path resolution.
//
// The active deployment is chosen by the `DEPLOYMENT` env var at build/
// composition time. When it is unset, or names an overlay root that does not
// exist on disk, resolution proceeds CORE-ONLY and the build behaves
// byte-for-byte like bare core (FR-008, SC-006).

import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `backend/src` — this file lives at `backend/src/overlay/overlay-roots.ts`. */
const BACKEND_SRC = dirname(dirname(fileURLToPath(import.meta.url)));

/** Repository root (two levels up from `backend/src`). */
export function repoRoot(): string {
  return resolve(BACKEND_SRC, '..', '..');
}

/** Absolute path to the core modules root, `backend/src/modules`. */
export function coreModulesRoot(): string {
  return join(BACKEND_SRC, 'modules');
}

/**
 * The active deployment name, or `null` for a bare-core build.
 * Read from `DEPLOYMENT`; blank/whitespace is treated as unset.
 */
export function selectedDeployment(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env['DEPLOYMENT'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Absolute path to a deployment's overlay modules root (whether or not it exists). */
export function overlayModulesRootFor(deployment: string): string {
  return join(BACKEND_SRC, 'apps', deployment, 'modules');
}

/** Absolute path to a deployment's decorations root (whether or not it exists). */
export function overlayDecorationsRootFor(deployment: string): string {
  return join(BACKEND_SRC, 'apps', deployment, 'decorations');
}

/**
 * The active decorations root, or `null` when there is no deployment or it
 * ships none (feature 072, T066).
 *
 * Decorations sit beside `modules/` rather than inside it because they are not
 * a shadowing of anything: a decoration names a container registration, and a
 * registration name is not a file path. Putting them under `modules/<id>/`
 * would re-create the thing this replaced — an override located by where it
 * sits on disk.
 */
export function activeOverlayDecorationsRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const deployment = selectedDeployment(env);
  if (deployment === null) return null;
  const root = overlayDecorationsRootFor(deployment);
  if (!existsSync(root)) return null;
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}

/**
 * The active overlay modules root, or `null` when there is no deployment or the
 * deployment ships no overlay directory. A non-directory path resolves to null
 * (core-only) rather than raising — a missing overlay is not an error.
 */
export function activeOverlayModulesRoot(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const deployment = selectedDeployment(env);
  if (deployment === null) return null;
  const root = overlayModulesRootFor(deployment);
  if (!existsSync(root)) return null;
  try {
    return statSync(root).isDirectory() ? root : null;
  } catch {
    return null;
  }
}
