/**
 * `endora generate` reports the overlay boundary (`specs/190-overlay-full-modules/`
 * FR-071, T033; `contracts/overlay-cli.md`, `contracts/overlay-ports.md` §3).
 *
 * An instance has no check estate, so `endora generate` is the instrument a client
 * runs: it reads the overlay sources it already parses for the divergence report,
 * asks the shared overlay-boundary analysis about every import between two overlay
 * modules, prints each finding with its failed clauses and exits 1 — **after**
 * writing its artefacts, as it does for a divergence finding. Every case runs over an
 * instance on disk (issue #130).
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { main } from '../src/bin/endora.js';
import { generateFindingsRefusal, generateReport, runGenerate } from '../src/generate/index.js';
import { cleanInstances, instance, write } from './support/overlay-instance.js';

afterEach(cleanInstances);

const MODULES = join('apps', 'acme', 'modules');

/** Two overlay modules: `acme_loyalty` publishes port types, `acme_reports` reads them. */
function twoOverlays(root: string, consumer: { imports: string; dependencies: string }): void {
  const owner = join(root, MODULES, 'acme_loyalty');
  write(
    join(owner, 'manifest.ts'),
    "export const manifest = { id: 'acme_loyalty', version: '1.0.0', dependencies: [] };\n",
  );
  write(join(owner, 'ports.ts'), 'export interface LoyaltyReadPort { points(id: string): number }\n');
  write(join(owner, 'services', 'points.ts'), 'export const DEFAULT_POINTS = 0;\n');
  write(join(owner, 'backend.ts'), 'export function registerModule(): void {}\n');
  const reports = join(root, MODULES, 'acme_reports');
  write(
    join(reports, 'manifest.ts'),
    `export const manifest = { id: 'acme_reports', version: '1.0.0', dependencies: ${consumer.dependencies} };\n`,
  );
  write(
    join(reports, 'backend.ts'),
    `${consumer.imports}\nexport function registerModule(): void {}\n`,
  );
}

describe('endora generate — the overlay boundary (FR-071)', () => {
  it('the sanctioned type-only ports.ts import is clean', async () => {
    const root = instance();
    twoOverlays(root, {
      imports: "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';",
      dependencies: "['acme_loyalty']",
    });
    const result = await runGenerate({ cwd: root });
    expect(result.overlayBoundary).toEqual([]);
    expect(generateFindingsRefusal(result)).toBeNull();
  });

  it('any other import is a finding with its clauses, and the run is refused after writing', async () => {
    const root = instance();
    twoOverlays(root, {
      imports: "import { DEFAULT_POINTS } from '../acme_loyalty/services/points.js';",
      dependencies: '[]',
    });
    const result = await runGenerate({ cwd: root });

    expect(result.overlayBoundary.map((finding) => [finding.file, [...finding.failed]])).toEqual([
      ['apps/acme/modules/acme_reports/backend.ts', ['type-only', 'ports-file', 'declared-dependency']],
    ]);
    // Written whatever it found: the divergence report is on disk.
    expect(existsSync(join(root, 'apps', 'acme', 'divergence.generated.md'))).toBe(true);

    const report = generateReport(result).join('\n');
    expect(report).toContain('[overlay-boundary] apps/acme/modules/acme_reports/backend.ts:1');
    expect(report).toContain('acme_loyalty');
    expect(report).toContain('[declared-dependency]');

    const refusal = generateFindingsRefusal(result);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain('overlay boundary');
    expect(refusal).toContain('1 import');
  });

  it('a dry run reports the same finding and writes nothing', async () => {
    const root = instance();
    twoOverlays(root, {
      imports: "import type { LoyaltyReadPort } from '../acme_loyalty/ports.js';",
      dependencies: '[]',
    });
    const result = await runGenerate({ cwd: root, dryRun: true });
    expect(result.overlayBoundary.map((finding) => [...finding.failed])).toEqual([
      ['declared-dependency'],
    ]);
    expect(existsSync(join(root, 'apps', 'acme', 'divergence.generated.md'))).toBe(false);
    expect(generateFindingsRefusal(result)).toContain('would be');
  });

  it('the program exits 1, after printing the report', async () => {
    const root = instance();
    twoOverlays(root, {
      imports: "import { DEFAULT_POINTS } from '../acme_loyalty/services/points.js';",
      dependencies: "['acme_loyalty']",
    });
    const out: string[] = [];
    const err: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    });
    let code: number;
    try {
      code = await main(['generate'], root);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
    expect(code).toBe(1);
    expect(out.join('')).toContain('[overlay-boundary]');
    expect(out.join('')).toContain('wrote apps/acme/divergence.generated.md');
    expect(err.join('')).toContain('[type-only]');
    expect(existsSync(join(root, 'apps', 'acme', 'divergence.generated.md'))).toBe(true);
  });
});
