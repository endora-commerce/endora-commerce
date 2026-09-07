/**
 * The storefront-scaffold criterion's judgement, one red proof per finding.
 *
 * Every fixture enters at the top of the analysis — the outward-reference list,
 * the manifest text, the resolved paths — never a verdict the script normally
 * computes (issue #130). That is what lets these run in the fast suite while the
 * criterion itself needs an install, a build and a backend.
 */
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canonicalHrefIn,
  compareToExpectation,
  COMPILED_IN_SITE_ORIGIN,
  evaluateA1,
  evaluateA2,
  evaluateA4,
  evaluateA6,
  evaluateA7,
  evaluateProcess,
  exitCodeFor,
  exitCodeForExpectation,
  formatReport,
  instanceEnvironment,
  planScaffoldInputs,
  SCAFFOLD_INPUT_STAND_INS,
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

/**
 * A6 — the built storefront boots, and the run can tell what it booted against.
 *
 * The assertion used to be the status line alone, and that made it blind in the
 * one direction that mattered: the storefront's fetchers fall back to a
 * compiled-in `http://localhost:3001` when no backend variable is set, so a run
 * whose configured backend happened to sit there answered 200 whether or not a
 * single variable had reached the process. Measured on `master`: booting the
 * scaffolded instance with the backend named in a variable nothing reads
 * answered 200 with the backend at the fallback address and 500 with it
 * anywhere else — a green that was the fallback's and not the criterion's.
 *
 * So a pass now needs two boots: the configured one answering, and a probe
 * against an address nothing listens on answering 5xx. A probe that answers
 * anything else is `unmeasured` — never a pass and never a failure of the
 * criterion — because at that point the run cannot tell a reached backend from
 * the fallback (issue #113).
 */
describe('A6 — the boot, and its discrimination probe', () => {
  const probeAddress = 'http://127.0.0.1:1';

  it('passes when the configured boot answered and the probe refused', () => {
    const result = evaluateA6({
      backend: 'http://127.0.0.1:3001',
      status: 200,
      probeStatus: 500,
      probeAddress,
    });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('200');
    expect(result.detail).toContain('http://127.0.0.1:3001');
  });

  it('fails on a 5xx from the configured boot, naming the backend it was pointed at', () => {
    const result = evaluateA6({
      backend: 'http://127.0.0.1:3001',
      status: 500,
      probeStatus: 500,
      probeAddress,
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('500');
  });

  it('fails when the boot never answered', () => {
    const result = evaluateA6({
      backend: 'http://127.0.0.1:3001',
      status: null,
      probeStatus: 500,
      probeAddress,
      output: 'Error: listen EADDRINUSE',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('EADDRINUSE');
  });

  it('is unmeasured when the probe answered as though the backend were reachable', () => {
    const result = evaluateA6({
      backend: 'http://127.0.0.1:3001',
      status: 200,
      probeStatus: 200,
      probeAddress,
    });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain(probeAddress);
  });

  it('is unmeasured when the probe never answered, which proves nothing either', () => {
    const result = evaluateA6({
      backend: 'http://127.0.0.1:3001',
      status: 200,
      probeStatus: null,
      probeAddress,
    });
    expect(result.state).toBe('unmeasured');
  });

  it('is unmeasured when no backend was configured at all', () => {
    const result = evaluateA6({
      backend: null,
      status: null,
      probeStatus: null,
      probeAddress,
    });
    expect(result.state).toBe('unmeasured');
  });
});

/**
 * A7 — the served canonical names the origin the instance was built with.
 *
 * These are the judgement's proofs; the criterion's own run is what supplies a
 * real page. The fixtures enter as **served HTML** rather than as a parsed
 * canonical, so `canonicalHrefIn` — the half that has to survive Next changing
 * its attribute order — is inside every one of them (issue #130).
 */
describe('A7 — the canonical names the configured public origin', () => {
  const page = (head: string): string =>
    `<!DOCTYPE html><html><head>${head}</head><body>shop</body></html>`;

  it('passes when the canonical carries the origin this run built with', () => {
    const result = evaluateA7({
      configured: 'https://shop.acceptance.invalid',
      canonical: 'https://shop.acceptance.invalid/',
      path: '/',
    });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('shop.acceptance.invalid');
  });

  /**
   * The defect this whole branch is about, as one assertion: a storefront built
   * with no `NEXT_PUBLIC_SITE_URL` serves the compiled-in origin, and says
   * nothing. The report names the fallback by name so its reader is not left to
   * recognise the address.
   */
  it('fails on the compiled-in fallback, and says that is what it is', () => {
    const result = evaluateA7({
      configured: 'https://shop.acceptance.invalid',
      canonical: `${COMPILED_IN_SITE_ORIGIN}/`,
      path: '/',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('compiled-in fallback');
  });

  it('fails on any other origin, without claiming it is the fallback', () => {
    const result = evaluateA7({
      configured: 'https://shop.acceptance.invalid',
      canonical: 'https://somewhere.else.invalid/',
      path: '/',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).not.toContain('compiled-in fallback');
  });

  it('ignores the path: a canonical is judged on its origin', () => {
    expect(
      evaluateA7({
        configured: 'https://shop.acceptance.invalid',
        canonical: 'https://shop.acceptance.invalid/c/pumps?page=2',
        path: '/c/pumps',
      }).state,
    ).toBe('pass');
  });

  it('is unmeasured when the page carried no canonical — never a pass', () => {
    const result = evaluateA7({
      configured: 'https://shop.acceptance.invalid',
      canonical: canonicalHrefIn(page('<title>shop</title>')),
      path: '/',
    });
    expect(result.state).toBe('unmeasured');
  });

  it('is unmeasured when no public origin was configured', () => {
    expect(
      evaluateA7({ configured: null, canonical: 'http://localhost:3000/', path: '/' }).state,
    ).toBe('unmeasured');
  });

  it('fails on a canonical that is not a URL at all', () => {
    expect(
      evaluateA7({
        configured: 'https://shop.acceptance.invalid',
        canonical: '/relative/only',
        path: '/',
      }).state,
    ).toBe('fail');
  });

  describe('reading the canonical out of the served page', () => {
    it('finds it whatever the attribute order and quoting', () => {
      expect(canonicalHrefIn(page('<link rel="canonical" href="https://a.invalid/"/>'))).toBe(
        'https://a.invalid/',
      );
      expect(canonicalHrefIn(page("<link href='https://b.invalid/' rel='canonical'>"))).toBe(
        'https://b.invalid/',
      );
      expect(canonicalHrefIn(page('<link REL=CANONICAL HREF=https://c.invalid/>'))).toBe(
        'https://c.invalid/',
      );
    });

    it('is not fooled by another link in the same head', () => {
      expect(
        canonicalHrefIn(
          page(
            '<link rel="preload" href="https://cdn.invalid/x.js">' +
              '<link rel="canonical" href="https://a.invalid/">' +
              '<link rel="alternate" href="https://a.invalid/pl">',
          ),
        ),
      ).toBe('https://a.invalid/');
    });

    it('answers null rather than guessing when there is none', () => {
      expect(canonicalHrefIn(page('<link rel="icon" href="/favicon.ico">'))).toBeNull();
      expect(canonicalHrefIn('')).toBeNull();
      // A canonical tag with no href says which page nothing.
      expect(canonicalHrefIn(page('<link rel="canonical">'))).toBeNull();
    });
  });
});

describe('the inputs the criterion supplies to `endora new storefront`', () => {
  const envExample = new Map([
    ['BACKEND_BASE_URL', 'http://localhost:3001'],
    ['NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001'],
    ['NEXT_PUBLIC_SALES_CHANNEL_CODE', 'pl_default'],
    ['REVALIDATE_SECRET', 'change-me-shared-with-backend'],
  ]);

  it('points every backend-address variable at the backend this run booted', () => {
    const plan = planScaffoldInputs({
      required: ['BACKEND_BASE_URL', 'NEXT_PUBLIC_API_BASE_URL'],
      backendAddressVariables: ['BACKEND_BASE_URL', 'NEXT_PUBLIC_API_BASE_URL'],
      storefrontAddressVariables: [],
      backend: 'http://127.0.0.1:3001',
      storefront: null,
      envExample,
      standIns: {},
    });
    expect(plan.unanswerable).toEqual([]);
    expect(plan.values.get('BACKEND_BASE_URL')).toBe('http://127.0.0.1:3001');
    expect(plan.values.get('NEXT_PUBLIC_API_BASE_URL')).toBe('http://127.0.0.1:3001');
  });

  it('falls back to the copy\'s own example address when this run booted no backend', () => {
    const plan = planScaffoldInputs({
      required: ['BACKEND_BASE_URL'],
      backendAddressVariables: ['BACKEND_BASE_URL'],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: {},
    });
    expect(plan.values.get('BACKEND_BASE_URL')).toBe('http://localhost:3001');
    expect(plan.unanswerable).toEqual([]);
  });

  it('takes every other required input from the copy\'s own `.env.example`', () => {
    const plan = planScaffoldInputs({
      required: ['NEXT_PUBLIC_SALES_CHANNEL_CODE', 'REVALIDATE_SECRET'],
      backendAddressVariables: [],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: {},
    });
    expect(plan.values.get('NEXT_PUBLIC_SALES_CHANNEL_CODE')).toBe('pl_default');
    expect(plan.values.get('REVALIDATE_SECRET')).toBe('change-me-shared-with-backend');
  });

  it('reports a required input no derivation reaches, rather than inventing one', () => {
    const plan = planScaffoldInputs({
      required: ['NEXT_PUBLIC_SITE_URL'],
      backendAddressVariables: [],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: {},
    });
    expect(plan.unanswerable).toEqual(['NEXT_PUBLIC_SITE_URL']);
    expect(plan.values.has('NEXT_PUBLIC_SITE_URL')).toBe(false);
  });

  it('answers one from the stand-in table, which carries its own reason', () => {
    const plan = planScaffoldInputs({
      required: ['NEXT_PUBLIC_SITE_URL'],
      backendAddressVariables: [],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: { NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3000' },
    });
    expect(plan.unanswerable).toEqual([]);
    expect(plan.values.get('NEXT_PUBLIC_SITE_URL')).toBe('http://127.0.0.1:3000');
    expect(plan.staleStandIns).toEqual([]);
  });

  it('reports a stand-in a derivation has caught up with, so the table drains', () => {
    const plan = planScaffoldInputs({
      required: ['REVALIDATE_SECRET'],
      backendAddressVariables: [],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: { REVALIDATE_SECRET: 'a-stand-in-nobody-needs-now' },
    });
    expect(plan.values.get('REVALIDATE_SECRET')).toBe('change-me-shared-with-backend');
    expect(plan.staleStandIns).toEqual(['REVALIDATE_SECRET']);
  });

  /**
   * The second address derivation, and the reason it is not the first one
   * widened.
   *
   * Both used to be one rule keyed on the shape of the value in `.env.example`.
   * That rule would now give `NEXT_PUBLIC_SITE_URL` the **backend's** address,
   * which is a canonical origin pointing at the API host — a wrong measurement
   * dressed as a configured one, in the assertion that exists to measure it.
   */
  it('points the storefront\'s own address variable at the origin this run builds with', () => {
    const plan = planScaffoldInputs({
      required: ['NEXT_PUBLIC_API_BASE_URL', 'NEXT_PUBLIC_SITE_URL'],
      backendAddressVariables: ['NEXT_PUBLIC_API_BASE_URL'],
      storefrontAddressVariables: ['NEXT_PUBLIC_SITE_URL'],
      backend: 'http://127.0.0.1:3001',
      storefront: 'https://shop.acceptance.invalid',
      envExample: new Map([
        ['NEXT_PUBLIC_API_BASE_URL', 'http://localhost:3001'],
        ['NEXT_PUBLIC_SITE_URL', 'http://localhost:3000'],
      ]),
      standIns: {},
    });
    expect(plan.values.get('NEXT_PUBLIC_API_BASE_URL')).toBe('http://127.0.0.1:3001');
    expect(plan.values.get('NEXT_PUBLIC_SITE_URL')).toBe('https://shop.acceptance.invalid');
    // The whole point of the second derivation: it is not the backend's.
    expect(plan.values.get('NEXT_PUBLIC_SITE_URL')).not.toBe('http://127.0.0.1:3001');
    // And it is not the origin an unconfigured storefront names, or A7 could
    // not tell a configured build from an unconfigured one.
    expect(plan.values.get('NEXT_PUBLIC_SITE_URL')).not.toBe(COMPILED_IN_SITE_ORIGIN);
  });

  it('falls back to the copy\'s own example origin when this run names none', () => {
    const plan = planScaffoldInputs({
      required: ['NEXT_PUBLIC_SITE_URL'],
      backendAddressVariables: [],
      storefrontAddressVariables: ['NEXT_PUBLIC_SITE_URL'],
      backend: null,
      storefront: null,
      envExample: new Map([['NEXT_PUBLIC_SITE_URL', 'http://localhost:3000']]),
      standIns: {},
    });
    expect(plan.values.get('NEXT_PUBLIC_SITE_URL')).toBe('http://localhost:3000');
    expect(plan.unanswerable).toEqual([]);
  });

  it('reports a stand-in for an input the storefront no longer declares required', () => {
    const plan = planScaffoldInputs({
      required: [],
      backendAddressVariables: [],
      storefrontAddressVariables: [],
      backend: null,
      storefront: null,
      envExample,
      standIns: { GONE_FROM_THE_DECLARATION: 'x' },
    });
    expect(plan.staleStandIns).toEqual(['GONE_FROM_THE_DECLARATION']);
  });
});

/**
 * The guard that would have caught this branch's own defect in seconds.
 *
 * The criterion runs the real command against a real backend, which is what
 * makes it valuable and what makes it slow: an install, a `next build` and two
 * boots, outside the checkout. So for as long as nobody ran it, the removal of
 * the storefront's invented defaults (feature 117, Phases 1–2) left it exiting
 * **2** — neither a pass nor a failure, every assertion unrun — and nothing in
 * `test:unit:fast` could say so.
 *
 * This is the cheap half of that measurement, and it is cheap only because the
 * repair extracted the criterion's input plan as a pure function: it reads the
 * two files the plan is derived from and asks whether the plan answers every
 * input the command will demand. It runs in the fast suite, needs no service and
 * no network, and it fails the moment a new required input is declared without a
 * value the criterion can reach.
 *
 * What it does **not** claim: that the criterion passes. A6 needs a backend and
 * `next build` needs an install. This answers one question — *would the command
 * refuse this invocation* — which is the question the branch got wrong.
 */
describe('the criterion supplies every input the reference storefront declares required', () => {
  it('answers all of them, from the two derivations and the stand-in table', async () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const storefrontDir = join(repoRoot, 'storefront');
    const {
      backendAddressVariablesOf,
      storefrontAddressVariablesOf,
      envExampleDeclarationsOf,
      storefrontDeclaredInputs,
    } = await import('@endora-commerce/cli');
    const { isRequiredGiven } = await import('@endora-commerce/contracts');

    const declared = await storefrontDeclaredInputs(repoRoot);
    expect(declared.length).toBeGreaterThan(0);
    const required = declared
      .filter((input) => isRequiredGiven(input, {}))
      .map((input) => input.name);
    // A declaration with no required input would make every assertion below
    // vacuously true, which is the one state this must not report as clean.
    expect(required.length).toBeGreaterThan(0);

    const plan = planScaffoldInputs({
      required,
      backendAddressVariables: await backendAddressVariablesOf(storefrontDir),
      storefrontAddressVariables: await storefrontAddressVariablesOf(storefrontDir),
      backend: 'http://127.0.0.1:3001',
      storefront: 'https://shop.acceptance.invalid',
      envExample: envExampleDeclarationsOf(storefrontDir),
      standIns: SCAFFOLD_INPUT_STAND_INS,
    });

    expect(plan.unanswerable).toEqual([]);
    expect(plan.staleStandIns).toEqual([]);
    expect([...plan.values.keys()].sort()).toEqual([...required].sort());
  });

  /**
   * The stand-in table is empty, and that is an assertion rather than a fact
   * about today.
   *
   * It held exactly one entry — `NEXT_PUBLIC_SITE_URL`, declared required and
   * supplied by nothing in the deployment path — whose written retiring
   * condition was *the moment any derivation reaches the variable*. Four
   * deployment-path edits and the storefront-address derivation are that
   * moment. Asserting the emptiness here is what stops the next author reaching
   * for the table before they have asked whether the tree can answer for
   * itself: a value the criterion invents is a value nobody reviewed, and the
   * table exists to make that visible, not to make it easy.
   */
  it('needs no stand-in: every required input has a derivation', () => {
    expect(Object.keys(SCAFFOLD_INPUT_STAND_INS)).toEqual([]);
  });
});

/**
 * The environment a process run **inside the instance** is given.
 *
 * **A5 had never once passed in CI when this was written** — 163 runs of
 * `acceptance:storefront-scaffold` since it landed on 2026-09-03, of which zero
 * succeeded — and the whole of the difference between a developer's machine and
 * the runner was one variable the criterion inherited and passed on:
 * `NODE_ENV=development`, which the job sets job-wide and correctly for the
 * **backend** it boots. Reproduced on this tree by exporting it and varying
 * nothing else, down to the chunk offset in the message.
 *
 * The message named Next's own `pages/_document`, and that is the shape worth
 * remembering rather than the variable: `next build` inlines
 * `process.env.NODE_ENV` as `"production"` into the server bundle it emits, so
 * the emitted `_document.js` requires `pages.runtime.prod.js` while the render
 * worker reads the real `NODE_ENV` and requires `pages.runtime.dev.js` — two
 * module instances, two `React.createContext()` calls, and an `<Html>` looking
 * for a provider installed on the other one. It is upstream and it is not this
 * repository's: a four-file `app/` with no dependency of ours in it fails
 * identically.
 *
 * So the rule under test is not about `NODE_ENV`. It is that Next does not let a
 * `.env` override a variable the process already carries, so **any** name the
 * instance declares that reaches it from the harness configures the instance
 * over the top of what `endora new storefront` wrote — a red for a value no
 * client would set, and, in the other direction, a green for a value the command
 * never produced.
 */
describe('the instance is given its own environment, not the harness‘s', () => {
  it('withholds a declared name the harness carries — the measured case', () => {
    const { overlay, withheld } = instanceEnvironment({
      ambient: { NODE_ENV: 'development', PATH: '/usr/bin' },
      declared: ['NODE_ENV', 'NEXT_PUBLIC_SITE_URL'],
      supplied: {},
    });
    expect(withheld).toEqual(['NODE_ENV']);
    // `undefined` rather than absent: the caller merges this over `process.env`,
    // and `child_process` drops an `undefined` value instead of exporting it, so
    // this is what makes the child see the variable unset.
    expect(Object.prototype.hasOwnProperty.call(overlay, 'NODE_ENV')).toBe(true);
    expect(overlay['NODE_ENV']).toBeUndefined();
  });

  it('leaves a name the instance does not declare alone', () => {
    const { overlay, withheld } = instanceEnvironment({
      ambient: { PATH: '/usr/bin', PUBLIC_API_BASE_URL: 'http://127.0.0.1:3001' },
      declared: ['NODE_ENV'],
      supplied: {},
    });
    // `PUBLIC_API_BASE_URL` is this harness's own input and no file in a
    // storefront reads it, so it is not the instance's to withhold.
    expect(withheld).toEqual([]);
    expect(Object.keys(overlay)).toEqual([]);
  });

  it('lets a value this run supplied win over one it merely inherited', () => {
    const { overlay, withheld } = instanceEnvironment({
      ambient: { NEXT_PUBLIC_API_BASE_URL: 'http://a-machine-nobody-asked-about:9999' },
      declared: ['NEXT_PUBLIC_API_BASE_URL'],
      supplied: { NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3001' },
    });
    // A6 points the instance at the backend this run booted. That is the
    // harness's deliberate configuration and is not an inheritance, so it is
    // neither withheld nor reported as one.
    expect(withheld).toEqual([]);
    expect(overlay['NEXT_PUBLIC_API_BASE_URL']).toBe('http://127.0.0.1:3001');
  });

  it('withholds a declared name the harness exported empty', () => {
    // `NODE_ENV=` is exported, reaches the child, and Next reads the empty
    // string — a state that is not "unset" and would be one if this compared
    // against falsiness rather than against `undefined`.
    const { withheld } = instanceEnvironment({
      ambient: { NODE_ENV: '' },
      declared: ['NODE_ENV'],
      supplied: {},
    });
    expect(withheld).toEqual(['NODE_ENV']);
  });

  it('says nothing about a declared name the harness does not carry', () => {
    const { overlay, withheld } = instanceEnvironment({
      ambient: { PATH: '/usr/bin' },
      declared: ['NODE_ENV', 'REVALIDATE_SECRET'],
      supplied: {},
    });
    expect(withheld).toEqual([]);
    expect(Object.keys(overlay)).toEqual([]);
  });

  it('discloses one sorted name per variable, whatever the declaration repeats', () => {
    const { withheld } = instanceEnvironment({
      ambient: { NODE_ENV: 'development', STOREFRONT_URL: 'http://elsewhere' },
      declared: ['STOREFRONT_URL', 'NODE_ENV', 'NODE_ENV'],
      supplied: {},
    });
    expect(withheld).toEqual(['NODE_ENV', 'STOREFRONT_URL']);
  });

  /**
   * The link between the pure rule above and the tree it protects.
   *
   * The withheld population is the storefront's own declaration and never a list
   * in the criterion, which is what makes the rule tighten by itself when the
   * storefront declares another variable. The converse is what this asserts: a
   * declaration that stopped naming `NODE_ENV` would stop covering the one
   * variable that has actually broken this criterion, and nothing else in the
   * repository would say so.
   */
  it('covers `NODE_ENV`, because the reference storefront declares reading it', async () => {
    const repoRoot = resolve(__dirname, '..', '..', '..', '..');
    const { declaredVariablesOf } = await import('@endora-commerce/cli');
    const declared = await declaredVariablesOf(join(repoRoot, 'storefront'));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toContain('NODE_ENV');
  });
});
