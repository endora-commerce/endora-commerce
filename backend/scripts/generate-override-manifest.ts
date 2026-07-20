#!/usr/bin/env tsx
// Emits the committed override-manifest artifact for the active deployment.
//
// Reuses the codegen pattern of `generate-manifest-index.ts` (feature 018).
// The manifest is the deterministic audit record of a deployment's divergence
// from core (US3, FR-005/FR-006). Resolution fails the build on a conflict, an
// unknown/stale target, a schema override, or an un-contracted service override
// (the resolver throws — see src/overlay/resolve-overlay.ts).
//
// Contract enforcement (FR-003): a service overlay lives under
// `backend/src/apps/<deployment>/…` and MUST `implements` its `@core/…`
// interface, so the standard `tsc -p tsconfig.build.json` build is the primary
// contract gate; `check-core-contracts.ts` provides the explicit negative test
// (SC-004) and a CI step with known targets.
//
// Output:
//   - bare core:  backend/src/overlay/override-manifest.core.generated.ts
//   - deployment: backend/src/apps/<deployment>/override-manifest.generated.ts
//
// Usage: pnpm --filter backend run overlay:manifest   (DEPLOYMENT selects it)

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
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

function main(): void {
  const deployment = selectedDeployment();
  const coreRoot = coreModulesRoot();
  const overlayRoot = activeOverlayModulesRoot();

  // resolveOverlay throws (fails the build) on conflict / unknown target /
  // schema override / missing contract — no silent divergence.
  const resolution = resolveOverlay({ coreRoot, overlayRoot, deployment });
  const manifest = buildOverrideManifest({ deployment, coreRoot, overlayRoot, resolution });

  const outputPath =
    deployment === null
      ? join(coreModulesRoot(), '..', 'overlay', 'override-manifest.core.generated.ts')
      : join(overlayModulesRootFor(deployment), '..', 'override-manifest.generated.ts');

  // Module-resolvable path from the emitted file to src/overlay/types.js.
  const typesFile = join(coreModulesRoot(), '..', 'overlay', 'types.ts');
  let typesSpec = relative(dirname(outputPath), typesFile).replace(/\.ts$/, '.js');
  if (sep !== '/') typesSpec = typesSpec.split(sep).join('/');
  if (!typesSpec.startsWith('.')) typesSpec = `./${typesSpec}`;
  const content = serializeManifestModule(manifest, typesSpec);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, 'utf8');

  process.stdout.write(
    `[override-manifest] deployment=${manifest.deployment} ` +
      `overrides=${manifest.overrides.length} newModules=${manifest.newModules.length} ` +
      `→ ${outputPath}\n`,
  );
  for (const o of manifest.overrides) {
    process.stdout.write(`  · override ${o.moduleId}:${o.kind}:${o.unitKey}\n`);
  }
  for (const id of manifest.newModules) {
    process.stdout.write(`  · new-module ${id}\n`);
  }
}

main();
