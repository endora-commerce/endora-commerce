/**
 * The host package publishes a **second copy** of the platform, and nothing in
 * the repository said so out loud (feature 080, T040b).
 *
 * `@endora-commerce/platform` compiles `backend/src/{kernel,http,tenancy,commands,events}`
 * into its own `dist` (`rootDir: ../../backend/src`, T042a/!891). The
 * application runs those directories from source through `tsx`; anything
 * resolving the bare specifier — a workspace module package, an installed one —
 * runs the compiled copy. Same sources, two artefacts, two of every value they
 * export.
 *
 * ## Why this is a test and not a comment
 *
 * It already **is** a comment. `backend/scripts/acceptance/package-schema.ts`
 * (`provisionHostPeers`) states it exactly, and attaches the condition:
 *
 *   > Everything the fixture takes from the host is type-only today, and that is
 *   > load-bearing rather than incidental. […] Do not add a value import here
 *   > until the platform process itself runs the built host.
 *
 * That condition is the precondition of every module package this repository
 * will ship, and it is enforced by nothing: the acceptance criterion is 9/9
 * because its fixture imports two **types** and no values, so the duplication
 * has never had a value to cross. `blog`, the first real module, takes six
 * values — `GlobalEntity`, `HttpError`, `effectiveState`, `getResolvedChannel`,
 * `SalesChannel` and `lazyPort` — and four of those six break in a way `tsc`
 * cannot see. A rule that lives only in a comment beside the one fixture that
 * does not violate it is a rule the next author finds after the fact
 * (issue #137).
 *
 * ## What it asserts, and what makes it two-way
 *
 * Per published subpath: every identity-bearing export the two sides share by
 * name is a **different object** today, and none is shared. Both directions
 * fail. A symbol that becomes shared means the platform process has started
 * running the built host — the condition the acceptance script names — and this
 * file is then wrong and must be inverted, which is its retiring condition. A
 * subpath that stops being measured at all is exit 2 from the probe rather than
 * a shorter list here.
 *
 * The population is read off the two module namespaces by
 * `test/helpers/host-package-copy-probe.ts`, never listed here, so a barrel that
 * gains or loses a name changes the number instead of leaving a stale one
 * (D-100). Type-only exports are absent from both namespaces by construction,
 * which is the correct population: types are erased and cross a copy boundary
 * for free.
 *
 * The measurement is spawned because performing it in-process registers every
 * platform entity in MikroORM's one global metadata storage twice, and the next
 * `MikroORM.init` in that fork would throw `Duplicate entity names are not
 * allowed` — a suite-wide failure caused by the instrument.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = join(HERE, '..', '..', '..');
const TSX = join(BACKEND_ROOT, 'node_modules', '.bin', 'tsx');
const PROBE = join(BACKEND_ROOT, 'test', 'helpers', 'host-package-copy-probe.ts');

interface SubpathComparison {
  readonly subpath: string;
  readonly shared: readonly string[];
  readonly distinct: readonly string[];
}

function measure(): readonly SubpathComparison[] {
  const result = spawnSync(TSX, [PROBE], { encoding: 'utf8', cwd: BACKEND_ROOT });
  if (result.status !== 0) {
    throw new Error(
      `the host-package copy probe exited ${String(result.status)} — it refuses rather than ` +
        `reporting a clean tree it never read:\n${result.stderr}`,
    );
  }
  const line = result.stdout.trim().split('\n').at(-1) ?? '';
  return JSON.parse(line) as SubpathComparison[];
}

describe('the host package is a second copy of the platform (feature 080, T040b)', () => {
  const comparisons = measure();

  it('measures every subpath the host publishes', () => {
    // Five today. Derived from the `exports` map by the probe, so a sixth
    // published directory arrives measured rather than silently unmeasured.
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
    }
  });

  it('shares no runtime value with the application it was compiled from', () => {
    // The failing direction that matters: a name here means the duplication is
    // gone for that symbol, which can only be because the platform process now
    // runs the built host. Delete this file and re-open T040b when it happens —
    // do not extend the expectation.
    const shared = comparisons.flatMap((entry) =>
      entry.shared.map((name) => `${entry.subpath}: ${name}`),
    );
    expect(shared).toEqual([]);
  });

  it('duplicates every value a packaged module would import', () => {
    // The six `blog` takes, named because they are the ones that decide T040b.
    // Each is a value import in `backend/src/modules/blog/`, and each becomes a
    // bare `@endora-commerce/platform/*` specifier the moment the module is a
    // package.
    const distinct = new Set(
      comparisons.flatMap((entry) => entry.distinct.map((name) => `${entry.subpath}: ${name}`)),
    );
    for (const symbol of [
      // `blog`'s 11 entity files. Classified in the copy's registry, read from
      // the other one — the fail-quiet shape Principle XI rests on.
      'tenancy: GlobalEntity',
      // Seven throw sites. `http/error-envelope.ts:260` and
      // `http/interceptors/dispatch.ts:83` both ask `err instanceof HttpError`,
      // so every blog 404 and 409 would render as a 500.
      'http: HttpError',
      // A module-scoped singleton (`kernel/lifecycle/effective-state.ts:167`).
      // The copy's is never populated by the host's registry cache, so the
      // module's own presence probe reads an empty state.
      'kernel: effectiveState',
      // Reads the request channel out of an AsyncLocalStorage the copy declares
      // for itself and the host never enters.
      'kernel: getResolvedChannel',
      // An ORM entity class: two of them is
      // `MetadataError: Duplicate entity names are not allowed` (D-160.6).
      'kernel: SalesChannel',
      // Harmless of the six — a pure function over the `ModuleContext` the host
      // passes in — and listed so the count is the whole set rather than the
      // broken part of it.
      'kernel: lazyPort',
    ]) {
      expect(distinct.has(symbol), `${symbol} is no longer duplicated`).toBe(true);
    }
  });
});
