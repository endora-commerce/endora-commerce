#!/usr/bin/env tsx
// Git-free determinism gate for every generated artifact (feature 057,
// FR-006/SC-003). Renders the composer, the manifest index, the two `db/`
// registries and every override manifest — bare core plus one per deployment
// under `src/apps/` — in-process and compares them to the committed files on
// disk. Fails if any drifted: identical inputs MUST produce the identical
// committed artifact.
//
// Deliberately does NOT shell out to `git` (the CI `node:*-slim` image has no
// git) and does NOT write the files — it only reads + compares.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deploymentsOnDisk } from '../src/overlay/overlay-roots.js';
import {
  overrideManifestOutputPath,
  renderOverrideManifest,
} from './generate-override-manifest.js';
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

function check(label: string, outputPath: string, expected: string, regenerate?: string): boolean {
  const verdict = compareArtifact(outputPath, expected, (p) => readFileSync(p, 'utf8'));
  if (verdict.ok) {
    process.stdout.write(`[overlay:check] ${label}: up-to-date and deterministic ✓\n`);
    return true;
  }
  process.stderr.write(`[overlay:check] ${label}: ${verdict.detail}\n`);
  process.stderr.write(
    `  Regenerate and commit:\n` +
      (regenerate ??
        `    pnpm --filter backend run overlay:manifest\n` +
          `    pnpm --filter backend run composer:generate\n`),
  );
  return false;
}

/**
 * The override manifests this check compares: bare core, plus one per deployment
 * shipped under `src/apps/`.
 *
 * Env-independent on purpose. The manifest is the committed audit record of a
 * deployment's divergence from core (feature 057, FR-005 — reviewers read it in
 * the MR diff), and every deployment's lives at its own path, so there is no
 * reason for `DEPLOYMENT` to decide which of them the gate looks at. It used to,
 * and the consequence was `example`'s artefact being uncommitted and its line
 * reporting `missing` on every run that set the variable while no run that left
 * it unset looked at the artefact at all (issue #120).
 */
function overrideManifestTargets(): ReadonlyArray<string | null> {
  return [null, ...deploymentsOnDisk()];
}

function overrideManifestLabel(deployment: string | null): string {
  return `override-manifest (${deployment ?? 'core'})`;
}

function overrideManifestRegenerateHint(deployment: string | null): string {
  return deployment === null
    ? '    pnpm --filter backend run overlay:manifest\n'
    : `    DEPLOYMENT=${deployment} pnpm --filter backend run overlay:manifest\n`;
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
  return [
    ...GENERATED_ARTIFACT_PATHS,
    ...overrideManifestTargets().map(overrideManifestOutputPath),
  ];
}

async function main(): Promise<void> {
  // Feature 072 — the composer and the manifest registry are generated from the
  // same tree walk and committed the same way, so they are checked here rather
  // than in a second script with the same shape. Feature 071's F2 added the two
  // `db/` registries to that same walk, for the same reason.
  const ok = [
    ...(await renderAll()).map((artifact) =>
      check(artifact.label, artifact.outputPath, artifact.content),
    ),
    ...overrideManifestTargets().map((deployment) => {
      const rendered = renderOverrideManifest(
        deployment === null ? {} : ({ DEPLOYMENT: deployment } as NodeJS.ProcessEnv),
      );
      return check(
        overrideManifestLabel(deployment),
        rendered.outputPath,
        rendered.content,
        overrideManifestRegenerateHint(deployment),
      );
    }),
  ].every(Boolean);
  if (!ok) process.exit(1);
  process.stdout.write('[overlay:check] all generated artifacts deterministic ✓\n');
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// regenerate every artifact and exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
