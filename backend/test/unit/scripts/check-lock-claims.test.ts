import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  barrelExports,
  checkLockClaims,
  classifyLockClaims,
  collectArtifacts,
  contractsCoverage,
  findLockClaims,
  flatten,
  vacuousReason,
} from '../../../scripts/check-lock-claims.js';
import {
  CONTRACT_DIRECTORY,
  createLockClaimsFixture,
  FIXTURE_LOCKED,
  FIXTURE_SWITCHABLE,
  reportsClaimInAPublishedContract,
} from '../../helpers/lock-claims-check-fixture.js';
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
      contractsRoot: new URL('../../../../packages/contracts/src/', import.meta.url).pathname,
    });
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.includes('/ledgers/cross-module-imports/'))).toBe(true);
    expect(files.some((f) => f.endsWith('/manifest.ts'))).toBe(true);
    expect(files.some((f) => f.includes('check-entry-presence.ts'))).toBe(true);
    // Issue #279 — a published port's doc block is where an "owner off"
    // paragraph is written, and it was outside the population.
    expect(files.some((f) => f.endsWith('/packages/contracts/src/orders.ts'))).toBe(true);
    // A module service is not a reason-carrying artefact.
    expect(files.some((f) => f.endsWith('/order-service.ts'))).toBe(false);
    // Neither is a test beside a contract, nor an emitted declaration.
    expect(files.some((f) => f.endsWith('.test.ts') || f.endsWith('.d.ts'))).toBe(false);
  });

  it('exits 2 rather than green when there is no artefact to read', () => {
    const empty = mkdtempSync(join(tmpdir(), 'lock-claims-'));
    try {
      const files = collectArtifacts({
        srcRoot: join(empty, 'src'),
        scriptsRoot: join(empty, 'scripts'),
        contractsRoot: join(empty, 'packages/contracts/src'),
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

/**
 * Issue #279 — the source the check could not see.
 *
 * A published port's doc block in `packages/contracts/src` is where its "when
 * the owner is switched off" paragraph belongs, written by the module that owns
 * the port about the module that owns it. That is the sentence this check
 * refuses, and the package was outside the population: a false switchability
 * claim there passed silently, and the guard rested on the author being careful.
 *
 * Every proof below enters as a **tree on disk**, spawned the way CI spawns the
 * check. The proofs above enter at `checkLockClaims`, which takes the source map
 * `collectArtifacts` produced — they are green whether or not the contracts
 * package is in it, so none of them can protect this.
 */
describe('a claim written in a published contract (issue #279)', () => {
  it('reports a switchability claim about a locked module, against the contract file', () => {
    // The Phase B shape: the hedged paragraph was written on judgement, and
    // this is the alternative that would have shipped.
    expect(
      reportsClaimInAPublishedContract(
        [
          '/**',
          ' * The orders read port.',
          ' *',
          ` * Owner off: \`${FIXTURE_LOCKED}\` is switchable, so every caller of this port`,
          ' * has to handle the 503 `MODULE_DISABLED` envelope.',
          ' */',
          'export interface OrdersReadPort {',
          '  read(): Promise<string>;',
          '}',
          '',
        ].join('\n'),
        'stale-switchable-claim',
      ),
    ).toBe(1);
  });

  it('reports a lock claim about a module that has an activation control', () => {
    // The converse direction, in the same file class: a contract that reasons
    // "the owner cannot be switched off, so this port is always there".
    expect(
      reportsClaimInAPublishedContract(
        `// \`${FIXTURE_SWITCHABLE}\` is always present, so this port needs no absent case.\n` +
          'export interface AlwaysThere { read(): void }\n',
        'stale-lock-claim',
      ),
    ).toBe(1);
  });

  it('exits 0 over the same tree when the contract agrees with the manifests', () => {
    // The control. Without it the two reds above show the check failing over a
    // staged tree, not failing *because of the claim* in the staged contract.
    const fixture = createLockClaimsFixture();
    try {
      fixture.writeContract(
        'orders-port.ts',
        `// \`${FIXTURE_SWITCHABLE}\` is switchable, so this port fails closed.\n` +
          'export interface OrdersReadPort { read(): void }\n',
      );
      fixture.writeBarrel("export * from './published.js';\nexport * from './orders-port.js';\n");
      const result = fixture.run();
      expect(result.status, result.output).toBe(0);
      // And it read the contract rather than skipping it: two claims, both
      // agreeing. A green over a file nobody opened is the defect, not the pass.
      expect(result.output).toContain('claims=2 violations=0');
      expect(result.output).toContain('contracts-barrel:2/2');
    } finally {
      fixture.cleanup();
    }
  });

  it('names the finding by its repository path, not by a walk out of backend/', () => {
    const fixture = createLockClaimsFixture();
    try {
      fixture.writeContract(
        'orders-port.ts',
        `// \`${FIXTURE_LOCKED}\` is switchable.\nexport interface P { read(): void }\n`,
      );
      fixture.writeBarrel("export * from './published.js';\nexport * from './orders-port.js';\n");
      const result = fixture.run();
      expect(result.status, result.output).toBe(1);
      expect(result.output).toContain(`${CONTRACT_DIRECTORY}/orders-port.ts`);
      expect(result.output).not.toContain(`../${CONTRACT_DIRECTORY}`);
    } finally {
      fixture.cleanup();
    }
  });
});

describe('the contracts walk cannot come back short and read as clean (issue #279)', () => {
  it('exits 2 when a file the barrel re-exports is not in the walk', () => {
    // #215's shape for the new source: the walk is not empty — the ledgers,
    // the checks and the manifests all survive — it is simply missing the
    // package whose claims this widening exists to read.
    const fixture = createLockClaimsFixture();
    try {
      fixture.removeContract('published.ts');
      const result = fixture.run();
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('`contracts-barrel`');
      // The discrimination: the walk was non-empty, so an emptiness test would
      // have called this run clean.
      expect(result.output).toMatch(/opened [1-9]\d* file\(s\)/);
    } finally {
      fixture.cleanup();
    }
  });

  it('exits 2 when the barrel declares nothing — a package that moved, not a clean one', () => {
    const fixture = createLockClaimsFixture();
    try {
      fixture.writeBarrel('export const NOTHING = 1;\n');
      const result = fixture.run();
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain('expects nothing');
    } finally {
      fixture.cleanup();
    }
  });

  it('derives the expectation from the barrel, in both re-export shapes', () => {
    // `index.ts` publishes most contracts with `export *` and a few with a
    // named list; a derivation that read only the first would expect fewer
    // files than the package has and never notice the rest going missing.
    expect(
      barrelExports(
        [
          "export * from './orders.js';",
          "export type { CmsPage } from './cms.js';",
          "export { productSchema } from './catalog.js';",
          "import { z } from 'zod';",
        ].join('\n'),
      ),
    ).toEqual(['catalog.ts', 'cms.ts', 'orders.ts']);
  });

  it('counts what the walk covered of what the barrel declared', () => {
    expect(
      contractsCoverage({
        barrel: "export * from './orders.js';\nexport * from './catalog.js';",
        files: ['orders.ts', 'unpublished-helper.ts'],
      }),
    ).toEqual({ source: 'contracts-barrel', expected: 2, covered: 1 });
  });
});
