// Overlay resolution — which modules a deployment adds.
//
// That is the whole of it since D-201 retired file shadowing (feature 103). An
// overlay module owns every file it ships, so there is nothing inside one of
// these directories for the platform to classify, and no core tree to classify
// it against: the resolution is a deterministic listing of the module
// directories under one root.
//
// **What used to be here, and why none of it is missed.** A core index, a unit
// taxonomy (`route` / `config` / `schema` / `other`), a shadowing rule, a
// conflict policy and three build-time refusals. `git log -S` over this
// directory's whole history finds exactly one loader for a shadowed file ever
// written — `loadOverlayServiceClasses`, for `service` — and feature 072
// deleted it deliberately, replacing it with `ctx.di.decorate`, because a
// replacement stops receiving core fixes the day it is written. `route` and
// `config` never had a loader at all: `resolution.overrides` had one consumer
// in the whole history of the tree, the override-manifest generator, which
// serialised it into an audit artefact. So a route override never changed what
// a running platform served, on any deployment, in any tree state.
//
// Since F4 the classification could not even run — its core root resolved
// `backend/src/modules`, which holds no module — so every overlay directory
// short-circuited to "a new module claiming this id" before a single file was
// looked at, and the three refusals the documentation promised were
// unreachable. A deployment could put a migration under an overlay directory
// and the guard written to refuse it said nothing.
//
// What a deployment overrides instead is in
// `docs/docs/architecture/overlay-pattern.md`.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { OverlayResolution } from './types.js';

/**
 * Deterministic list of the module directories directly under an overlay root.
 *
 * Sorted, dot-prefixed entries skipped, non-directories skipped — the same
 * listing `deploymentsOnDisk()` makes one level up, and both are sorted for the
 * same reason: a committed artefact downstream is byte-compared.
 */
export function listOverlayModuleDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

/**
 * Resolve one deployment: the module ids it adds. When `overlayRoot` is `null`
 * (no deployment, or a deployment that ships no overlay directory) the result
 * is core-only and empty, and the build behaves byte-for-byte like bare core
 * (feature 057 FR-008, SC-006).
 *
 * It refuses nothing. An overlay module id already claimed by core, by a
 * workspace module package, by an installed package or by another overlay
 * module is refused at the seams that discover and compose — one rule, reached
 * by both readers (feature 103, FR-004) — rather than here, where a build-time
 * audit artefact is being rendered and no module is about to run.
 */
export function resolveOverlay(params: {
  overlayRoot: string | null;
  deployment: string | null;
}): OverlayResolution {
  const { overlayRoot, deployment } = params;
  if (overlayRoot === null) return { deployment: null, newModules: [] };
  return { deployment, newModules: listOverlayModuleDirs(overlayRoot) };
}
