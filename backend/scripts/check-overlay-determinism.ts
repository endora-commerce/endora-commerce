#!/usr/bin/env tsx
// Git-free determinism gate for every generated artifact (feature 057,
// FR-006/SC-003). Renders the composer, the manifest index, the two `db/`
// registries and the bare-core override manifest in-process and compares them
// to the committed files on disk. Fails if any drifted — identical inputs MUST
// produce the identical committed artifact.
//
// Deliberately does NOT shell out to `git` (the CI `node:*-slim` image has no
// git) and does NOT write the files — it only reads + compares.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { renderOverrideManifest } from './generate-override-manifest.js';
import { GENERATED_ARTIFACT_PATHS, renderAll } from './generate-composer.js';

/** Why an artifact failed, or `null` when it is byte-identical to the committed file. */
export type ArtifactVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'missing' | 'stale' | 'empty'; readonly detail: string };

/**
 * Compare one rendered artifact with the file on disk.
 *
 * Reading is injected so this can be driven red on inputs the repository does
 * not contain — a stale file, a deleted one, and a generator that rendered
 * nothing. The last is not hypothetical politeness: two empty strings compare
 * equal, so a generator whose tree walk silently found no module would report
 * every artifact deterministic and up to date. That is the vacuous pass this
 * check refuses (issue #113); it reports it as a verdict rather than exiting,
 * because `main` owns the exit code for every artifact it checks.
 */
export function compareArtifact(
  outputPath: string,
  expected: string,
  read: (p: string) => string,
): ArtifactVerdict {
  if (expected.trim().length === 0) {
    return { ok: false, reason: 'empty', detail: 'the generator rendered an empty artifact' };
  }
  let onDisk: string;
  try {
    onDisk = read(outputPath);
  } catch {
    return { ok: false, reason: 'missing', detail: `committed file missing at ${outputPath}` };
  }
  if (onDisk !== expected) {
    return { ok: false, reason: 'stale', detail: `committed file is STALE at ${outputPath}` };
  }
  return { ok: true };
}

function check(label: string, outputPath: string, expected: string): boolean {
  const verdict = compareArtifact(outputPath, expected, (p) => readFileSync(p, 'utf8'));
  if (verdict.ok) {
    process.stdout.write(`[overlay:check] ${label}: up-to-date and deterministic ✓\n`);
    return true;
  }
  process.stderr.write(`[overlay:check] ${label}: ${verdict.detail}\n`);
  if (verdict.reason === 'stale') {
    process.stderr.write(
      `  Regenerate and commit:\n` +
        `    pnpm --filter backend run overlay:manifest\n` +
        `    pnpm --filter backend run composer:generate\n`,
    );
  }
  return false;
}

/**
 * Every committed artefact this check covers, by output path.
 *
 * Exported without rendering anything so a test can compare it against the
 * `*.generated.ts` files actually on disk: an artefact no determinism gate
 * looks at is one that drifts unnoticed, which is the failure this check
 * exists for.
 */
export function coveredArtifactPaths(): readonly string[] {
  return [...GENERATED_ARTIFACT_PATHS, renderOverrideManifest({}).outputPath];
}

async function main(): Promise<void> {
  const om = renderOverrideManifest();
  // Feature 072 — the composer and the manifest registry are generated from the
  // same tree walk and committed the same way, so they are checked here rather
  // than in a second script with the same shape. Feature 071's F2 added the two
  // `db/` registries to that same walk, for the same reason.
  const ok = [
    ...(await renderAll()).map((artifact) =>
      check(artifact.label, artifact.outputPath, artifact.content),
    ),
    check('override-manifest (core)', om.outputPath, om.content),
  ].every(Boolean);
  if (!ok) process.exit(1);
  process.stdout.write('[overlay:check] all generated artifacts deterministic ✓\n');
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// regenerate every artifact and exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
