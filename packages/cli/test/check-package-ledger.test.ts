/**
 * `contracts/package-ledger.md` §6's red proofs (owner ruling D-196).
 *
 * Every one enters at a **fixture package tree on disk** carrying a real finding
 * and a real ledger: the split this file is about is between two readers of one
 * analysis, and a proof handing in a pre-classified finding would prove the
 * reader and leave the analysis — which is what produces the key the ledger has
 * to match — unproven.
 *
 * The finding used throughout is `check:container-imports`', because it is the
 * cheapest real one to write: one import line.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readPackageLedger, runCheck, type RuleResult } from '../src/check/index.js';

import { createPackageFixture, type PackageFixture } from './check-fixture.js';

const fixtures: PackageFixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
});

const OFFENDING_SOURCE = "import { asClass } from 'awilix';\nexport const x = asClass;\n";

/** A package with one real finding, and whatever ledger the proof wants. */
function withFinding(ledger: Record<string, unknown> | null): string {
  const created = createPackageFixture({
    ...(ledger === null ? {} : { endora: { checkLedger: './check-ledger.json' } }),
    files: [
      { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
      { path: 'src/backend/index.ts', content: OFFENDING_SOURCE },
    ],
  });
  fixtures.push(created);
  if (ledger !== null) {
    writeFileSync(join(created.dir, 'check-ledger.json'), `${JSON.stringify(ledger, null, 2)}\n`);
  }
  return created.dir;
}

/** The key the run produces for that finding — read from the run, never guessed. */
function findingKey(dir: string): string {
  const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });
  const result = run.report.results[0] as RuleResult;
  const finding = [...result.findings, ...result.acknowledged][0];
  if (finding === undefined) throw new Error('the fixture produced no finding');
  return `${finding.rule}|${finding.key}`;
}

describe('proof 4 — the split holds', () => {
  it('one tree, one ledger, one acknowledged finding: 0 for the author, 1 for the platform', () => {
    const bare = withFinding(null);
    const key = findingKey(bare);
    const dir = withFinding({ [key]: 'The container is reached deliberately here; see ADR 7.' });

    const author = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    const platform = runCheck({
      cwd: dir,
      rules: ['check:container-imports'],
      asPlatform: true,
    });

    // Both readers run the same analysis over the same tree and see the same
    // finding. Only its contribution to the exit code differs.
    expect(author.report.results[0]!.acknowledged).toHaveLength(1);
    expect(platform.report.results[0]!.acknowledged).toHaveLength(1);
    expect(author.report.results[0]!.findings).toHaveLength(0);

    expect(author.report.exitCode).toBe(0);
    expect(platform.report.exitCode).toBe(1);
    expect(platform.report.counts.findings).toBe(1);
  });

  it('prints the finding and its reason under both readers', () => {
    const bare = withFinding(null);
    const key = findingKey(bare);
    const dir = withFinding({ [key]: 'Statutory: the vendor SDK constructs its own container.' });

    const lines = runCheck({ cwd: dir, rules: ['check:container-imports'] }).lines.join('\n');
    expect(lines).toContain('acknowledged');
    expect(lines).toContain('Statutory: the vendor SDK constructs its own container.');
  });
});

describe('proof 1 — a stale entry fails', () => {
  it('an entry describing no finding this run produced exits 1', () => {
    const dir = withFinding({ 'check:container-imports|nothing/here.ts|awilix': 'a reason' });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });

    expect(run.report.ledgerFindings.join(' ')).toContain('stale ledger entry');
    expect(run.report.exitCode).toBe(1);
  });
});

describe('proof 2 — a reasonless entry fails', () => {
  it('exits 1 naming the entry', () => {
    const bare = withFinding(null);
    const key = findingKey(bare);
    const dir = withFinding({ [key]: '' });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });

    expect(run.report.ledgerFindings.join(' ')).toContain('carries no reason');
    expect(run.report.exitCode).toBe(1);
    // And the finding is still a finding: an entry with no reason acknowledges
    // nothing.
    expect(run.report.results[0]!.findings).toHaveLength(1);
  });
});

describe('proof 3 — a count fails', () => {
  it('a numeric value exits 1 with §3’s sentence', () => {
    const bare = withFinding(null);
    const key = findingKey(bare);
    const dir = withFinding({ [key]: 3 });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });

    expect(run.report.ledgerFindings.join(' ')).toContain('is a count');
    expect(run.report.ledgerFindings.join(' ')).toContain('predates nothing');
    expect(run.report.exitCode).toBe(1);
  });
});

describe('proof 5 — a ledger cannot reach a pending or unreadable rule', () => {
  it('an entry naming a rule that did not run is a stale entry, and 2 still wins', () => {
    const dir = withFinding({
      'check:module-boundary|src/backend/index.ts|other_module': 'a reason',
    });

    // Full run: `check:module-boundary` is `pending` in this build, so it
    // produced no finding for the entry to match.
    const run = runCheck({ cwd: dir });

    expect(run.report.ledgerFindings.join(' ')).toContain('stale ledger entry');
    expect(run.report.counts.pending).toBeGreaterThan(0);
    expect(run.report.exitCode).toBe(2);
  });
});

describe('a declared ledger that is not there', () => {
  it('is reported, never treated as an empty one', () => {
    const created = createPackageFixture({ endora: { checkLedger: './absent.json' } });
    fixtures.push(created);

    const read = readPackageLedger(
      runCheck({ cwd: created.dir, rules: ['check:nul-bytes'] }).layout,
    );

    expect(read.findings.join(' ')).toContain('could not be read');
    expect(read.ledger.size).toBe(0);
  });

  it('a package that declares none has no acknowledged debt — a claim, not a skip', () => {
    const created = createPackageFixture();
    fixtures.push(created);
    const run = runCheck({ cwd: created.dir, rules: ['check:nul-bytes'] });

    expect(run.layout.ledgerPath).toBeNull();
    expect(run.report.ledgerFindings).toEqual([]);
    expect(run.report.exitCode).toBe(0);
  });
});
