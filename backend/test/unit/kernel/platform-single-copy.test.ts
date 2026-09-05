/**
 * The platform is **one copy**, and the two specifier shapes reach it (feature
 * 080, the platform relocation).
 *
 * ## What this file used to say
 *
 * It was `host-package-copy.test.ts`, and it asserted the opposite over the same
 * population: `@endora-commerce/platform` emitted its `dist` from
 * `rootDir: ../../backend/src`, so the package was
 * `backend/src/{kernel,http,tenancy,commands,events}` compiled a second time.
 * The application ran the originals; anything resolving the bare specifier ran
 * the copy. **57 identity-bearing exports across the five subpaths, none of them
 * shared.** Its stated retiring condition was a symbol becoming shared, and this
 * merge request is that: the five directories moved into the package, the
 * application reaches them through re-export shims forwarding to the same build
 * output the `exports` map serves, and the same 57 values are now the same 57
 * objects.
 *
 * It is inverted rather than deleted because the property is not self-evident
 * and nothing else in the tree holds it. Two specifier shapes for one set of
 * files is a standing hazard — a `paths` alias, a second `dist`, a shim
 * re-pointed at `packages/platform/src` — and every one of those is invisible to
 * `tsc`, which compares types and never module identity.
 *
 * ## What it asserts, and what makes it two-way
 *
 * Per shimmed subpath: every identity-bearing export the bare specifier and
 * the application's own shims both carry is the **same object**, and none is
 * two. Both directions fail. A name that goes back to being two objects fails
 * the first assertion; a subpath that stops being measured at all, or one whose
 * shim directory is there and holds nothing, is exit 2 from the probe rather
 * than a shorter list here.
 *
 * **A declared subpath the application does not shim is a third state and is
 * asserted as one** (D-160.14). `./composition` is host composition surface
 * reached only by the bare specifier — one route, so no duplication is possible
 * and there is nothing to compare. The probe reports it as `unshimmed` and this
 * file holds *both* lists to an expected set, so a subpath moving between them
 * — a shim directory deleted, a sixth barrel arriving unmeasured — fails.
 *
 * The population is read off the two module namespaces by
 * `test/helpers/platform-single-copy-probe.ts`, never listed here, so a barrel
 * that gains or loses a name changes the number instead of leaving a stale one
 * (D-100). Type-only exports are absent from both namespaces by construction,
 * which is the correct population: types are erased and cross a copy boundary
 * for free — which is exactly why the acceptance criterion was 9/9 throughout
 * the year the duplication stood.
 *
 * The measurement is spawned because it imports every shim in the tree, which
 * pulls the platform's six entity classes into MikroORM's one global metadata
 * storage. That is harmless once and cannot be undone, so it must not happen in
 * a fork the rest of the suite shares.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
const TSX = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
const PROBE = join(BACKEND_ROOT, 'test', 'helpers', 'platform-single-copy-probe.ts');
const CROSS_BOUNDARY_PROBE = join(
  BACKEND_ROOT,
  'test',
  'helpers',
  'platform-cross-boundary-probe.ts',
);

interface SubpathComparison {
  readonly subpath: string;
  readonly shims: number;
  readonly shared: readonly string[];
  readonly distinct: readonly string[];
}

interface SingleCopyMeasurement {
  /** Every subpath the host's `exports` map declares. */
  readonly declared: readonly string[];
  /** The subpaths the application also reaches through shims — the comparison. */
  readonly comparisons: readonly SubpathComparison[];
  /** Declared, reached by the bare specifier only: nothing to compare. */
  readonly unshimmed: readonly string[];
}

interface CrossBoundaryResult {
  readonly packageThrowIsApplicationError: boolean;
  readonly applicationThrowIsPackageError: boolean;
  readonly oneSalesChannelClass: boolean;
  readonly discovered: readonly string[] | string;
}

function spawnProbe<T>(probe: string): T {
  const result = spawnSync(TSX, [probe], { encoding: 'utf8', cwd: BACKEND_ROOT });
  if (result.status !== 0) {
    throw new Error(
      `${probe} exited ${String(result.status)} — a probe here refuses rather than ` +
        `reporting a clean tree it never read:\n${result.stderr}`,
    );
  }
  const line = result.stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as T;
}

function measure(): SingleCopyMeasurement {
  return spawnProbe<SingleCopyMeasurement>(PROBE);
}

describe('the platform is one copy (feature 080, the relocation)', () => {
  const measurement = measure();
  const comparisons = measurement.comparisons;

  it('accounts for every subpath the host declares', () => {
    // Seven today. Derived from the `exports` map by the probe, so a subpath
    // arrives accounted for rather than silently unmeasured.
    expect([...measurement.declared].sort()).toEqual([
      'commands',
      'composition',
      'events',
      'http',
      'kernel',
      'migrations',
      'tenancy',
    ]);
    // Both host-internal subpaths are reached by the bare specifier alone
    // (D-160.14): there is no `backend/src/composition/` and no
    // `backend/src/migrations/`, and there will not be — the host's own
    // composition root names the package, and the published baseline list
    // (`specs/110-instance-repository/` R1.5) is data the platform carries with
    // no second copy in the application. One route is not a duplication.
    // Asserted rather than filtered out, so a *shimmed* subpath that lost its
    // directory lands here and fails.
    expect(measurement.unshimmed).toEqual(['composition', 'migrations']);
    expect(comparisons.map((entry) => entry.subpath)).toEqual([
      'commands',
      'events',
      'http',
      'kernel',
      'tenancy',
    ]);
    for (const entry of comparisons) {
      expect(
        entry.shared.length + entry.distinct.length,
        `${entry.subpath} contributed no comparable export`,
      ).toBeGreaterThan(0);
      expect(entry.shims, `${entry.subpath} is reached through no shim`).toBeGreaterThan(0);
    }
  });

  it('duplicates no runtime value between the bare specifier and the application', () => {
    // The failing direction that matters, and the one this file exists for. A
    // name here means the platform has two module records for one source file
    // again — the shape that made `instanceof HttpError` false, left
    // `effectiveState` unpopulated and gave `MikroORM.init` two `SalesChannel`s.
    // Do not ledger an entry; find the second resolution and remove it.
    const distinct = comparisons.flatMap((entry) =>
      entry.distinct.map((name) => `${entry.subpath}: ${name}`),
    );
    expect(distinct).toEqual([]);
  });

  it('shares every value a packaged module would import', () => {
    // The six `blog` takes — the module T040b moves first — named because they
    // are the ones that decided the relocation. Each is a value import in
    // `backend/src/modules/blog/`, and each becomes a bare
    // `@endora-commerce/platform/*` specifier the moment the module is a
    // package. Asserting them by name is what keeps this test from passing on a
    // population that has quietly shrunk to the harmless ones.
    const shared = new Set(
      comparisons.flatMap((entry) => entry.shared.map((name) => `${entry.subpath}: ${name}`)),
    );
    for (const symbol of [
      // `blog`'s 11 entity files classify through it; the platform reads the
      // registry it fills. Principle XI's runtime half.
      'tenancy: GlobalEntity',
      // Seven throw sites. `http/error-envelope.ts` and
      // `http/interceptors/dispatch.ts` both ask `err instanceof HttpError`, so
      // a second copy renders every blog 404 and 409 as a 500.
      'http: HttpError',
      // A module-scoped singleton (`kernel/lifecycle/effective-state.ts`). The
      // copy's was never populated by the host's registry cache.
      'kernel: effectiveState',
      // Reads the request channel out of an AsyncLocalStorage the copy declared
      // for itself and the host never entered.
      'kernel: getResolvedChannel',
      // An ORM entity class: two of them is
      // `MetadataError: Duplicate entity names are not allowed` (D-160.6).
      'kernel: SalesChannel',
      // Harmless of the six — a pure function over the `ModuleContext` the host
      // passes in — and listed so the set is the whole one rather than the
      // formerly broken part of it.
      'kernel: lazyPort',
    ]) {
      expect(shared.has(symbol), `${symbol} is not shared`).toBe(true);
    }
  });

  // 59 until 2026-08-25. `enroll` and `verifyTotp` left the kernel barrel with
  // `kernel/crypto/totp` itself, which had no caller once the superseded
  // customer 2FA path was deleted — so this is a published set that shrank by
  // withdrawal, not a sharing that regressed. The number is re-recorded rather
  // than the assertion relaxed: it is the whole point of this file that the
  // count is exact, and a `toBeGreaterThan` here would make the next real
  // duplication invisible.
  it('shares 57 values, which is every one the duplication used to hold apart', () => {
    // Not a target and not a floor somebody chose: it is the number the
    // superseded `host-package-copy.test.ts` measured as *distinct*, over this
    // same population, and it is here so that the inversion is visible as one
    // rather than as a new test that happens to pass. It moves when a barrel
    // does — update it with the barrel, never to make a run green.
    const total = comparisons.reduce((sum, entry) => sum + entry.shared.length, 0);
    expect(total).toBe(57);
  });
});

/**
 * The two consequences, measured as consequences rather than as identity.
 *
 * Object identity implies both, so these could be called redundant. They are
 * here because neither was *derived* from an identity comparison when it was
 * found — the 500s came first, and the ORM refusal came from a boot log — and
 * because they are the two sentences a reader of a future regression will
 * recognise. See `test/helpers/platform-cross-boundary-probe.ts`.
 */
describe('a value crosses the two specifier shapes intact', () => {
  const result = spawnProbe<CrossBoundaryResult>(CROSS_BOUNDARY_PROBE);

  it('`instanceof HttpError` holds in both directions', () => {
    // `http/error-envelope.ts` and `http/interceptors/dispatch.ts` both ask
    // this of every thrown value. It was measured `false` while the package was
    // a second copy, which rendered a packaged module's every 404 and 409 as a
    // 500 — no type error, no log line, no failing test.
    expect(result.packageThrowIsApplicationError).toBe(true);
    // The other direction, because a one-way test also passes when the two
    // classes are unrelated and the check happens to be vacuous.
    expect(result.applicationThrowIsPackageError).toBe(true);
  });

  it('`SalesChannel` is one entity class, and discovery accepts it', () => {
    expect(result.oneSalesChannelClass).toBe(true);
    // `MetadataStorage.metadata` is `globalThis['mikro-orm-metadata']` under an
    // unversioned key, so two classes of one name land in one registry and
    // discovery throws `Duplicate entity names are not allowed: SalesChannel`
    // (D-160.6). One class arrives once and is discovered.
    expect(result.discovered).toEqual(['SalesChannel']);
  });
});
