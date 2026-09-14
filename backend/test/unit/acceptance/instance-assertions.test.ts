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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { authKeys, TOKEN_VARIABLE } from '@endora-commerce/cli';
import { describe, expect, it } from 'vitest';

import {
  ASSERTION_CATALOGUE,
  ASSERTION_IDS,
  compareToExpectation,
  completeResults,
  describeRegistrySupply,
  endoraClosure,
  hostNpmrc,
  evaluateA1,
  evaluateA3,
  evaluateA4,
  evaluateA10,
  evaluateA11,
  evaluateA13,
  evaluateA14,
  evaluateA15,
  ADMIN_LOGIN_PATH,
  evaluateA5,
  evaluateA6,
  evaluateA7,
  evaluateA8,
  evaluateA9,
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

describe('A5 — the built admin bundle holds exactly the installed modules', () => {
  const bundle = (
    overrides: Partial<Parameters<typeof evaluateA5>[0]> = {},
  ): Parameters<typeof evaluateA5>[0] => ({
    built: true,
    named: ['catalog', 'orders'],
    expected: ['catalog', 'orders'],
    installed: ['catalog', 'orders', 'taxes'],
    bytes: 900_000,
    ...overrides,
  });

  it('passes when the bundle names exactly the modules that publish a layer', () => {
    const result = evaluateA5(bundle());
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('exactly the 2 installed module packages');
  });

  it('fails on a screen the client installed and cannot reach', () => {
    const result = evaluateA5(bundle({ named: ['catalog'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('missing: orders');
  });

  it('fails on a module named in the bundle that is not installed', () => {
    const result = evaluateA5(bundle({ named: ['catalog', 'orders', 'blog'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('not installed and named anyway: blog');
  });

  /**
   * The three vacuous states, each distinguished from the failure it resembles.
   * A bundle that was never built, one that is there and empty, and a module
   * set in which nothing publishes a screen all satisfy "exactly" over an empty
   * set — and reporting any of them as a pass is R6.4's own prohibition.
   */
  it('is unmeasured, not failed, when there is nothing to read', () => {
    expect(evaluateA5(bundle({ built: false })).state).toBe('unmeasured');
    expect(evaluateA5(bundle({ bytes: 0 })).state).toBe('unmeasured');
    const noLayers = evaluateA5(bundle({ expected: [], named: [] }));
    expect(noLayers.state).toBe('unmeasured');
    expect(noLayers.detail).toContain('publishes an admin layer');
  });
});

describe('A6 — the documentation site builds and its navigation names the pages', () => {
  const site = (
    overrides: Partial<Parameters<typeof evaluateA6>[0]> = {},
  ): Parameters<typeof evaluateA6>[0] => ({
    present: true,
    omission: null,
    built: true,
    buildOutput: '',
    expected: ['blog', 'catalog'],
    named: ['blog', 'catalog'],
    routed: ['blog', 'catalog'],
    pages: 41,
    ...overrides,
  });

  it('passes when the navigation names a routed page for every documented module', () => {
    const result = evaluateA6(site());
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('exactly the 2 installed module packages');
  });

  it('fails on a page the client installed and cannot find', () => {
    const result = evaluateA6(site({ named: ['blog'], routed: ['blog'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('missing: catalog');
  });

  it('fails on a module the navigation names and the client did not install', () => {
    const result = evaluateA6(
      site({ named: ['blog', 'catalog', 'payu'], routed: ['blog', 'catalog', 'payu'] }),
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('not installed and named anyway: payu');
  });

  /**
   * A sidebar entry and a served page are not the same claim, and D-200 is why:
   * Docusaurus excludes an underscore-prefixed file from routing **by design**,
   * so a navigation naming one is a link to nothing that the build itself does
   * not refuse. An assertion that stopped at the fragment would pass over it.
   */
  it('fails on a named page the built site serves no route for', () => {
    const result = evaluateA6(site({ routed: ['blog'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('named and served by no route: catalog');
  });

  it('fails — never "unmeasured" — when the site did not build', () => {
    const result = evaluateA6(site({ built: false, pages: 0, buildOutput: 'Error: broken link' }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('broken link');
  });

  /**
   * The two vacuous states. A member that is not there is the omission the
   * command printed — verbatim, so the client's own sentence is what a reader
   * gets — and a module set in which nothing ships documentation satisfies
   * "names the installed modules' pages" over an empty set.
   */
  it('is unmeasured, not failed, when there is nothing to read', () => {
    const absent = evaluateA6(site({ present: false, omission: 'omitted docs/ — no range' }));
    expect(absent.state).toBe('unmeasured');
    expect(absent.detail).toContain('no range');
    const undocumented = evaluateA6(site({ expected: [], named: [], routed: [] }));
    expect(undocumented.state).toBe('unmeasured');
    expect(undocumented.detail).toContain('ships a documentation layer');
  });

  it('says so when the member is absent and the command printed no reason', () => {
    const silent = evaluateA6(site({ present: false, omission: null }));
    expect(silent.state).toBe('unmeasured');
    expect(silent.detail).toContain('printed no omission');
  });
});

describe('A13 — the built stylesheet carries each package\'s own classes', () => {
  const witness = (
    kind: 'shell' | 'module',
    unique: number,
    witnesses: readonly string[],
  ): Parameters<typeof evaluateA13>[0]['packages'][number] => ({
    packageName: kind === 'shell' ? '@endora-commerce/admin-shell' : '@endora-commerce/mod-blog',
    kind,
    unique,
    witnesses,
  });

  it('passes when the shell and a module admin layer each witness', () => {
    const result = evaluateA13({
      built: true,
      bytes: 87_000,
      packages: [witness('shell', 12, ['ring-offset-4']), witness('module', 3, ['gap-x-7'])],
    });
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('@endora-commerce/admin-shell: .ring-offset-4');
  });

  /**
   * The defect FR-023 exists for: the enumeration missed a package, Tailwind
   * said nothing, and every class only that package declares is gone.
   */
  it('fails when a package with classes of its own contributed none', () => {
    const result = evaluateA13({
      built: true,
      bytes: 87_000,
      packages: [witness('shell', 12, ['ring-offset-4']), witness('module', 3, [])],
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('@endora-commerce/mod-blog (3 of its own)');
  });

  it('is unmeasured when there is no stylesheet, or nothing only one package uses', () => {
    expect(evaluateA13({ built: false, bytes: 0, packages: [] }).state).toBe('unmeasured');
    expect(evaluateA13({ built: true, bytes: 0, packages: [] }).state).toBe('unmeasured');
    const noSubject = evaluateA13({
      built: true,
      bytes: 87_000,
      packages: [witness('shell', 0, []), witness('module', 0, [])],
    });
    expect(noSubject.state).toBe('unmeasured');
    expect(noSubject.detail).toContain('no other');
  });

  /**
   * SC-011 asks for **one from the shell and one from a module's admin layer**,
   * so a run that could only see one of the two has answered half the
   * assertion. Reporting that as a pass is how the half nobody measured stops
   * being measured at all.
   */
  it('is unmeasured when only one of the two kinds offered a class of its own', () => {
    const result = evaluateA13({
      built: true,
      bytes: 87_000,
      packages: [witness('shell', 12, ['ring-offset-4']), witness('module', 0, [])],
    });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('no module package offered a class of its own');
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

/**
 * A15 (`specs/123-oss-install-experience/` G2, T2-F) — the assertion that closes
 * the gap between *"the packages resolve"* and *"the install works"*.
 *
 * Every case below is about **which of the two halves** a verdict is about,
 * because collapsing them is how a report says "the login failed" about an
 * instance that had nobody to log in as.
 */
describe('A15 — an administrator the instance own CLI made, and the session it earns', () => {
  const created = {
    createCode: 0,
    createOutput: 'created',
    loginStatus: 200,
    sessionCookie: true,
    loginBody: '{"data":{"status":"authenticated"}}',
  };

  it('passes when the CLI made one and the login answered with a session', () => {
    const result = evaluateA15(created);
    expect(result.state).toBe('pass');
    expect(result.detail).toContain(ADMIN_LOGIN_PATH);
  });

  it('is a FAIL, not unmeasured, when there is no `admin:create` at all', () => {
    // The G2 defect itself. An instance with no CLI is not an instance nobody
    // measured — it is an instance nobody can use, and recording that as
    // `unmeasured` is how it stayed invisible for as long as it did.
    const result = evaluateA15({
      ...created,
      createCode: null,
      createOutput: 'the root manifest declares no `admin:create` script',
      loginStatus: null,
      sessionCookie: false,
      loginBody: '',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('no `admin:create`');
  });

  it('fails naming the exit code when the CLI ran and refused', () => {
    const result = evaluateA15({
      ...created,
      createCode: 1,
      createOutput: 'Missing required flag: --email=...',
      loginStatus: null,
      sessionCookie: false,
      loginBody: '',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('Missing required flag');
  });

  it("is unmeasured when the administrator exists and the instance served nothing", () => {
    // A4's finding, not a second report of it.
    const result = evaluateA15({ ...created, loginStatus: null, sessionCookie: false, loginBody: '' });
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('A4');
  });

  it('fails on a non-200, quoting what came back', () => {
    const result = evaluateA15({
      ...created,
      loginStatus: 500,
      sessionCookie: false,
      loginBody: '{"error":{"code":"INTERNAL"}}',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('500');
    expect(result.detail).toContain('INTERNAL');
  });

  it('fails on a 200 that set no session cookie', () => {
    // `mfaRequired` and `mfaSetupRequired` are both 200 and neither is a
    // session, so the status alone would report a login that did not happen.
    const result = evaluateA15({
      ...created,
      sessionCookie: false,
      loginBody: '{"data":{"status":"mfaRequired"}}',
    });
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('no session cookie');
  });

  it('probes the route that is registered, not the one three documents name', () => {
    // `research.md` §4.3/§4.4 and A4's own reason say
    // `/api/v1/admin/auth/login`. Nothing registers it; `admin_users`'
    // `routes.public.ts` declares the one below. A probe of the documented
    // spelling would have measured a 404 for ever while reporting on the login.
    expect(ADMIN_LOGIN_PATH).toBe('/api/v1/auth/admin/login');
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

describe('the `.npmrc` the host directory installs the CLI through', () => {
  // GitLab's shape: a packument on the endpoint whose `dist.tarball` the server
  // is free to place anywhere on the host — which is what makes one auth line
  // insufficient. The value is a fixture; the real one is a protected variable
  // and never appears in this repository or in a log line.
  const REGISTRY = 'https://registry.example.test/api/v4/projects/302/packages/npm/';

  it('authenticates the tarball as well as the packument', () => {
    const text = hostNpmrc(REGISTRY, '@endora-commerce');

    // The measurement is `packages/cli/src/new-storefront/npmrc.ts`': with the
    // endpoint key alone the tarball fetch goes out unauthenticated and the
    // registry answers `ERR_PNPM_FETCH_404 … "No authorization header was set
    // for the request."` — which is what `acceptance:instance` printed on the
    // first pipeline that resolved the registry variables.
    const keys = authKeys(REGISTRY);
    expect(keys.length).toBe(2);
    for (const key of keys) expect(text).toContain(`${key}:_authToken=`);
  });

  it('holds no secret, whatever the token is', () => {
    const text = hostNpmrc(REGISTRY, '@endora-commerce');

    // An environment reference pnpm expands at read time, so no file on disk
    // and no CI artefact ever carries the value.
    expect(text).toContain(`:_authToken=\${${TOKEN_VARIABLE}}`);
    expect(text).not.toMatch(/_authToken=[^$]/);
  });

  it('points the scope at the endpoint, with the trailing slash GitLab requires', () => {
    expect(hostNpmrc('https://registry.example.test/api/v4/projects/302/packages/npm', '@x')).toContain(
      '@x:registry=https://registry.example.test/api/v4/projects/302/packages/npm/',
    );
  });

  it('configures no registry at all in the tarball mode', () => {
    // The discrimination: the same file serves both modes, and a registry line
    // written when no registry was named would send every `file:` install's
    // transitive fetches somewhere nobody asked for.
    const text = hostNpmrc(null, '@endora-commerce');
    expect(text).not.toContain('registry=');
    expect(text).not.toContain('_authToken');
  });

  it('keeps the two settings the host needs in both modes', () => {
    for (const text of [hostNpmrc(REGISTRY, '@endora-commerce'), hostNpmrc(null, '@endora-commerce')]) {
      expect(text).toContain('ignore-workspace=true');
      expect(text).toContain('strict-peer-dependencies=false');
    }
  });

  it('refuses a registry it cannot key an auth line on', () => {
    // Exit 2's input, not a red: a run that could not configure the endpoint
    // has measured nothing about the criterion. The refusal is the runner's;
    // what this owes is a throw rather than a silently unauthenticated file.
    expect(() => hostNpmrc('not-a-url', '@endora-commerce')).toThrow();
  });

  it('is where the runner gets it, rather than a second copy of the derivation', () => {
    // The two-way link, and the whole reason this is a function rather than
    // four lines in `provisionHost`. The runner had its own auth line — one
    // key, the shape `packages/cli` had already measured failing and repaired
    // five days earlier — and nothing in the tree could see that there were two
    // answers to one question.
    const source = readFileSync(
      fileURLToPath(new URL('../../../scripts/acceptance/instance.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('hostNpmrc(');
    expect(source).not.toContain('_authToken');
  });
});

describe('A7 — a module the instance did not install is named nowhere', () => {
  const surfaces = (
    overrides: Partial<Parameters<typeof evaluateA7>[0]> = {},
  ): Parameters<typeof evaluateA7>[0] => ({
    absent: ['blog', 'search'],
    installed: ['catalog', 'orders'],
    bundleNames: ['catalog', 'orders'],
    servedRoutes: ['GET /api/v1/admin/catalog/products', 'GET /api/v1/storefront/orders/{id}'],
    absentRoutes: new Map([
      ['GET /api/v1/admin/blog/posts', 'blog'],
      ['POST /api/v1/storefront/search', 'search'],
    ]),
    enumerated: ['catalog', 'orders', '_lifecycle'],
    enumerationExemptions: ['_lifecycle'],
    ...overrides,
  });

  it('passes when none of the three surfaces names an absent module', () => {
    const result = evaluateA7(surfaces());
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('none of the 2 module packages this instance did not install');
  });

  it('fails on an absent module whose screens are in the operator interface', () => {
    const result = evaluateA7(surfaces({ bundleNames: ['catalog', 'orders', 'blog'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('named in the built admin bundle: blog');
  });

  /**
   * The half that needs two authors: the expectation is what an absent
   * package's own `./backend` registers, and the evidence is what the running
   * instance serves. A parameterised endpoint is one identity in both
   * spellings — `{id}` out of the OpenAPI document, `:id` off the registration
   * — and comparing them literally would report every one of them as clean.
   */
  it('fails on an endpoint served that an absent module owns, in either spelling', () => {
    const result = evaluateA7(
      surfaces({
        servedRoutes: ['GET /api/v1/admin/blog/posts/{id}'],
        absentRoutes: new Map([['GET /api/v1/admin/blog/posts/:id', 'blog']]),
      }),
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('blog');
  });

  it('fails on an absent module the storefront is told is present', () => {
    const result = evaluateA7(surfaces({ enumerated: ['catalog', 'orders', 'search'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('enumerated: search');
  });

  /**
   * The completeness half, and it is a different question: an id that is in no
   * packed catalogue at all would pass every check above and is still a module
   * the client did not install.
   */
  it('fails on an enumerated id that is neither installed, exempt, nor in the catalogue', () => {
    const result = evaluateA7(surfaces({ enumerated: ['catalog', 'orders', 'mystery'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('mystery');
  });

  it('is unmeasured, not passed, when a surface could not be read', () => {
    expect(evaluateA7(surfaces({ bundleNames: null })).state).toBe('unmeasured');
    expect(evaluateA7(surfaces({ servedRoutes: null })).state).toBe('unmeasured');
    const noEnumeration = evaluateA7(surfaces({ enumerated: null }));
    expect(noEnumeration.state).toBe('unmeasured');
    expect(noEnumeration.detail).toContain('fraction of the assertion');
  });

  it('is unmeasured when nothing is absent, or no absent package was read for routes', () => {
    expect(evaluateA7(surfaces({ absent: [] })).state).toBe('unmeasured');
    const noRoutes = evaluateA7(surfaces({ absentRoutes: new Map() }));
    expect(noRoutes.state).toBe('unmeasured');
    expect(noRoutes.detail).toContain('empty expectation');
  });
});

describe('A8 — an overlay module is composed and its decoration is in the report', () => {
  const overlay = (
    overrides: Partial<Parameters<typeof evaluateA8>[0]> = {},
  ): Parameters<typeof evaluateA8>[0] => ({
    moduleId: 'acceptance_overlay',
    decorated: 'someService',
    composed: 'answered',
    decorationApplied: true,
    bootOutput: '',
    entries: [
      {
        key: 'decoration:acceptance_overlay:someService',
        kind: 'decoration',
        module: 'acceptance_overlay',
        subject: 'someService',
        owner: null,
        rung: 4,
        reason: 'the deployment wrote this sentence',
      },
    ],
    findings: [],
    renderFailure: null,
    ...overrides,
  });

  it('passes when the module answers, the wrap is live and the report records it', () => {
    const result = evaluateA8(overlay());
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('decoration:acceptance_overlay:someService');
  });

  it('fails when the overlay module in the tree is composed by nothing', () => {
    const result = evaluateA8(overlay({ composed: 'refused' }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('composed by nothing');
  });

  /**
   * The verdict no error message produces, and the reason the two halves are
   * kept apart: composition succeeded, the module answers, and the wrap simply
   * did not apply — a deployment that wrote a decoration has no way to learn it
   * was dropped.
   */
  it('fails on a wrap that did not apply and said nothing', () => {
    const result = evaluateA8(overlay({ decorationApplied: false }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('did not apply');
  });

  it('fails on a live decoration the report does not record, naming the findings', () => {
    const result = evaluateA8(
      overlay({
        entries: [],
        findings: ["[unowned-subject] 'someService' is registered by no module in the composition"],
      }),
    );
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('unowned-subject');
  });

  it('fails on a recorded divergence the deployment wrote no sentence for', () => {
    const [entry] = overlay().entries ?? [];
    const result = evaluateA8(overlay({ entries: [{ ...entry!, reason: '  ' }] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('carries no sentence');
  });

  it('is unmeasured, not failed, when the instance never answered', () => {
    expect(evaluateA8(overlay({ composed: 'unreachable' })).state).toBe('unmeasured');
    const neither = evaluateA8(
      overlay({ composed: 'unreachable', entries: null, renderFailure: 'the render threw' }),
    );
    expect(neither.state).toBe('unmeasured');
    expect(neither.detail).toContain('neither half has a subject');
  });

  /**
   * A composed module whose decoration is live and whose report is missing is a
   * **failure**, never an absence: the artefact is the client's only record of
   * what their deployment changed, and a run that shrugged at its absence would
   * be the silence D-30 exists to refuse.
   */
  it('fails, rather than skipping, when no report was rendered at all', () => {
    const result = evaluateA8(overlay({ entries: null, renderFailure: 'endora generate exited 1' }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('endora generate exited 1');
  });
});

describe('A9 — the tenancy guard is active in the created instance', () => {
  const tenancy = (
    overrides: Partial<Parameters<typeof evaluateA9>[0]> = {},
  ): Parameters<typeof evaluateA9>[0] => ({
    inconclusive: null,
    entity: 'OrganizationInvitation (organization_invitations)',
    organizations: ['org-a', 'org-b'],
    unscopedRead: 'refused',
    refusalName: 'MissingTenantContextError',
    systemScopeOrganizations: ['org-a', 'org-b'],
    narrowedOrganizations: ['org-a'],
    ...overrides,
  });

  it('passes when the unscoped read is refused and the narrowed one is one tenant', () => {
    const result = evaluateA9(tenancy());
    expect(result.state).toBe('pass');
    expect(result.detail).toContain('MissingTenantContextError');
  });

  it('fails when a read with no tenant context answers', () => {
    const result = evaluateA9(tenancy({ unscopedRead: 'returned', refusalName: null }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('the guard is not attached');
  });

  it('fails when something other than the tenant guard refused the read', () => {
    const result = evaluateA9(tenancy({ refusalName: 'TypeError' }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('TypeError');
  });

  it('fails when the pinned read still returns another tenant rows', () => {
    const result = evaluateA9(tenancy({ narrowedOrganizations: ['org-a', 'org-b'] }));
    expect(result.state).toBe('fail');
    expect(result.detail).toContain('org-b');
  });

  /**
   * The vacuous state this assertion is most likely to reach, and the reason
   * the second leg exists: a guard that refuses a read of a table holding one
   * tenant's rows has refused nothing that crosses a tenant boundary.
   */
  it('is unmeasured when the refused read would have spanned one tenant', () => {
    const result = evaluateA9(tenancy({ systemScopeOrganizations: ['org-a'] }));
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toContain('says nothing about crossing a tenant boundary');
  });

  it('is unmeasured when the probe could not run, and reports its own words', () => {
    const result = evaluateA9(tenancy({ inconclusive: 'the ORM configuration did not load' }));
    expect(result.state).toBe('unmeasured');
    expect(result.detail).toBe('the ORM configuration did not load');
  });

  it('is unmeasured when the narrowing half was not measured', () => {
    expect(evaluateA9(tenancy({ narrowedOrganizations: null })).state).toBe('unmeasured');
  });
});

/**
 * **The `registry` mode measures the last publish, and the report has to say
 * so.** Pipeline 13800 read `ERR_PNPM_NO_MATCHING_VERSION  No matching version
 * found for @endora-commerce/mod-addresses@^0.8.0`, an omitted `admin/` member
 * and an absent `docs/` one, and every one of the three was a property of
 * `@endora-commerce/cli@0.8.0` **as published on 2026-09-11** — seventeen source
 * commits behind `master`, at the same version string. A criterion whose report
 * cannot separate *"the product is broken"* from *"the product on the registry
 * is older than the product in this tree"* produces a record that is misread
 * every time, and the equal-version case is the one nothing else can see.
 */
describe('describeRegistrySupply — what the registry served, against this checkout', () => {
  it('names a package the checkout has moved past', () => {
    const note = describeRegistrySupply([
      { name: '@endora-commerce/platform', served: '0.8.0', declared: '0.8.0', pending: false },
      { name: '@endora-commerce/mod-blog', served: '0.7.1', declared: '0.8.0', pending: false },
    ]);
    expect(note).toContain('@endora-commerce/mod-blog');
    expect(note).toContain('0.7.1');
    expect(note).toContain('moved past');
  });

  // The case that actually happened, and the only one no version comparison
  // can reach: the registry serves `0.8.0`, the checkout declares `0.8.0`, and
  // the two are different programs.
  it('names a package served at this checkout\'s own version with a changeset against it', () => {
    const note = describeRegistrySupply([
      { name: '@endora-commerce/cli', served: '0.8.0', declared: '0.8.0', pending: true },
    ]);
    expect(note).toContain('@endora-commerce/cli');
    expect(note).toContain('unconsumed changeset');
    expect(note).toContain('published');
  });

  it('says so when the registry holds a version this checkout does not', () => {
    const note = describeRegistrySupply([
      { name: '@endora-commerce/platform', served: '0.9.0', declared: '0.8.0', pending: false },
    ]);
    expect(note).toContain('@endora-commerce/platform');
    expect(note).toContain('ahead of');
  });

  // 0.10.0 > 0.9.0, and a string comparison says the opposite. D-234 puts the
  // first public version at `0.100.0`, so this is the series the estate is
  // about to enter rather than a hypothetical.
  it('compares versions numerically, not as strings', () => {
    const note = describeRegistrySupply([
      { name: '@endora-commerce/platform', served: '0.9.0', declared: '0.100.0', pending: false },
    ]);
    expect(note).toContain('moved past');
    expect(note).not.toContain('ahead of');
  });

  it('reports agreement as the finding it is', () => {
    const note = describeRegistrySupply([
      { name: '@endora-commerce/platform', served: '0.8.0', declared: '0.8.0', pending: false },
      { name: '@endora-commerce/cli', served: '0.8.0', declared: '0.8.0', pending: false },
    ]);
    expect(note).toContain('2');
    expect(note).toContain('this tree');
    expect(note).not.toContain('moved past');
  });
});
