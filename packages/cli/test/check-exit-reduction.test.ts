/**
 * `contracts/exit-reduction.md` §8's red proofs, one per shape the contract
 * claims to refuse.
 *
 * Proofs 1, 2, 4 and 7 are about the reduction itself and enter at
 * {@link buildRunReport} over results the tests construct — that **is** the top
 * of that analysis, which takes results and an estate size and nothing else.
 * Proofs 3, 5 and 6 are about the layout and the hosts, so they enter at a
 * **fixture package tree on disk** and run the real walk, the real analysis and
 * the real reduction (issue #130).
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  arithmeticLine,
  buildRunReport,
  countsOf,
  ESTATE,
  estateIds,
  runCheck,
  type RuleResult,
} from '../src/check/index.js';

import { createPackageFixture, type PackageFixture } from './check-fixture.js';

const fixtures: PackageFixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
});

function fixture(...args: Parameters<typeof createPackageFixture>): string {
  const created = createPackageFixture(...args);
  fixtures.push(created);
  return created.dir;
}

function cleanResult(id: string): RuleResult {
  return {
    id,
    verdict: 'ran',
    findings: [],
    acknowledged: [],
    readSize: { prefix: `[${id}]`, files: 1 },
    explanation: '',
    unevaluatedSignals: [],
  };
}

describe('proof 1 — a lost rule', () => {
  it('fails the first identity and exits 2 with that sentence', () => {
    const results = ESTATE.slice(0, -1).map((entry) => cleanResult(entry.id));

    const report = buildRunReport({
      packageName: '@acme/mod-x',
      packageVersion: '1.0.0',
      results,
      estateSize: ESTATE.length,
      selected: null,
    });

    expect(report.exitCode).toBe(2);
    expect(report.arithmeticFailures).toHaveLength(1);
    expect(report.arithmeticFailures[0]).toContain('lost a');
    // Every rule but one was clean, and the run is still 2. That is the whole
    // ruling: `0` and `1` are statements about the tree, `2` about the run.
    expect(report.counts.clean).toBe(ESTATE.length - 1);
  });
});

describe('proof 2 — a miscounted run', () => {
  it('exits 2 when clean + findings do not sum to ran', () => {
    // A malformed host: a verdict that cannot carry a finding, carrying one.
    // The identity is a real comparison because `clean` and `findings` are each
    // counted directly rather than one being derived from the other.
    const results: RuleResult[] = ESTATE.map((entry) => cleanResult(entry.id));
    results[0] = {
      ...results[0]!,
      verdict: 'not-applicable',
      findings: [{ rule: results[0]!.id, key: 'k', message: 'm', location: null }],
    };

    const report = buildRunReport({
      packageName: '@acme/mod-x',
      packageVersion: '1.0.0',
      results,
      estateSize: ESTATE.length,
      selected: null,
    });

    expect(report.exitCode).toBe(2);
    expect(report.arithmeticFailures.join(' ')).toContain('!= ran=');
  });
});

describe('proof 3 — unreadable dominates findings', () => {
  it('exits 2 while its arithmetic line still prints the finding count', () => {
    const results: RuleResult[] = ESTATE.map((entry) => cleanResult(entry.id));
    results[0] = {
      ...results[0]!,
      findings: [{ rule: results[0]!.id, key: 'k', message: 'a real finding', location: 'a.ts:1' }],
    };
    results[1] = {
      ...results[1]!,
      verdict: 'unreadable',
      readSize: null,
      explanation: 'the platform is not installed',
    };

    const report = buildRunReport({
      packageName: '@acme/mod-x',
      packageVersion: '1.0.0',
      results,
      estateSize: ESTATE.length,
      selected: null,
    });

    expect(report.exitCode).toBe(2);
    // FR-014, normative rather than cosmetic: the masking objection is answered
    // in the exit code and nowhere else.
    expect(arithmeticLine(report)).toContain('findings=1');
    expect(arithmeticLine(report)).toContain('unreadable=1');
  });
});

describe('proof 4 — pending dominates clean', () => {
  it('exits 2 over an otherwise wholly clean package', () => {
    const results: RuleResult[] = ESTATE.map((entry) => cleanResult(entry.id));
    results[0] = {
      ...results[0]!,
      verdict: 'pending',
      readSize: null,
      explanation: 'package-scope host lands in Phase 9',
    };

    const report = buildRunReport({
      packageName: '@acme/mod-x',
      packageVersion: '1.0.0',
      results,
      estateSize: ESTATE.length,
      selected: null,
    });

    expect(report.exitCode).toBe(2);
    expect(report.counts.findings).toBe(0);
    expect(report.counts.pending).toBe(1);
  });
});

describe('proof 5 — a short walk is not a clean walk', () => {
  it('a declared layer with no source exits 2, not violations=0', () => {
    const dir = fixture({
      exports: {
        '.': './dist/manifest.js',
        './backend': './dist/backend/index.js',
        './migrations': './dist/migrations/index.js',
      },
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        { path: 'src/backend/index.ts', content: 'export function registerModule() {}\n' },
        { path: 'src/migrations/index.ts', content: 'export const migrations = [];\n' },
      ],
    });
    // The declaration stands; the source goes. That is the defect the floor is
    // for, and it is a defect the author can fix.
    rmSync(join(dir, 'src', 'migrations'), { recursive: true });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    const result = run.report.results[0]!;

    expect(result.verdict).toBe('unreadable');
    expect(result.explanation).toContain('residue of its population');
    expect(result.readSize?.coverage?.[0]).toEqual({
      source: 'package-exports',
      expected: 3,
      covered: 2,
    });
    expect(run.report.exitCode).toBe(2);
  });
});

describe('proof 6 — an undeclared layer is not a short walk', () => {
  it('the same package with the subpath removed runs, and prints no token for it', () => {
    const dir = fixture({
      exports: { '.': './dist/manifest.js', './backend': './dist/backend/index.js' },
    });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    const result = run.report.results[0]!;

    expect(result.verdict).toBe('ran');
    expect(result.findings).toEqual([]);
    expect(result.readSize?.coverage).toEqual([
      { source: 'package-exports', expected: 2, covered: 2 },
    ]);
    expect(run.report.exitCode).toBe(1 - 1);
  });

  it('a rule whose subject the package declares nowhere is not-applicable, with no token', () => {
    // `check:bundle-pairing`'s subject is `i18n.bundlesDir`. This package
    // declares none, so the rule has no subject — `not-applicable`, naming the
    // declaration, and the `sources=` token is omitted rather than printed 0/0.
    const dir = fixture();

    const run = runCheck({ cwd: dir, rules: ['check:bundle-pairing'] });
    const result = run.report.results[0]!;

    expect(result.verdict).toBe('not-applicable');
    expect(result.explanation).toContain('i18n.bundlesDir');
    expect(result.readSize).toBeNull();
    expect(run.report.exitCode).toBe(0);
  });
});

describe('proof 7 — a narrowed run cannot pose as a full one', () => {
  it('prints selected=, never estate=', () => {
    const dir = fixture();
    const run = runCheck({ cwd: dir, rules: ['check:nul-bytes'] });

    expect(arithmeticLine(run.report)).toContain(`selected=1/${ESTATE.length}`);
    expect(arithmeticLine(run.report)).not.toContain('estate=');
    // The first identity is meaningless over a subset and is suppressed; the
    // second is about the results and is kept.
    expect(run.report.arithmeticFailures).toEqual([]);
  });
});

describe('the reduction over a real package', () => {
  it('a minimal correct module reports every rule and loses none', () => {
    const dir = fixture();
    const run = runCheck({ cwd: dir });
    const counts = run.report.counts;

    expect(run.report.results).toHaveLength(ESTATE.length);
    expect(counts.ran + counts.notApplicable + counts.unreadable + counts.pending).toBe(
      ESTATE.length,
    );
    expect(counts.clean + counts.findings).toBe(counts.ran);
    // SC-003: no rule in the estate is absent from a run's output.
    expect(run.report.results.map((result) => result.id).sort()).toEqual([...estateIds()].sort());
  });

  it('a real finding makes the rule report it, whatever the aggregate is', () => {
    const dir = fixture({
      files: [
        { path: 'src/manifest.ts', content: 'export const manifest = {};\n' },
        {
          path: 'src/backend/index.ts',
          content: "import { asClass } from 'awilix';\nexport const x = asClass;\n",
        },
      ],
    });

    const run = runCheck({ cwd: dir, rules: ['check:container-imports'] });
    const result = run.report.results[0]!;

    expect(result.verdict).toBe('ran');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.message).toContain('awilix');
    expect(run.report.exitCode).toBe(1);
  });
});

describe('countsOf takes the estate size rather than deriving it', () => {
  it('is a comparison, not a tautology', () => {
    // The identity in `exit-reduction.md` §3 has to be able to fail, or it
    // proves nothing: a run whose counts are summed from the results it happens
    // to hold can never detect a lost rule.
    const counts = countsOf([cleanResult('a'), cleanResult('b')], 7);
    expect(counts.estate).toBe(7);
    expect(counts.ran).toBe(2);
  });
});

describe('the package must be a module package', () => {
  it('refuses a directory that declares no endora block, naming what it looked for', () => {
    const dir = fixture();
    const bare = join(dir, 'not-a-package');
    mkdirSync(bare);
    writeFileSync(join(bare, 'package.json'), '{"name":"plain"}\n');
    // The fixture's own manifest is above it, so the walk must not stop early:
    // move the probe somewhere with no module package above it at all.
    const outside = join(dir, '..', `endora-check-bare-${String(process.pid)}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'package.json'), '{"name":"plain"}\n');
    try {
      expect(() => runCheck({ cwd: outside })).toThrow(/endora: \{ "type": "module"/);
    } finally {
      if (existsSync(outside)) rmSync(outside, { recursive: true, force: true });
    }
  });
});
