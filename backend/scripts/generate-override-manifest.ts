#!/usr/bin/env tsx
// Emits the committed override-manifest artifact for the active deployment.
//
// Reuses the codegen pattern of `generate-composer.ts` (feature 018).
// The manifest is the deterministic audit record of what a deployment adds to
// core (US3, FR-005/FR-006): which deployment this is, which overlay root was
// read, and which modules it adds.
//
// **It records no overrides, because nothing overrides a core file** (feature
// 103, D-201). Service overrides left this artefact in feature 072 (T067) —
// they are decorations of container registrations, not shadowed files, so there
// is no path to record and nothing for a resolver to classify, and the
// composer's own override report (`ComposedModules.decorations`, T065) is where
// a build's decorations are enumerated. `route` and `config` shadowing left it
// in feature 103, for a blunter reason: no loader for either was ever written,
// so the array they populated could only be empty, and an always-empty field in
// an artefact a determinism check byte-compares is a field that makes the check
// agree with itself.
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
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeOverlayModulesRoot,
  overlayModulesRootFor,
  selectedDeployment,
} from '../src/overlay/overlay-roots.js';
import { resolveOverlay } from '../src/overlay/resolve-overlay.js';
import {
  buildOverrideManifest,
  serializeManifestModule,
} from '../src/overlay/override-manifest.js';

/**
 * `backend/src` — this file lives at `backend/scripts/`, so it derives the
 * source root from its own location, exactly as `overlay-roots.ts` derives
 * `BACKEND_SRC` from its.
 *
 * It used to write `join(coreModulesRoot(), '..', 'overlay', …)`, which reached
 * `backend/src/overlay/` through a modules root that has held no module since
 * F4 — a path nobody would grep for when deleting that function (feature 103).
 */
const BACKEND_SRC = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src');

/**
 * Where a deployment's committed override manifest lives — `null` for bare core.
 *
 * Path only, so the determinism gate can enumerate the artefacts it covers
 * without walking the overlay tree once per deployment to learn their names.
 */
export function overrideManifestOutputPath(deployment: string | null): string {
  return deployment === null
    ? join(BACKEND_SRC, 'overlay', 'override-manifest.core.generated.ts')
    : join(overlayModulesRootFor(deployment), '..', 'override-manifest.generated.ts');
}

/** Pure render — the target path + expected file content. Used by the generator
 * and by the git-free determinism check (`check-overlay-determinism.ts`). */
export function renderOverrideManifest(env: NodeJS.ProcessEnv = process.env): {
  outputPath: string;
  content: string;
  newModules: number;
  deployment: string;
} {
  const deployment = selectedDeployment(env);
  const overlayRoot = activeOverlayModulesRoot(env);

  const resolution = resolveOverlay({ overlayRoot, deployment });
  const manifest = buildOverrideManifest({ deployment, overlayRoot, resolution });

  const outputPath = overrideManifestOutputPath(deployment);

  // Module-resolvable path from the emitted file to src/overlay/types.js.
  const typesFile = join(BACKEND_SRC, 'overlay', 'types.ts');
  let typesSpec = relative(dirname(outputPath), typesFile).replace(/\.ts$/, '.js');
  if (sep !== '/') typesSpec = typesSpec.split(sep).join('/');
  if (!typesSpec.startsWith('.')) typesSpec = `./${typesSpec}`;
  const content = serializeManifestModule(manifest, typesSpec);
  return {
    outputPath,
    content,
    newModules: manifest.newModules.length,
    deployment: manifest.deployment,
  };
}

function main(): void {
  const { outputPath, content, newModules, deployment } = renderOverrideManifest();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');
  process.stdout.write(
    `[override-manifest] deployment=${deployment} newModules=${newModules} → ${outputPath}\n`,
  );
}

// Only write when executed directly (not when imported by the determinism check).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
