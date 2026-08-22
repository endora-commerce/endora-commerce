/**
 * The package-schema acceptance criterion, held to its own rules (D-110, T021).
 *
 * The criterion itself needs PostgreSQL, a `pnpm pack` and an install into a
 * throwaway directory, so it runs as a CI job rather than in this suite. What
 * runs here is everything that decides *what the criterion means*: the two
 * assertions that carry the contract (A8 and A9), the exit-code rule that
 * forbids a vacuous green, the disposable-database guard, and the fixture
 * package's own shape.
 *
 * **Every fixture below enters at the top of the analysis** (issue #130). The
 * A8/A9 proofs build real directories and real symlinks in a temporary
 * directory and hand `classifyResolutionPath` a path — the same call the runner
 * makes over a real `pnpm add`. Handing `evaluateA8` a pre-built finding would
 * leave the part that walks the path unproven, which is the part that decides
 * whether a workspace link is distinguishable from an install.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineModuleManifest } from '@b2b/contracts';
import {
  ASSERTION_IDS,
  classifyResolutionPath,
  evaluateA8,
  evaluateA9,
  compareToExpectation,
  exitCodeFor,
  exitCodeForExpectation,
  formatReport,
  mergeResults,
  resolveDatabaseTarget,
  type AssertionResult,
} from '../../../scripts/acceptance/assertions.js';

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REPO_ROOT = resolve(BACKEND_ROOT, '..');
const FIXTURE_DIR = join(BACKEND_ROOT, 'acceptance', 'fixture-package');
const PACKAGE_DIR_SEGMENTS = ['@endora-commerce', 'mod-acceptance-probe'];

function result(id: (typeof ASSERTION_IDS)[number], status: AssertionResult['status']): AssertionResult {
  return { id, title: id, refuses: id, status, detail: id };
}

// ---------------------------------------------------------------------------
// A8 / A9 — over real trees
// ---------------------------------------------------------------------------

describe('A8 distinguishes an installed package from a linked one', () => {
  let root: string;
  /** `<root>/instance` — what a `pnpm add <tgz>` layout looks like. */
  let installedManifest: string;
  /** `<root>/linked-instance` — what a workspace / `link:` layout looks like. */
  let linkedManifest: string;
  /** `<root>/outside-instance` — a package resolved to a third directory. */
  let outsideManifest: string;
  let repository: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'acceptance-a8-'));
    repository = join(root, 'repository');

    // The repository the package must not lead back into, with the package's
    // sources in it — the "moved into packages/modules/" shape.
    const moved = join(repository, 'packages', 'modules', 'mod-acceptance-probe');
    mkdirSync(moved, { recursive: true });
    writeFileSync(join(moved, 'package.json'), '{"name":"@endora-commerce/mod-acceptance-probe"}');

    // 1. An install: pnpm's isolated node-linker puts the real files in
    //    `node_modules/.pnpm/...` and symlinks the visible name at it. There IS
    //    a symlink on the path — a literal "no symlink" assertion would refuse
    //    this, which is why A8 is about where the links land.
    const instance = join(root, 'instance');
    const store = join(instance, 'node_modules', '.pnpm', 'pkg@1.0.0', 'node_modules', ...PACKAGE_DIR_SEGMENTS);
    mkdirSync(store, { recursive: true });
    writeFileSync(join(store, 'package.json'), '{"name":"@endora-commerce/mod-acceptance-probe"}');
    mkdirSync(join(instance, 'node_modules', PACKAGE_DIR_SEGMENTS[0]!), { recursive: true });
    symlinkSync(store, join(instance, 'node_modules', ...PACKAGE_DIR_SEGMENTS), 'dir');
    installedManifest = join(instance, 'node_modules', ...PACKAGE_DIR_SEGMENTS, 'package.json');

    // 2. A link into the repository — a workspace member, a `file:` dependency,
    //    or F4's own "move the directory into packages/modules/".
    const linked = join(root, 'linked-instance');
    mkdirSync(join(linked, 'node_modules', PACKAGE_DIR_SEGMENTS[0]!), { recursive: true });
    symlinkSync(moved, join(linked, 'node_modules', ...PACKAGE_DIR_SEGMENTS), 'dir');
    linkedManifest = join(linked, 'node_modules', ...PACKAGE_DIR_SEGMENTS, 'package.json');

    // 3. A link to somewhere else entirely: not the repository, and still not
    //    the instance. A8 must refuse this too, or "contained by the instance"
    //    would only ever have been "not in the repository".
    const elsewhere = join(root, 'elsewhere', ...PACKAGE_DIR_SEGMENTS);
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, 'package.json'), '{"name":"@endora-commerce/mod-acceptance-probe"}');
    const outside = join(root, 'outside-instance');
    mkdirSync(join(outside, 'node_modules', PACKAGE_DIR_SEGMENTS[0]!), { recursive: true });
    symlinkSync(elsewhere, join(outside, 'node_modules', ...PACKAGE_DIR_SEGMENTS), 'dir');
    outsideManifest = join(outside, 'node_modules', ...PACKAGE_DIR_SEGMENTS, 'package.json');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes a tarball install, whose internal symlink stays inside the instance', () => {
    const finding = classifyResolutionPath({
      resolved: installedManifest,
      instanceRoot: join(root, 'instance'),
      repositoryRoot: repository,
    });
    expect(finding.hops.length).toBeGreaterThan(0);
    expect(finding.hops.every((hop) => !hop.leavesInstance)).toBe(true);
    expect(finding.containedByInstance).toBe(true);
    expect(finding.reachesRepository).toBe(false);
    expect(evaluateA8(finding).status).toBe('pass');
  });

  it('fails a package linked from the repository, and says which hop left', () => {
    const finding = classifyResolutionPath({
      resolved: linkedManifest,
      instanceRoot: join(root, 'linked-instance'),
      repositoryRoot: repository,
    });
    expect(finding.reachesRepository).toBe(true);
    const verdict = evaluateA8(finding);
    expect(verdict.status).toBe('fail');
    expect(verdict.detail).toContain('symlink(s) leave the instance');
    expect(verdict.detail).toContain('lands inside the repository working tree');
  });

  it('fails a package linked from a third directory that is neither', () => {
    const finding = classifyResolutionPath({
      resolved: outsideManifest,
      instanceRoot: join(root, 'outside-instance'),
      repositoryRoot: repository,
    });
    expect(finding.reachesRepository).toBe(false);
    expect(evaluateA8(finding).status).toBe('fail');
  });

  it('A9 passes only when the moved case is the one A8 refuses', () => {
    const moved = classifyResolutionPath({
      resolved: linkedManifest,
      instanceRoot: join(root, 'linked-instance'),
      repositoryRoot: repository,
    });
    expect(evaluateA9(moved, true).status).toBe('pass');

    // The defect A9 exists to catch: an A8 that accepts the moved directory.
    // Fed the *installed* finding as if it were the moved one, A9 must go red —
    // otherwise it is a green that would survive A8 being switched off.
    const installed = classifyResolutionPath({
      resolved: installedManifest,
      instanceRoot: join(root, 'instance'),
      repositoryRoot: repository,
    });
    const blind = evaluateA9(installed, true);
    expect(blind.status).toBe('fail');
    expect(blind.detail).toContain('cannot distinguish');
  });

  it('A9 is inconclusive, never green, when the moved case did not resolve at all', () => {
    const missing = classifyResolutionPath({
      resolved: join(root, 'linked-instance', 'node_modules', 'nothing', 'package.json'),
      instanceRoot: join(root, 'linked-instance'),
      repositoryRoot: repository,
    });
    expect(evaluateA9(missing, false).status).toBe('inconclusive');
  });
});

// ---------------------------------------------------------------------------
// The exit-code rule and the report
// ---------------------------------------------------------------------------

describe('the criterion cannot report a vacuous green', () => {
  const allPass = ASSERTION_IDS.map((id) => result(id, 'pass'));

  it('exits 0 only when every assertion was evaluated and passed', () => {
    expect(exitCodeFor(allPass)).toBe(0);
  });

  it('exits 2 when an assertion is missing, however green the rest are', () => {
    expect(exitCodeFor(allPass.filter((r) => r.id !== 'A4'))).toBe(2);
  });

  it('exits 2 when anything was inconclusive, even beside a failure', () => {
    expect(
      exitCodeFor(allPass.map((r) => (r.id === 'A2' ? result('A2', 'inconclusive') : r))),
    ).toBe(2);
  });

  it('exits 1 when something was measured and failed', () => {
    expect(exitCodeFor(allPass.map((r) => (r.id === 'A1' ? result('A1', 'fail') : r)))).toBe(1);
  });

  it('names an assertion no phase answered rather than dropping it', () => {
    const merged = mergeResults([result('A1', 'pass')], ['schema: postgres refused']);
    expect(merged).toHaveLength(ASSERTION_IDS.length);
    const a5 = merged.find((r) => r.id === 'A5');
    expect(a5?.status).toBe('inconclusive');
    expect(a5?.detail).toContain('postgres refused');
    expect(formatReport(merged, [])).toContain('A5 INCONCLUSIVE');
  });

  it('merges two answers about one assertion to the worse of them', () => {
    const merged = mergeResults([result('A6', 'pass'), result('A6', 'fail')]);
    expect(merged.find((r) => r.id === 'A6')?.status).toBe('fail');
    const unmeasured = mergeResults([result('A6', 'fail'), result('A6', 'inconclusive')]);
    expect(unmeasured.find((r) => r.id === 'A6')?.status).toBe('inconclusive');
  });
});

describe('the runner refuses to drop a database that is not disposable', () => {
  it('accepts a name following the test convention', () => {
    const target = resolveDatabaseTarget('postgresql://b2b:b2b@localhost:5432/b2b_acceptance_test');
    expect('error' in target).toBe(false);
    if (!('error' in target)) {
      expect(target.databaseName).toBe('b2b_acceptance_test');
      expect(target.adminUrl).toContain('/postgres');
    }
  });

  it('refuses a developer database reachable over loopback', () => {
    const target = resolveDatabaseTarget('postgresql://b2b:b2b@localhost:5432/b2b');
    expect('error' in target && target.error).toContain('not a disposable one');
  });

  it('refuses a DSN it cannot parse and one that names no database', () => {
    expect('error' in resolveDatabaseTarget('not a dsn')).toBe(true);
    expect('error' in resolveDatabaseTarget('postgresql://b2b:b2b@localhost:5432/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The fixture package
// ---------------------------------------------------------------------------

describe('the fixture package is the thing the contract describes', () => {
  const packageJson = JSON.parse(readFileSync(join(FIXTURE_DIR, 'package.json'), 'utf8')) as {
    name: string;
    files: string[];
    endora: { type: string; id: string; platform: string };
    exports: Record<string, string>;
    peerDependencies: Record<string, string>;
  };

  it('is not a pnpm workspace member, so pnpm cannot link it', () => {
    const workspace = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8');
    const globs = [...workspace.matchAll(/^\s*-\s*(.+)$/gm)].map((m) => m[1]!.trim());
    // The fixture lives under `backend/`, which IS a workspace package — but a
    // nested directory with its own package.json is not matched by any glob, so
    // pnpm never treats it as a member. The assertion is that no glob names it.
    expect(globs).not.toContain('backend/acceptance/*');
    expect(globs).not.toContain('backend/acceptance/fixture-package');
    expect(globs.some((glob) => glob.startsWith('backend/'))).toBe(false);
  });

  it('declares itself a module through the `endora` field, not through its name', () => {
    expect(packageJson.endora.type).toBe('module');
    expect(packageJson.endora.id).toBe('acceptance_probe');
    expect(packageJson.exports['.']).toBe('./dist/manifest.js');
    expect(packageJson.exports['./backend']).toBe('./dist/backend/index.js');
    expect(packageJson.exports['./migrations']).toBe('./dist/migrations/index.js');
  });

  it('publishes compiled output and assets only — no `.ts` for a source probe to find', () => {
    expect(packageJson.files).toEqual(['dist', 'i18n']);
  });

  it('takes the ORM from the host as a peer, so one MetadataStorage serves both', () => {
    expect(Object.keys(packageJson.peerDependencies)).toContain('@mikro-orm/core');
  });

  it('ships a manifest the platform schema accepts, with an activation control', async () => {
    const module = (await import(join(FIXTURE_DIR, 'src', 'manifest.ts'))) as {
      manifest: Record<string, unknown>;
    };
    const parsed = defineModuleManifest(module.manifest as never);
    expect(parsed.id).toBe(packageJson.endora.id);
    expect(parsed.activation).toEqual({ settingCode: 'acceptance_probe.activation', default: true });
    expect(parsed.permissions?.[0]?.code).toBe('acceptance_probe:manage');
    expect(parsed.actions?.[0]?.labelKey).toBe('actions.openAcceptanceProbe.label');
  });

  it('names its migration class the way `mikro_orm_migrations` will persist it', () => {
    const migrationsDir = join(FIXTURE_DIR, 'src', 'migrations');
    const files = readdirSync(migrationsDir).filter((f) => f !== 'index.ts');
    expect(files).toHaveLength(1);
    const file = files[0]!;
    const match = /^(\d{8}T\d{6})_(acceptance_probe_[a-z0-9_]+)\.ts$/.exec(file);
    expect(match, `${file} does not follow <stamp>_<module-segment>_<slug>.ts`).not.toBeNull();
    const tail = match![2]!
      .split('_')
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join('');
    const className = `Migration${match![1]!}${tail}`;
    expect(readFileSync(join(migrationsDir, file), 'utf8')).toContain(`export class ${className}`);
    // Past the frozen historical prefix — a property of *this fixture*, not a
    // rule the platform imposes on a package. Baseline membership is
    // `origin === 'core' && stamp <= BASELINE_THROUGH` (D-114), and
    // `package-runtime.ts` tags every package entry `origin: 'external'`
    // unconditionally, so a package's stamp is never compared against the
    // watermark at all; a back-dated one is still ordered by the module graph.
    // The assertion stands because the fixture is what a package author is
    // pointed at as the worked example (docs/docs/architecture/migrations.md
    // § How to create a migration in an extension package), and an exemplar
    // that back-dates its stamp would teach a rule that reads as forbidden
    // when it is merely pointless.
    expect(match![1]! > '20260801T000000').toBe(true);
  });

  it('ships flat i18n bundles covering the action keys in both languages', () => {
    for (const language of ['en', 'pl']) {
      const bundle = JSON.parse(
        readFileSync(join(FIXTURE_DIR, 'i18n', `${language}.json`), 'utf8'),
      ) as Record<string, unknown>;
      for (const [key, value] of Object.entries(bundle)) {
        expect(typeof value, `${language}.json ${key} must be flat`).toBe('string');
      }
      expect(bundle['actions.openAcceptanceProbe.label']).toBeTypeOf('string');
      expect(bundle['actions.openAcceptanceProbe.description']).toBeTypeOf('string');
    }
  });
});

// ---------------------------------------------------------------------------
// T022 — the criterion has to actually run
// ---------------------------------------------------------------------------

describe('the criterion runs in CI', () => {
  const ci = readFileSync(join(REPO_ROOT, '.gitlab-ci.yml'), 'utf8');
  const packageScripts = JSON.parse(readFileSync(join(BACKEND_ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('is a declared script, in both the local and the ratchet spelling', () => {
    expect(packageScripts.scripts['acceptance:package-schema']).toBe(
      'tsx scripts/acceptance/package-schema.ts',
    );
    expect(packageScripts.scripts['acceptance:package-schema:ci']).toBe(
      'tsx scripts/acceptance/package-schema.ts --against-expectation',
    );
  });

  it('is invoked by a job with a PostgreSQL service', () => {
    const job = ci.slice(ci.indexOf('\nacceptance:package-schema:'));
    expect(job).toContain('postgres:16-alpine');
    expect(job).toContain('pnpm --filter backend run acceptance:package-schema:ci');
  });

  it('migrates a database whose name marks it disposable', () => {
    const job = ci.slice(ci.indexOf('\nacceptance:package-schema:'));
    const dsn = /ACCEPTANCE_DATABASE_URL:\s*(\S+)/.exec(job)?.[1];
    expect(dsn, 'the job must name the database it builds').toBeTypeOf('string');
    expect('error' in resolveDatabaseTarget(dsn!)).toBe(false);
  });

  it('is triggered by every input that can change the answer', () => {
    // A criterion that exists and never runs is `.gitlab-ci.yml`'s own
    // `DEPLOYMENT` matrix failure repeated one layer out (contract §Where it
    // runs). These four paths are the ones that decide whether a package's
    // schema reaches a database.
    const job = ci.slice(ci.indexOf('\nacceptance:package-schema:'));
    for (const path of [
      'backend/scripts/generate-composer.ts',
      'backend/src/db/migrations-registry.generated.ts',
      'backend/src/db/entities-registry.generated.ts',
      'backend/src/db/migration-order.ts',
      'backend/acceptance/**/*',
      'backend/scripts/acceptance/**/*',
    ]) {
      expect(job, `the job must be triggered by ${path}`).toContain(path);
    }
  });
});

// ---------------------------------------------------------------------------
// The expectation ledger — "red first", machine-checked
// ---------------------------------------------------------------------------

describe('the expectation ledger records a criterion that is red today', () => {
  const ledger = JSON.parse(
    readFileSync(join(BACKEND_ROOT, 'acceptance', 'expected-state.json'), 'utf8'),
  ) as { assertions: Record<string, { status: 'pass' | 'fail'; reason: string }> };

  it('covers every assertion and nothing else', () => {
    expect(Object.keys(ledger.assertions).sort()).toEqual([...ASSERTION_IDS].sort());
  });

  it('expects the schema half — A1 … A4 — to pass, each with a reason naming what earned it', () => {
    // The four that are about a package's **schema** reaching PostgreSQL, which
    // is what "a package can ship schema" means. They were the red this whole
    // criterion existed to hold, and T033 earned them: the ORM configuration
    // became an async factory that merges every installed package's
    // `./migrations` and `./backend` exports into the order and the entity set.
    // A5 left the red list when T031 landed, for the same kind of reason.
    //
    // The assertion is inverted rather than deleted, because the ledger's job
    // is unchanged: a `pass` recorded here that the run cannot reproduce is
    // drift in the other direction, and that has to fail just as loudly.
    for (const id of ['A1', 'A2', 'A3', 'A4'] as const) {
      expect(ledger.assertions[id]?.status, `${id} must be recorded as passing today`).toBe('pass');
      expect(ledger.assertions[id]?.reason.length).toBeGreaterThan(40);
    }
  });

  it('expects A5 to pass, and A6 and A7 to fail on reasons of their own', () => {
    // Both used to read "Follows A5", which stopped being true the moment A5
    // did. A recorded reason that is stale is worse than none: it sends the
    // next author to fix something that is already fixed. A7's reason moved
    // again with T033 — its migration count is settled and what stops it now is
    // A6's missing activation row, so nothing composes and no registration row
    // is written for the package to be uninstalled from.
    expect(ledger.assertions['A5']?.status).toBe('pass');
    for (const id of ['A6', 'A7'] as const) {
      expect(ledger.assertions[id]?.status).toBe('fail');
      expect(ledger.assertions[id]?.reason).not.toMatch(/^Follows A5/);
    }
  });

  it('gives every entry a reason, whichever way it answers', () => {
    // The ratchet only *requires* one for a `fail`. A `pass` needs one too, and
    // for the same purpose: the entry has to say what earned the green, or the
    // next reader cannot tell an earned pass from one nobody looked at.
    for (const id of ASSERTION_IDS) {
      expect(ledger.assertions[id]?.reason.length, `${id} must carry a reason`).toBeGreaterThan(40);
    }
  });

  it('expects A8 and A9 to pass, because they measure the harness', () => {
    expect(ledger.assertions['A8']?.status).toBe('pass');
    expect(ledger.assertions['A9']?.status).toBe('pass');
  });

  it('fails a run that drifts in either direction', () => {
    const measured = ASSERTION_IDS.map((id) =>
      result(id, ledger.assertions[id]!.status === 'pass' ? 'pass' : 'fail'),
    );
    expect(exitCodeForExpectation(compareToExpectation(measured, ledger.assertions))).toBe(0);

    // Forward drift: an assertion the ledger records as `fail` coming back
    // green. A6 is the example now that T033 turned A1 green — and the
    // remedy is unchanged, which is the point: record the green in the merge
    // request that earned it, never edit the ledger to make a pipeline pass.
    const forward = measured.map((r) => (r.id === 'A6' ? result('A6', 'pass') : r));
    const forwardDrift = compareToExpectation(forward, ledger.assertions);
    expect(forwardDrift.drift.map((d) => d.id)).toEqual(['A6']);
    expect(exitCodeForExpectation(forwardDrift)).toBe(1);

    // Backward drift on an assertion T033 earned: a green that stops being
    // green must fail exactly as loudly as one that arrives unannounced.
    const regressed = measured.map((r) => (r.id === 'A1' ? result('A1', 'fail') : r));
    const regressedDrift = compareToExpectation(regressed, ledger.assertions);
    expect(regressedDrift.drift.map((d) => d.id)).toEqual(['A1']);
    expect(exitCodeForExpectation(regressedDrift)).toBe(1);

    const backward = measured.map((r) => (r.id === 'A8' ? result('A8', 'fail') : r));
    expect(exitCodeForExpectation(compareToExpectation(backward, ledger.assertions))).toBe(1);
  });

  it('refuses a run that measured less than the ledger covers', () => {
    const partial = ASSERTION_IDS.map((id) =>
      id === 'A4' ? result('A4', 'inconclusive') : result(id, ledger.assertions[id]!.status),
    );
    const comparison = compareToExpectation(partial, ledger.assertions);
    expect(comparison.unmeasured.map((r) => r.id)).toEqual(['A4']);
    expect(exitCodeForExpectation(comparison)).toBe(2);
  });

  it('refuses a ledger entry that records a failure without saying why', () => {
    const comparison = compareToExpectation(
      [result('A1', 'fail')],
      { A1: { status: 'fail', reason: '  ' } },
    );
    expect(comparison.ledgerErrors.join(' ')).toContain('gives no reason');
    expect(exitCodeForExpectation(comparison)).toBe(2);
  });

  it('refuses a measured assertion the ledger does not account for', () => {
    const comparison = compareToExpectation([result('A2', 'fail')], {
      A1: { status: 'fail', reason: 'x'.repeat(50) },
    });
    expect(comparison.ledgerErrors.join(' ')).toContain('unaccounted for');
    expect(exitCodeForExpectation(comparison)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// The runner and the probe are typechecked because this file imports them
// ---------------------------------------------------------------------------

describe('the runner and the probe are importable without running', () => {
  // `backend/scripts/**` is outside `tsconfig.json`'s `include`, so the only
  // thing that puts these two files into a `tsc` program is a test importing
  // them. Both guard their `main()` behind the CLI check, so the import is
  // inert: without that guard this test would build a fixture, install a
  // package and drop a database.
  it('imports the runner without building, installing or migrating anything', async () => {
    const before = Date.now();
    await import('../../../scripts/acceptance/package-schema.js');
    await import('../../../scripts/acceptance/instance-probe.js');
    expect(Date.now() - before).toBeLessThan(5_000);
  });
});
