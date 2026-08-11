#!/usr/bin/env tsx
// Git-free determinism gate for the overlay-generated artifacts (feature 057,
// FR-006/SC-003). Renders the manifest index + the bare-core override manifest
// in-process and compares them to the committed files on disk. Fails if either
// drifted — identical inputs MUST produce the identical committed artifact.
//
// Deliberately does NOT shell out to `git` (the CI `node:*-slim` image has no
// git) and does NOT write the files — it only reads + compares.

import { readFileSync } from 'node:fs';
import { renderManifestIndex } from './generate-manifest-index.js';
import { renderOverrideManifest } from './generate-override-manifest.js';
import { renderComposer, renderRegisteredManifests } from './generate-composer.js';

function check(label: string, outputPath: string, expected: string): boolean {
  let onDisk: string;
  try {
    onDisk = readFileSync(outputPath, 'utf8');
  } catch {
    process.stderr.write(`[overlay:check] ${label}: committed file missing at ${outputPath}\n`);
    return false;
  }
  if (onDisk !== expected) {
    process.stderr.write(
      `[overlay:check] ${label}: committed file is STALE at ${outputPath}\n` +
        `  Regenerate and commit:\n` +
        `    pnpm --filter backend run manifest-index:generate\n` +
        `    pnpm --filter backend run overlay:manifest\n` +
        `    pnpm --filter backend run composer:generate\n`,
    );
    return false;
  }
  process.stdout.write(`[overlay:check] ${label}: up-to-date and deterministic ✓\n`);
  return true;
}

async function main(): Promise<void> {
  const mi = renderManifestIndex();
  const om = renderOverrideManifest();
  // Feature 072 — the composer and the manifest registry are generated from the
  // same tree walk and committed the same way, so they are checked here rather
  // than in a second script with the same shape.
  const composer = await renderComposer();
  const registry = renderRegisteredManifests();
  const ok = [
    check('manifest-index', mi.outputPath, mi.content),
    check('override-manifest (core)', om.outputPath, om.content),
    check('composition.generated', composer.outputPath, composer.content),
    check('registered-manifests', registry.outputPath, registry.content),
  ].every(Boolean);
  if (!ok) process.exit(1);
  process.stdout.write('[overlay:check] all generated artifacts deterministic ✓\n');
}

await main();
