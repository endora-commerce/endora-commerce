/**
 * The instance criterion's judgement, one red proof per finding.
 *
 * Every fixture enters at the top of the analysis — an outward-reference list,
 * a migration observation, a boot log, a digest pair — and never a verdict the
 * script normally computes (issue #130). That is what lets these run in the
 * fast suite while the criterion itself needs a pack, an install, a PostgreSQL
 * and a boot.
 *
 * The discriminations matter as much as the reds here, because the whole
 * subject of `contracts/instance-repository.md` R6.4 is that **a step that did
 * not run is neither a pass nor a failure**. So every `unmeasured` case below
 * is paired with the `fail` it must not be confused with, and vice versa.
 */
import { describe, expect, it } from 'vitest';

import {
  ASSERTION_CATALOGUE,
  ASSERTION_IDS,
  compareToExpectation,
  completeResults,
  endoraClosure,
  evaluateA1,
  evaluateA3,
  evaluateA4,
  evaluateA10,
  evaluateA11,
  evaluateA14,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  expectationRefusals,
  formatReport,
  reconcileFigures,
  WIRING_LINE_BOUND,
  type AcceptanceExpectation,
  type AssertionResult,
} from '../../../scripts/acceptance/instance-assertions.js';

describe('A1 — the created tree names nothing above itself', () => {
  it('passes on an empty derivation', () => {
    expect(evaluateA1([]).state).toBe('pass');
  });

  it('fails naming the file and the specifier', () => {
    const result = evaluateA1([{ file: 'backend/src/index.ts', specifier: '../../../shared' }]);
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('backend/src/index.ts');
    expect(result.detail).toContain('../../../shared');
  });
});

describe('A3 — it migrates, in the order the instance computed', () => {
  const order = ['MigrationA', 'MigrationB', 'MigrationC'];

  it('passes when the applied order is the computed one', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: '',
      computedOrder: order,
      applied: { kind: 'read', names: order },
    });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('3 migrations applied');
  });

  it('fails on a non-zero exit, quoting the end of the output', () => {
    const result = evaluateA3({
      migrateCode: 1,
      migrateOutput: 'lots\nof\nnoise\nrelation "product_attributes" does not exist',
      computedOrder: null,
      applied: null,
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('product_attributes');
  });

  /**
   * The finding this criterion's first run produced, and the one a
   * `string[] | null` could not express: the root script matched no project,
   * printed `No projects matched the filters` and exited **0**.
   */
  it('fails — not unmeasured — when an exit-0 run left no migrations table', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: 'No projects matched the filters in "/tmp/instance"',
      computedOrder: null,
      applied: { kind: 'absent' },
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('no `mikro_orm_migrations` table');
    expect(result.detail).toContain('An exit code is not evidence');
  });

  it('fails when the table is there and empty', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: '',
      computedOrder: order,
      applied: { kind: 'read', names: [] },
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('is empty');
  });

  it('fails on a divergent order, naming the first position', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: '',
      computedOrder: order,
      applied: { kind: 'read', names: ['MigrationB', 'MigrationA', 'MigrationC'] },
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('position 0');
    expect(result.detail).toContain('computed MigrationA');
    expect(result.detail).toContain('applied MigrationB');
  });

  it('is unmeasured — not a pass — when the computed order could not be read back', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: '',
      computedOrder: null,
      applied: { kind: 'read', names: order },
    });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('the half a pass would be claiming');
  });

  it('is unmeasured — not a failure — when the database could not be read', () => {
    const result = evaluateA3({
      migrateCode: 0,
      migrateOutput: '',
      computedOrder: order,
      applied: { kind: 'unreadable', error: 'ECONNREFUSED' },
    });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('ECONNREFUSED');
  });

  it('is unmeasured when there was no migrator at all', () => {
    expect(
      evaluateA3({
        migrateCode: null,
        migrateOutput: '',
        computedOrder: null,
        applied: null,
      }).state,
    ).toBe('unmeasured');
  });
});

describe('A4 — it boots, and the reconcile accounts for every module', () => {
  const booted = {
    started: true,
    healthStatus: 200,
    reconcile: { installed: 20, skipped: 6, failed: 0 },
    enumerated: 26,
    output: '',
  };

  it('passes on the arithmetic', () => {
    const result = evaluateA4(booted);
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('all 26');
  });

  /**
   * `boot-gate.sh`'s measured reason, restated here: a cheerful non-zero
   * `installed` stands over a platform whose other modules serve raw keys.
   */
  it('fails when installed is non-zero and the arithmetic is short', () => {
    const result = evaluateA4({
      ...booted,
      reconcile: { installed: 6, skipped: 0, failed: 0 },
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('accounts for 6 modules');
    expect(result.detail).toContain('enumerates 26');
  });

  it('fails on a reconcile that reports a failure', () => {
    const result = evaluateA4({ ...booted, reconcile: { installed: 20, skipped: 5, failed: 1 } });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('failed=1');
  });

  it('fails when the health route never answered, quoting the boot output', () => {
    const result = evaluateA4({
      ...booted,
      healthStatus: null,
      output: 'No projects matched the filters in "/tmp/instance"',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('No projects matched the filters');
  });

  it('fails on a health status that is not 200', () => {
    expect(evaluateA4({ ...booted, healthStatus: 503 }).state).toBe('fail');
  });

  it('fails when the boot printed no reconcile line at all', () => {
    const result = evaluateA4({ ...booted, reconcile: null });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('raw i18n keys');
  });

  it('is unmeasured — not a pass — when the presence route gave no count', () => {
    const result = evaluateA4({ ...booted, enumerated: null });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('`installed > 0` is all a pass could mean');
  });

  it('is unmeasured when there was nothing built to boot', () => {
    expect(
      evaluateA4({
        started: false,
        healthStatus: null,
        reconcile: null,
        enumerated: null,
        output: '',
      }).state,
    ).toBe('unmeasured');
  });
});

describe('reconcileFigures — the last line, not the first', () => {
  it('reads the three fields', () => {
    expect(reconcileFigures('[i18n] reconcile complete — installed=4 skipped=1 failed=0')).toEqual({
      installed: 4,
      skipped: 1,
      failed: 0,
    });
  });

  it('takes the last line, because an admin route runs the same reconcile', () => {
    const log = [
      '[i18n] reconcile complete — installed=1 skipped=0 failed=0',
      'serving',
      '[i18n] reconcile complete — installed=9 skipped=2 failed=0',
    ].join('\n');
    expect(reconcileFigures(log)?.installed).toBe(9);
  });

  it('sees through the colour codes a real boot log carries', () => {
    expect(
      reconcileFigures('[90m[i18n] reconcile complete — installed=2 skipped=0 failed=0'),
    ).not.toBeNull();
  });

  it('is null for a log with no such line, and for one it cannot read', () => {
    expect(reconcileFigures('nothing here')).toBeNull();
    expect(reconcileFigures('[i18n] reconcile complete — installed=? skipped=1 failed=0')).toBeNull();
  });
});

describe('A10 — refused before writing, with the platform own sentence', () => {
  const sentence = 'Every B2B document is addressed; there is no transaction without one.';
  const refusal = {
    exitCode: 1,
    output: `cannot compose: addresses is required — ${sentence}\n  remedy: --module addresses`,
    wroteAnything: false,
    platformSentences: [sentence],
  };

  it('passes on all three claims', () => {
    const result = evaluateA10(refusal);
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('nothing written');
  });

  it('fails on the wrong exit code', () => {
    expect(evaluateA10({ ...refusal, exitCode: 2 }).state).toBe('fail');
  });

  it('fails when the refusal wrote something', () => {
    const result = evaluateA10({ ...refusal, wroteAnything: true });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('wrote before validating');
  });

  /** R5.6 and D-100: a second copy of a derived fact is what this catches. */
  it('fails when the refusal quotes none of the manifests own sentences', () => {
    const result = evaluateA10({
      ...refusal,
      output: 'cannot compose: addresses is required. See the documentation.',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('second copy of a derived fact');
  });

  it('is unmeasured when no manifest declared a sentence to hold it to', () => {
    const result = evaluateA10({ ...refusal, platformSentences: [] });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('could only have checked the exit code');
  });
});

describe('A11 — no file of the platform, and none of the shell', () => {
  const tree = [
    { path: 'package.json', digest: 'aaa' },
    { path: 'backend/src/index.ts', digest: 'bbb' },
  ];
  const shipped = [
    {
      packageName: '@endora-commerce/platform',
      resolved: true,
      files: [{ path: 'dist/index.js', digest: 'ccc' }],
    },
    {
      packageName: '@endora-commerce/admin-shell',
      resolved: true,
      files: [{ path: 'dist/App.js', digest: 'ddd' }],
    },
  ];

  it('passes when nothing in the tree is byte-identical to anything shipped', () => {
    const result = evaluateA11(tree, shipped);
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('2 files');
  });

  /**
   * By digest rather than by path, which is the stronger reading of *"never
   * against a list written into the criterion"*: a copied file put somewhere
   * else is the same violation.
   */
  it('fails on a copy the tree put under a different name', () => {
    const result = evaluateA11(
      [...tree, { path: 'backend/src/vendored/compose.js', digest: 'ccc' }],
      shipped,
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('backend/src/vendored/compose.js');
    expect(result.detail).toContain('@endora-commerce/platform/dist/index.js');
  });

  it('is unmeasured — not a pass — when one of the two packages does not resolve', () => {
    const result = evaluateA11(tree, [
      shipped[0]!,
      { packageName: '@endora-commerce/admin-shell', resolved: false, files: [] },
    ]);
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('@endora-commerce/admin-shell');
    expect(result.detail).toContain('vacuously true');
    // The half that does have a subject is still reported, so the information
    // is not lost with the colour.
    expect(result.detail).toContain('pass —');
  });

  it('is unmeasured when a resolved package ships nothing this run could read', () => {
    const result = evaluateA11(tree, [
      shipped[0]!,
      { packageName: '@endora-commerce/admin-shell', resolved: true, files: [] },
    ]);
    expect(result.state).toBe('unmeasured');
  });

  it('is unmeasured when neither package resolved at all', () => {
    expect(evaluateA11(tree, []).state).toBe('unmeasured');
  });
});

describe('A14 — the wiring bound, measured on the created tree', () => {
  it('passes under the bound', () => {
    const result = evaluateA14({
      declared: 2,
      files: [
        { path: 'backend/src/index.ts', lines: 100 },
        { path: 'backend/src/worker.ts', lines: 60 },
      ],
    });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('160 lines');
  });

  it('fails at the bound, naming the largest files', () => {
    const result = evaluateA14({
      declared: 2,
      files: [
        { path: 'backend/src/index.ts', lines: WIRING_LINE_BOUND },
        { path: 'backend/src/worker.ts', lines: 10 },
      ],
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('backend/src/index.ts');
  });

  it('is unmeasured when a declared wiring file is not on disk', () => {
    const result = evaluateA14({
      declared: 3,
      files: [{ path: 'backend/src/index.ts', lines: 100 }],
    });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('short by whatever is not');
  });

  it('is unmeasured when the command classified nothing as wiring', () => {
    const result = evaluateA14({ declared: 0, files: [] });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('empty set');
  });
});

describe('evaluateProcess', () => {
  it('passes on exit 0 with the detail it was given', () => {
    expect(evaluateProcess('A2', 0, '', 'it installed').detail).toBe('it installed');
  });

  it('fails on a non-zero exit, quoting the tail', () => {
    const result = evaluateProcess('A2', 1, 'a\nb\nERR_PNPM_FETCH_404', 'unused');
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('ERR_PNPM_FETCH_404');
  });
});

describe('the exit code', () => {
  const at = (state: AssertionResult['state']): AssertionResult => ({ id: 'A1', state, detail: '' });

  it('is 0 only when everything passed', () => {
    expect(exitCodeFor([at('pass'), at('pass')])).toBe(0);
  });

  it('is 1 when something was measured and failed', () => {
    expect(exitCodeFor([at('pass'), at('fail')])).toBe(1);
  });

  it('is 2 when something could not be measured, and 1 still wins over it', () => {
    expect(exitCodeFor([at('pass'), at('unmeasured')])).toBe(2);
    expect(exitCodeFor([at('fail'), at('unmeasured')])).toBe(1);
  });
});

describe('completeResults — an id no step answered is named, never dropped', () => {
  it('fills every catalogued assertion', () => {
    const complete = completeResults([{ id: 'A1', state: 'pass', detail: 'ok' }]);
    expect(complete.map((result) => result.id)).toEqual([...ASSERTION_IDS]);
    expect(complete.find((result) => result.id === 'A7')?.state).toBe('unmeasured');
    expect(complete.find((result) => result.id === 'A7')?.detail).toContain('no step of this run');
  });

  it('carries a title for every id, so a report can name one nothing answered', () => {
    for (const id of ASSERTION_IDS) expect(ASSERTION_CATALOGUE[id].length).toBeGreaterThan(20);
  });
});

describe('expectationRefusals — the record has to name what it waits on', () => {
  const recorded = (
    assertions: Record<string, { status: AssertionResult['state']; reason: string }>,
  ): AcceptanceExpectation => ({ modes: { tarball: { state: 'recorded', assertions } } });

  it('accepts a pass with any reason, and a non-pass naming a task', () => {
    expect(
      expectationRefusals(
        recorded({
          A1: { status: 'pass', reason: 'it works' },
          A5: { status: 'unmeasured', reason: 'waits on T138' },
        }),
      ),
    ).toEqual([]);
  });

  it('accepts a non-pass naming a contract', () => {
    expect(
      expectationRefusals(
        recorded({ A8: { status: 'unmeasured', reason: 'contracts/instance-tree.md §2.6' } }),
      ),
    ).toEqual([]);
  });

  /** The row's own words: *never "unimplemented"*. */
  it('refuses each of the four empty spellings', () => {
    for (const reason of ['unimplemented', 'not implemented', 'TODO', 'Not started.']) {
      const refusals = expectationRefusals(recorded({ A5: { status: 'unmeasured', reason } }));
      expect(refusals, reason).toHaveLength(1);
      expect(refusals[0]).toContain('never unimplemented');
    }
  });

  it('refuses a non-pass with no reason at all', () => {
    expect(expectationRefusals(recorded({ A5: { status: 'fail', reason: '  ' } }))[0]).toContain(
      'carries no reason',
    );
  });

  it('refuses a reason that names neither a task nor a contract', () => {
    expect(
      expectationRefusals(recorded({ A5: { status: 'fail', reason: 'the admin is missing' } }))[0],
    ).toContain('names neither a task');
  });

  it('refuses a recorded mode with no assertion, and an expectation with no mode', () => {
    expect(expectationRefusals(recorded({}))[0]).toContain('records no assertion');
    expect(expectationRefusals({ modes: {} })[0]).toContain('no mode at all');
  });

  it('says nothing about an unrun mode, which owes no states', () => {
    expect(expectationRefusals({ modes: { registry: { state: 'unrun' } } })).toEqual([]);
  });
});

describe('compareToExpectation — both directions', () => {
  const expectation: AcceptanceExpectation = {
    modes: {
      tarball: {
        state: 'recorded',
        assertions: {
          A1: { status: 'pass', reason: '' },
          A3: { status: 'fail', reason: 'T141' },
        },
      },
      registry: { state: 'unrun' },
    },
  };

  it('is silent when the run agrees', () => {
    expect(
      compareToExpectation(
        [
          { id: 'A1', state: 'pass', detail: '' },
          { id: 'A3', state: 'fail', detail: '' },
        ],
        expectation,
        'tarball',
      ),
    ).toEqual([]);
  });

  it('drifts on a newly-red assertion', () => {
    expect(
      compareToExpectation(
        [
          { id: 'A1', state: 'fail', detail: '' },
          { id: 'A3', state: 'fail', detail: '' },
        ],
        expectation,
        'tarball',
      )[0],
    ).toContain('recorded pass, measured fail');
  });

  it('drifts on a newly-green one nobody recorded', () => {
    expect(
      compareToExpectation(
        [
          { id: 'A1', state: 'pass', detail: '' },
          { id: 'A3', state: 'pass', detail: '' },
        ],
        expectation,
        'tarball',
      )[0],
    ).toContain('recorded fail, measured pass');
  });

  it('drifts on an assertion the record does not hold', () => {
    expect(
      compareToExpectation([{ id: 'A9', state: 'pass', detail: '' }], expectation, 'tarball').join(
        ' ',
      ),
    ).toContain('A9 is not recorded');
  });

  it('drifts on a recorded assertion the run never evaluated', () => {
    expect(
      compareToExpectation([{ id: 'A1', state: 'pass', detail: '' }], expectation, 'tarball').join(
        ' ',
      ),
    ).toContain('A3 is recorded but this run did not evaluate it');
  });

  it('drifts on every assertion of a mode recorded as unrun', () => {
    const drift = compareToExpectation(
      [{ id: 'A1', state: 'pass', detail: '' }],
      expectation,
      'registry',
    );
    expect(drift.join(' ')).toContain('recorded as unrun');
    expect(drift[drift.length - 1]).toContain('rather than from a prediction');
  });

  it('drifts when the run took a mode the record has never heard of', () => {
    expect(
      compareToExpectation(
        [{ id: 'A1', state: 'pass', detail: '' }],
        { modes: {} },
        'tarball',
      )[0],
    ).toContain('records no such mode');
  });

  it('turns drift into exit 1 and agreement into exit 0', () => {
    expect(exitCodeForExpectation([])).toBe(0);
    expect(exitCodeForExpectation(['something'])).toBe(1);
  });
});

describe('endoraClosure — what the instance really installs', () => {
  const manifests = new Map([
    [
      '@endora-commerce/mod-orders',
      {
        dependencies: ['@endora-commerce/platform'],
        requiredPeers: ['@endora-commerce/mod-invoices', 'react'],
      },
    ],
    [
      '@endora-commerce/platform',
      { dependencies: ['@endora-commerce/contracts'], requiredPeers: [] },
    ],
    ['@endora-commerce/mod-invoices', { dependencies: [], requiredPeers: [] }],
    ['@endora-commerce/contracts', { dependencies: [], requiredPeers: [] }],
  ]);

  it('closes over dependencies and non-optional peers alike', () => {
    const closure = endoraClosure(['@endora-commerce/mod-orders'], manifests);
    expect(closure.all).toEqual([
      '@endora-commerce/contracts',
      '@endora-commerce/mod-invoices',
      '@endora-commerce/mod-orders',
      '@endora-commerce/platform',
    ]);
    // The finding, not only the input: three of these arrive without the
    // instance's manifest naming any of them.
    expect(closure.extras).toEqual([
      '@endora-commerce/contracts',
      '@endora-commerce/mod-invoices',
      '@endora-commerce/platform',
    ]);
  });

  it('leaves a peer out when the declaration marks it optional', () => {
    const optional = new Map(manifests);
    optional.set('@endora-commerce/mod-orders', {
      dependencies: ['@endora-commerce/platform'],
      requiredPeers: [],
    });
    expect(endoraClosure(['@endora-commerce/mod-orders'], optional).all).not.toContain(
      '@endora-commerce/mod-invoices',
    );
  });

  it('takes no foreign package into the closure, whatever a manifest declares', () => {
    expect(endoraClosure(['@endora-commerce/mod-orders'], manifests).all).not.toContain('react');
  });

  it('terminates on a cycle', () => {
    const cyclic = new Map([
      ['a', { dependencies: ['@endora-commerce/b'], requiredPeers: [] }],
      ['@endora-commerce/b', { dependencies: ['@endora-commerce/a'], requiredPeers: [] }],
      ['@endora-commerce/a', { dependencies: ['@endora-commerce/b'], requiredPeers: [] }],
    ]);
    expect(endoraClosure(['@endora-commerce/a'], cyclic).all).toEqual([
      '@endora-commerce/a',
      '@endora-commerce/b',
    ]);
  });
});

describe('formatReport', () => {
  it('names the mode on the arithmetic line', () => {
    const report = formatReport(
      [
        { id: 'A1', state: 'pass', detail: 'fine' },
        { id: 'A3', state: 'fail', detail: 'not fine' },
      ],
      ['a note'],
      'registry',
    );
    expect(report).toContain('A1 PASS — fine');
    expect(report).toContain('note: a note');
    expect(report).toContain('mode=registry pass=1 fail=1 unmeasured=0 of 2');
  });
});
