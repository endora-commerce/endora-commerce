import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkLockClaims,
  classifyLockClaims,
  collectArtifacts,
  findLockClaims,
  flatten,
  vacuousReason,
} from '../../../scripts/check-lock-claims.js';
import type { ManifestActivationInput } from '../../../scripts/lib/switchable-modules.js';

/**
 * Issue #216 — the check that refuses a reason asserting a lock the manifests
 * contradict.
 *
 * Every fixture below is **source text plus a manifest list**, which is where a
 * real run enters: the locked set is derived from the manifests inside the
 * analysis, never handed in pre-computed (issue #130). Flipping
 * `nonDeactivatable` in the fixture manifests is what moves a finding, and that
 * is the property the whole check rests on.
 */

const MANIFESTS: readonly ManifestActivationInput[] = [
  { id: 'fixture_locked', activation: { nonDeactivatable: true, reason: 'core' } },
  { id: 'fixture_switchable', activation: { settingCode: 'fixture_switchable.enabled', default: true } },
  { id: 'fixture_other', activation: { settingCode: 'fixture_other.enabled', default: true } },
];

function run(source: string, manifests = MANIFESTS): ReturnType<typeof checkLockClaims> {
  return checkLockClaims({ sources: new Map([['shard.ts', source]]), manifests });
}

describe('a claim of a lock over a module that has an activation control', () => {
  it('refuses the identifier spelling — the shape that withdrew a cut', () => {
    const result = run("// `fixture_switchable` is `nonDeactivatable`, so the cut is off.");
    expect(result.findings.map((f) => [f.kind, f.moduleId])).toEqual([
      ['stale-lock-claim', 'fixture_switchable'],
    ]);
  });

  it('refuses the prose spelling', () => {
    expect(
      run("  'The owner, `fixture_switchable`, is non-deactivatable.',").findings,
    ).toHaveLength(1);
  });

  it('refuses "always present" — the claim that never writes the word', () => {
    // The load-bearing step of the withdrawal in #216 was spelled this way and
    // nothing in it says "deactivatable" at all.
    const result = run(
      "  'the orchestrator refuses to disable a module a present dependent needs ' +\n" +
        "  'and `fixture_switchable` is always present.',",
    );
    expect(result.findings.map((f) => f.assertion)).toEqual(['always present']);
  });

  it('reads a claim split across a wrapped string literal', () => {
    // The seam a reason is written over. Without splicing it the subject and
    // the assertion sit on different "lines" and the claim is invisible.
    const result = run(
      "  'F3 Phase C. Withdrawn because `fixture_switchable` ' +\n" +
        "  'is non-deactivatable and the edge cannot be declared.',",
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.line).toBe(1);
  });

  it('reads a claim split across a block comment', () => {
    const result = run(
      '/**\n * Withdrawn: `fixture_switchable`\n * is non-deactivatable.\n */\n',
    );
    expect(result.findings).toHaveLength(1);
  });
});

describe('a claim of switchability over a locked module', () => {
  it('refuses it — the converse goes stale by the same mechanism', () => {
    const result = run('// `fixture_locked` is deactivatable (`fixture_locked.enabled`).');
    expect(result.findings.map((f) => [f.kind, f.moduleId])).toEqual([
      ['stale-switchable-claim', 'fixture_locked'],
    ]);
  });

  it('does not read `non-deactivatable` as the bare word it ends with', () => {
    expect(run('// `fixture_locked` is non-deactivatable.').findings).toEqual([]);
  });
});

describe('what is not a claim', () => {
  it('agrees with a true lock claim', () => {
    expect(run('// `fixture_locked` is non-deactivatable.').findings).toEqual([]);
  });

  it('agrees with a true switchable claim', () => {
    expect(run('// `fixture_switchable` is switchable.').findings).toEqual([]);
  });

  it('ignores a pronoun subject — resolving it is a reading task, not a parse', () => {
    // Declared in the header as the check's limit. Proven as a discrimination:
    // the same sentence with a named subject *is* found, so a green here cannot
    // mean the analysis stopped looking.
    const pronoun = run('// This module is non-deactivatable.');
    const named = run('// `fixture_switchable` is non-deactivatable.');
    expect(pronoun.claims).toEqual([]);
    expect(named.findings).toHaveLength(1);
  });

  it('ignores a hypothetical — "would make X undeactivatable" asserts nothing', () => {
    const result = run(
      "  'Declaring `fixture_switchable` and `fixture_other` as binding dependencies would ' +\n" +
        "  'make two deactivatable modules permanently undeactivatable.',",
    );
    expect(result.findings).toEqual([]);
  });

  it('ignores a claim whose subject is a different module in the same clause', () => {
    // Without the `because` breaker this reads as a claim about
    // `fixture_switchable`, and it is a true sentence about another module.
    const result = run(
      "  'an acknowledged edge would make `fixture_switchable.enabled` unusable, because ' +\n" +
        "  'this module is non-deactivatable.',",
    );
    expect(result.findings).toEqual([]);
  });

  it('ignores a negated assertion', () => {
    expect(run('// `fixture_switchable` is not non-deactivatable.').findings).toEqual([]);
  });

  it('ignores a token that is not a module id', () => {
    expect(run('// `fixture_unknown` is non-deactivatable.').claims).toEqual([]);
  });

  it('ignores a setting code that begins with a module id', () => {
    expect(run('// `fixture_switchable.enabled` is non-deactivatable.').claims).toEqual([]);
  });
});

describe('the classification follows the manifests, in the same run', () => {
  it('turns green the moment the manifest declares the lock', () => {
    const source = '// `fixture_switchable` is non-deactivatable.';
    expect(run(source).findings).toHaveLength(1);
    const nowLocked: readonly ManifestActivationInput[] = [
      { id: 'fixture_locked', activation: { nonDeactivatable: true } },
      { id: 'fixture_switchable', activation: { nonDeactivatable: true } },
      { id: 'fixture_other', activation: { default: true } },
    ];
    expect(run(source, nowLocked).findings).toEqual([]);
  });

  it('turns red the moment a lock is withdrawn, with no ledger to edit', () => {
    const source = '// `fixture_locked` is non-deactivatable.';
    expect(run(source).findings).toEqual([]);
    const unlocked: readonly ManifestActivationInput[] = [
      { id: 'fixture_locked', activation: { settingCode: 'fixture_locked.enabled', default: true } },
      { id: 'fixture_switchable', activation: { default: true } },
      { id: 'fixture_other', activation: { default: true } },
    ];
    expect(run(source, unlocked).findings.map((f) => f.kind)).toEqual(['stale-lock-claim']);
  });
});

describe('the plumbing that keeps a green honest', () => {
  it('flattens comment decoration while keeping the source line of every character', () => {
    const { text, lineOf } = flatten('/**\n * one\n * two\n */');
    expect(text.replace(/\s+/g, ' ').trim()).toBe('one two');
    expect(lineOf[text.indexOf('two')]).toBe(3);
  });

  it('finds the artefacts it declares, and nothing outside them', () => {
    const files = collectArtifacts({
      srcRoot: new URL('../../../src/', import.meta.url).pathname,
      scriptsRoot: new URL('../../../scripts/', import.meta.url).pathname,
    });
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.includes('/ledgers/cross-module-imports/'))).toBe(true);
    expect(files.some((f) => f.endsWith('/manifest.ts'))).toBe(true);
    expect(files.some((f) => f.includes('check-entry-presence.ts'))).toBe(true);
    // A module service is not a reason-carrying artefact.
    expect(files.some((f) => f.endsWith('/order-service.ts'))).toBe(false);
  });

  it('exits 2 rather than green when there is no artefact to read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'lock-claims-'));
    try {
      const files = collectArtifacts({
        srcRoot: join(empty, 'src'),
        scriptsRoot: join(empty, 'scripts'),
      });
      expect(files).toEqual([]);
      expect(vacuousReason(files, MANIFESTS)).toMatch(/no reason-carrying artefacts/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('exits 2 rather than green when no module id was derived', () => {
    expect(vacuousReason(['scripts/ledgers/x.ts'], [])).toMatch(/no module ids/);
  });

  it('exits 2 rather than green when the derivation produced an empty locked set', () => {
    // "No module is locked" and "the manifest index did not load" would be the
    // same answer, and the second silently turns every `stale-lock-claim` green.
    const noneLocked: readonly ManifestActivationInput[] = [
      { id: 'fixture_locked', activation: { settingCode: 'a.enabled', default: true } },
      { id: 'fixture_switchable', activation: { settingCode: 'b.enabled', default: true } },
    ];
    expect(vacuousReason(['scripts/ledgers/x.ts'], noneLocked)).toMatch(/no non-deactivatable/);
  });

  it('reports no vacuity on the real inputs', () => {
    expect(vacuousReason(['scripts/ledgers/x.ts'], MANIFESTS)).toBeNull();
  });

  it('classifies nothing when the locked set is empty — the caller exits 2 instead', () => {
    // The vacuous-pass guard's other half: `classifyLockClaims` cannot tell
    // "no module is locked" from "the index did not load", so it must not be
    // the thing that decides. `main` refuses an empty locked set outright.
    const claims = findLockClaims(
      'shard.ts',
      '// `fixture_locked` is non-deactivatable.',
      new Set(['fixture_locked']),
    );
    expect(claims).toHaveLength(1);
    expect(classifyLockClaims(claims, new Set())).toHaveLength(1);
  });
});
