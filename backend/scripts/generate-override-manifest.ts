#!/usr/bin/env tsx
// Emits the committed override-manifest artifact for the active deployment.
//
// Reuses the codegen pattern of `generate-composer.ts` (feature 018).
// The manifest is the deterministic audit record of a deployment's divergence
// from core (US3, FR-005/FR-006). Resolution fails the build on a conflict, an
// unknown/stale target or a schema override (the resolver throws — see
// src/overlay/resolve-overlay.ts).
//
// Service overrides are NOT in this manifest since feature 072 (T067): they are
// decorations of container registrations, not shadowed files, so there is no
// path to record and nothing for a resolver to classify. A deployment writes
// one from its own overlay module — `ctx.di.decorate('<name>', …)` (D-103) —
// and the composer's own override report (`ComposedModules.decorations`, T065)
// is where a build's decorations are enumerated.
//
// This header used to add "`tsc` remains the contract gate — a decoration is
// written against the core interface and stops being assignable when that
// interface changes". That was true of the retired `apps/<deployment>/
// decorations/` file seam, which imported the owner's `*.interface.ts`. It is
// not true of `ctx.di.decorate<T>`, where `T` is asserted by the caller: the
// wrapped shape is declared structurally and nothing compares it to the owner's
// interface. The gate went with the seam; restoring it means publishing the
// interface on the owner's `./ports` subpath and naming it from the overlay.
//
// Output:
//   - bare core:  backend/src/overlay/override-manifest.core.generated.ts
//   - deployment: backend/src/apps/<deployment>/override-manifest.generated.ts
//
// Usage: pnpm --filter backend run overlay:manifest   (DEPLOYMENT selects it)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  activeOverlayModulesRoot,
  coreModulesRoot,
  overlayModulesRootFor,
  selectedDeployment,
} from '../src/overlay/overlay-roots.js';
import { resolveOverlay } from '../src/overlay/resolve-overlay.js';
import {
  buildOverrideManifest,
  serializeManifestModule,
} from '../src/overlay/override-manifest.js';

/**
 * Where a deployment's committed override manifest lives — `null` for bare core.
 *
 * Path only, so the determinism gate can enumerate the artefacts it covers
 * without walking the overlay tree once per deployment to learn their names.
 */
export function overrideManifestOutputPath(deployment: string | null): string {
  return deployment === null
    ? join(coreModulesRoot(), '..', 'overlay', 'override-manifest.core.generated.ts')
    : join(overlayModulesRootFor(deployment), '..', 'override-manifest.generated.ts');
}

/** Pure render — the target path + expected file content. Used by the generator
 * and by the git-free determinism check (`check-overlay-determinism.ts`). */
export function renderOverrideManifest(env: NodeJS.ProcessEnv = process.env): {
  outputPath: string;
  content: string;
  overrides: number;
  newModules: number;
  deployment: string;
} {
  const deployment = selectedDeployment(env);
  const coreRoot = coreModulesRoot();
  const overlayRoot = activeOverlayModulesRoot(env);

  // resolveOverlay throws (fails the build) on conflict / unknown target /
  // schema override / missing contract — no silent divergence.
  const resolution = resolveOverlay({ coreRoot, overlayRoot, deployment });
  const manifest = buildOverrideManifest({ deployment, coreRoot, overlayRoot, resolution });

  const outputPath = overrideManifestOutputPath(deployment);

  // Module-resolvable path from the emitted file to src/overlay/types.js.
  const typesFile = join(coreModulesRoot(), '..', 'overlay', 'types.ts');
  let typesSpec = relative(dirname(outputPath), typesFile).replace(/\.ts$/, '.js');
  if (sep !== '/') typesSpec = typesSpec.split(sep).join('/');
  if (!typesSpec.startsWith('.')) typesSpec = `./${typesSpec}`;
  const content = serializeManifestModule(manifest, typesSpec);
  return {
    outputPath,
    content,
    overrides: manifest.overrides.length,
    newModules: manifest.newModules.length,
    deployment: manifest.deployment,
  };
}

function main(): void {
  const { outputPath, content, overrides, newModules, deployment } = renderOverrideManifest();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
  process.stdout.write(
    `[override-manifest] deployment=${deployment} overrides=${overrides} ` +
      `newModules=${newModules} → ${outputPath}\n`,
  );
}

// Only write when executed directly (not when imported by the determinism check).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
