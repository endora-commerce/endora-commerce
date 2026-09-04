/**
 * The storefront-scaffold criterion's judgement, one red proof per finding.
 *
 * Every fixture enters at the top of the analysis — the outward-reference list,
 * the manifest text, the resolved paths — never a verdict the script normally
 * computes (issue #130). That is what lets these run in the fast suite while the
 * criterion itself needs an install, a build and a backend.
 */
import { describe, expect, it } from 'vitest';

import {
  compareToExpectation,
  evaluateA1,
  evaluateA2,
  evaluateA4,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  formatReport,
} from '../../../scripts/acceptance/storefront-scaffold-assertions.js';

describe('A1 — the copy names nothing above its own directory', () => {
  it('passes on an empty derivation', () => {
    expect(evaluateA1([]).state).toBe('pass');
  });

  it('fails, naming every survivor', () => {
    const result = evaluateA1([{ file: 'tsconfig.json', specifier: '../tsconfig.base.json' }]);
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('tsconfig.json -> ../tsconfig.base.json');
  });
});

describe('A2 — no `workspace:` range survives', () => {
  it('passes on published semver', () => {
    expect(
      evaluateA2(JSON.stringify({ dependencies: { '@e/contracts': '1.4.2' } })).state,
    ).toBe('pass');
  });

  it('fails on a range in any dependency field, not only `dependencies`', () => {
    const result = evaluateA2(
      JSON.stringify({
        dependencies: { '@e/contracts': '1.4.2' },
        devDependencies: { '@e/cli': 'workspace:^' },
      }),
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('devDependencies.@e/cli=workspace:^');
  });
});

describe('A4 — the install left no path back into the checkout', () => {
  it('passes when every package resolved outside it', () => {
    expect(
      evaluateA4(
        [{ specifier: '@e/contracts', realPath: '/tmp/instance/node_modules/.pnpm/x' }],
        '/repo',
      ).state,
    ).toBe('pass');
  });

  it('fails on a resolution inside the checkout — the trap the criterion exists to leave', () => {
    const result = evaluateA4(
      [{ specifier: '@e/contracts', realPath: '/repo/packages/contracts' }],
      '/repo',
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('measured the repository rather than an install');
  });

  it('is unmeasured, never a pass, when nothing resolved at all', () => {
    // An empty list satisfies "none is inside" vacuously. Reporting that as a
    // pass is the green-that-means-not-looking this estate refuses everywhere.
    expect(evaluateA4([], '/repo').state).toBe('unmeasured');
  });
});

describe('a process assertion', () => {
  it('passes on exit 0 and carries the tail of the output otherwise', () => {
    expect(evaluateProcess('A5', 0, '', 'built').state).toBe('pass');
    const failed = evaluateProcess('A5', 1, 'line1\nModule not found\n', 'built');
    expect(failed.state).toBe('fail');
    expect(failed.detail).toContain('Module not found');
  });
});

describe('the run\'s exit code', () => {
  it('is 2 for anything unmeasured, 1 for a failure, 0 for all pass — never merged', () => {
    const pass = { id: 'A1', state: 'pass', detail: '' } as const;
    const fail = { id: 'A2', state: 'fail', detail: '' } as const;
    const unmeasured = { id: 'A3', state: 'unmeasured', detail: '' } as const;
    expect(exitCodeFor([pass])).toBe(0);
    expect(exitCodeFor([pass, fail])).toBe(1);
    expect(exitCodeFor([pass, fail, unmeasured])).toBe(2);
  });
});

describe('the expectation is compared in both directions, per supply route', () => {
  const results = [
    { id: 'A1', state: 'pass', detail: '' },
    { id: 'A2', state: 'pass', detail: '' },
  ] as const;

  const recorded = (
    assertions: Record<string, 'pass' | 'fail' | 'unmeasured'>,
  ): { modes: Record<string, { state: 'recorded'; assertions: typeof assertions }> } => ({
    modes: { tarball: { state: 'recorded', assertions } },
  });

  it('is silent when the run agrees', () => {
    const drift = compareToExpectation(results, recorded({ A1: 'pass', A2: 'pass' }), 'tarball');
    expect(drift).toEqual([]);
    expect(exitCodeForExpectation(drift)).toBe(0);
  });

  it('fails a newly-red assertion', () => {
    const drift = compareToExpectation(
      [{ id: 'A1', state: 'fail', detail: '' }],
      recorded({ A1: 'pass' }),
      'tarball',
    );
    expect(drift).toEqual(['A1: recorded pass, measured fail']);
  });

  it('fails a newly-green assertion nobody recorded', () => {
    const drift = compareToExpectation(
      results,
      recorded({ A1: 'pass', A2: 'unmeasured' }),
      'tarball',
    );
    expect(drift).toEqual(['A2: recorded unmeasured, measured pass']);
    expect(exitCodeForExpectation(drift)).toBe(1);
  });

  it('fails an assertion the run stopped evaluating, and one it never recorded', () => {
    expect(compareToExpectation(results, recorded({ A1: 'pass' }), 'tarball')).toEqual([
      'A2 is not recorded in the expectation\'s "tarball" mode (it is pass)',
    ]);
    expect(
      compareToExpectation(results, recorded({ A1: 'pass', A2: 'pass', A9: 'pass' }), 'tarball'),
    ).toEqual(['A9 is recorded but this run did not evaluate it']);
  });

  it('reads the block of the mode the run took, and never the other one', () => {
    // The two routes are recorded apart because `A3 pass` means "a packed file
    // installed" under one and "a published version resolved" under the other.
    // A comparison that read whichever block came first would answer one
    // question with the other's record.
    const expectation = {
      modes: {
        tarball: { state: 'recorded' as const, assertions: { A1: 'pass' as const } },
        registry: { state: 'recorded' as const, assertions: { A1: 'fail' as const } },
      },
    };
    const measured = [{ id: 'A1', state: 'pass', detail: '' }] as const;
    expect(compareToExpectation(measured, expectation, 'tarball')).toEqual([]);
    expect(compareToExpectation(measured, expectation, 'registry')).toEqual([
      'A1: recorded fail, measured pass',
    ]);
  });

  it('fails a mode the expectation records nothing about', () => {
    const drift = compareToExpectation(results, recorded({ A1: 'pass', A2: 'pass' }), 'registry');
    expect(drift).toEqual([
      expect.stringContaining('the expectation records no such mode') as unknown as string,
    ]);
    expect(exitCodeForExpectation(drift)).toBe(1);
  });

  it('fails the first run of an `unrun` mode, naming every state it measured', () => {
    // `unrun` is not an empty `recorded`: a route nobody has run owes no states,
    // and the alternative — six predicted ones — is the guess the whole file
    // refuses. So the first real run drifts and the record comes from it.
    const drift = compareToExpectation(results, { modes: { registry: { state: 'unrun' } } }, 'registry');
    expect(drift).toContain('A1: the "registry" mode is recorded as unrun and this run measured pass');
    expect(drift).toContain('A2: the "registry" mode is recorded as unrun and this run measured pass');
    expect(drift.at(-1)).toContain('record the "registry" mode\'s six states from this run');
    expect(exitCodeForExpectation(drift)).toBe(1);
  });

  it('fails a mode state it cannot read, rather than treating it as recorded', () => {
    const drift = compareToExpectation(
      results,
      { modes: { tarball: { state: 'provisional' as unknown as 'recorded' } } },
      'tarball',
    );
    expect(drift).toEqual([
      expect.stringContaining('neither `recorded` nor `unrun`') as unknown as string,
    ]);
  });
});

describe('the report', () => {
  it('prints one line per assertion and an arithmetic line that accounts for all of them', () => {
    const text = formatReport(
      [
        { id: 'A1', state: 'pass', detail: 'ok' },
        { id: 'A2', state: 'fail', detail: 'no' },
        { id: 'A3', state: 'unmeasured', detail: 'maybe' },
      ],
      ['a note'],
      'tarball',
    );
    expect(text).toContain('[storefront-acceptance] A1 PASS — ok');
    expect(text).toContain('[storefront-acceptance] note: a note');
    expect(text).toContain('mode=tarball pass=1 fail=1 unmeasured=1 of 3');
  });

  it('names the supply route, because the same six states mean different things under each', () => {
    const results = [{ id: 'A3', state: 'pass', detail: 'installed' }] as const;
    expect(formatReport(results, [], 'registry')).toContain('mode=registry');
    expect(formatReport(results, [], 'tarball')).toContain('mode=tarball');
  });
});
