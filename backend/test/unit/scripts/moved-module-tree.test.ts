import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createMovedModuleTreeFixture,
  createSplitModuleTreeFixture,
  KEPT_MODULE,
  type MovedModuleTreeFixture,
} from '../../helpers/moved-module-tree-fixture.js';
import {
  modulesWithoutSources,
  moduleIdOf,
  vacuousModulePopulation,
} from '../../../scripts/lib/module-population.js';

/**
 * Issue #215 — the checks are the instruments that would tell you a module-tree
 * move went wrong, and they reported a clean tree while it was moving.
 *
 * 1364 of the 1469 `.ts` files under `backend/src` are in `src/modules`. Each
 * check below walks that tree, and each guarded the walk with a test for
 * emptiness — `files.length === 0`, a surviving `lazyPort`, a readable manifest
 * index. Every one of those catches the **total** loss and none catches what
 * actually happens: the walk comes back with the other 105 files, analyses
 * them, finds nothing wrong in them, and prints `violations=0`.
 *
 * Measured on this tree, with `src/modules` moved out of `src`: eight checks
 * exited 0 and reported clean. Three others were red only by accident — a
 * ledger of 157 entries going stale, an allow-list going stale — which is a
 * red that disappears the day the ledger drains. And four more survive a
 * *partial* move, the one a package split actually performs, because their
 * floor is "at least one" rather than "all of them".
 *
 * Two of the eight did not even lose their numbers:
 * `check-entity-tenant-classification` reported `entities=221 classified=221`
 * with the module tree renamed out from under it, because its walk is
 * path-agnostic and only the *attribution* broke.
 *
 * So the assertions are behavioural — each check is spawned over a fixture
 * backend the way CI spawns it — and each comes with its control:
 *
 *   * the check **exits 2** over a residue, not 0 and not 1;
 *   * its message reports a **non-empty** walk, which is the whole point: the
 *     old predicate was satisfied by this exact fixture;
 *   * and over the same fixture with a registry that **agrees** with it, no
 *     check refuses the population — so the refusal above is the missing
 *     modules rather than anything else the fixture did.
 */

interface MovedTreeCheck {
  readonly script: string;
  readonly args: readonly string[];
  readonly prefix: string;
}

const CHECKS: readonly MovedTreeCheck[] = [
  {
    script: 'check-action-route-permissions.ts',
    args: [],
    prefix: '[action-route-permissions]',
  },
  { script: 'check-channel-resolution.ts', args: ['--enforce'], prefix: '[channel-resolution]' },
  { script: 'check-command-coverage.ts', args: ['--strict'], prefix: '[command-coverage]' },
  { script: 'check-container-imports.ts', args: [], prefix: '[container-imports]' },
  {
    script: 'check-entity-tenant-classification.ts',
    args: [],
    prefix: '[tenant-classification]',
  },
  { script: 'check-entry-presence.ts', args: [], prefix: '[entry-presence]' },
  // Feature 080, T010. The trap here is the *other* direction from
  // `check-lock-claims`': this check was loud over a residue rather than green,
  // and loud was mistaken for right. Emptying any one of the eighteen routed
  // modules' bundles produces between 2 and 41 "untranslated" codes — an
  // instruction to write sentences that already exist somewhere in the tree.
  // The fixture keeps `blog`'s bundle precisely so the pre-existing guard ("the
  // walk read no errors.* key") is green and the floor is what refuses.
  { script: 'check-error-translations.ts', args: [], prefix: '[error-translations]' },
  { script: 'check-entry-scope.ts', args: [], prefix: '[entry-scope]' },
  { script: 'check-kernel-boundary.ts', args: [], prefix: '[kernel-boundary]' },
  // Issue #216. Only *part* of its population is the module tree — the
  // manifests; its ledger shards and the checks' own ledgers live under
  // `scripts/`, which a module move does not touch. That is what makes it the
  // trap this file exists for: ~56 artefacts survive the move, so
  // `files.length === 0` is green, the regenerated index still answers for 65
  // modules, so the locked set is complete, and the check would read half the
  // manifests and print `violations=0`.
  { script: 'check-lock-claims.ts', args: [], prefix: '[lock-claims]' },
  { script: 'check-module-boundary.ts', args: [], prefix: '[module-boundary]' },
  { script: 'check-port-catches.ts', args: [], prefix: '[port-catches]' },
  { script: 'check-port-dependencies.ts', args: [], prefix: '[port-deps]' },
  { script: 'check-port-shape.ts', args: [], prefix: '[port-shape]' },
  { script: 'check-subscribe-seam.ts', args: [], prefix: '[subscribe-seam]' },
  { script: 'check-transaction-context.ts', args: [], prefix: '[transaction-context]' },
];

let moved: MovedModuleTreeFixture;
let agreeing: MovedModuleTreeFixture;

beforeAll(() => {
  moved = createMovedModuleTreeFixture();
  agreeing = createMovedModuleTreeFixture({ registeredIds: [KEPT_MODULE] });
});

afterAll(() => {
  moved?.cleanup();
  agreeing?.cleanup();
});

describe('a moved module tree is refused, not reported clean (issue #215)', () => {
  for (const check of CHECKS) {
    it(`${check.script} exits 2 over a residue the old guard called clean`, () => {
      const result = moved.run(check.script, check.args);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain(check.prefix);
      // The discrimination that matters, asserted in the same run so it costs
      // no second spawn: `files.length === 0` was **green** on this fixture, so
      // a proof that only read the exit code could not tell the new guard from
      // the old one.
      const read = /the walk read (\d+) file\(s\)/.exec(result.output);
      expect(read, `no walk size in: ${result.output}`).not.toBeNull();
      expect(Number(read?.[1])).toBeGreaterThan(0);
    });

    it(`${check.script} does not refuse the same tree when the registry agrees`, () => {
      // The control is the *reason*, not the exit code. Four of the thirteen
      // carry floors of their own that a 16-file tree trips as well
      // (`check-port-shape` still exits 2 here, on "no published port"), and an
      // assertion on the code alone would either fail on those or, worse, pass
      // on a fixture that was broken in some way unrelated to the population.
      const result = agreeing.run(check.script, check.args);
      expect(result.output, `refused the population it was given: ${result.output}`).not.toMatch(
        /produced none for/,
      );
    });
  }
});

/**
 * The modules the split fixture relocates.
 *
 * Chosen for one property and stated rather than assumed: **no artefact under
 * `backend/scripts` and no entry in `backend/package.json` names any of them**,
 * so relocating one changes no ledger key, no allow-list entry and no declared
 * program. That is what lets the split tree be held to the *same* verdict as the
 * one-root tree — the only difference between the two runs is where the sources
 * are. A module that carried a ledger entry would move its key with it, and the
 * resulting red would be the ledger going stale rather than anything about the
 * roots.
 *
 * Six, not one: a single relocated module would leave every check's walk more
 * than 98% inside the application tree, which is comfortably inside the shape
 * that made #215 possible in the first place.
 */
const PACKAGED_MODULES: readonly string[] = [
  'autopay',
  'email',
  'google_analytics',
  'google_tag_manager',
  'meta_ads',
  'paypal',
];

/**
 * The module the half-moved tree strands, and why it is not one of the six.
 *
 * `check-error-translations` declares an **exclusion**: its floor is the
 * eighteen modules `ERROR_TRANSLATION_KEYS` routes a code to, because most
 * modules ship no error sentence and asking every one of them for a bundle
 * would make the floor a list of exceptions. So a module outside that eighteen
 * is *correctly* absent from its expectation, and stranding one would leave
 * that check green while the other fifteen went red — a per-check answer, which
 * is exactly what a shared fixture must not have. `comparisons` is routed, so
 * every floor in the estate covers it, and it is not among the packaged six, so
 * the passing tree is unaffected.
 */
const STRANDED_MODULE = 'comparisons';

describe('a split module tree is read in full, not in half (feature 080, T040a)', () => {
  let split: MovedModuleTreeFixture;
  let halfMoved: MovedModuleTreeFixture;

  beforeAll(() => {
    split = createSplitModuleTreeFixture({ packaged: PACKAGED_MODULES });
    // One module moved to the same address with no `package.json` beside it —
    // the state a half-finished `git mv` leaves. Nothing declares it, so no
    // glob produces it and no root covers it.
    halfMoved = createSplitModuleTreeFixture({
      packaged: PACKAGED_MODULES,
      stranded: [STRANDED_MODULE],
    });
  }, 120_000);

  afterAll(() => {
    split?.cleanup();
    halfMoved?.cleanup();
  });

  for (const check of CHECKS) {
    it(`${check.script} reads both roots and passes`, () => {
      const result = split.run(check.script, check.args);
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain(check.prefix);
      expect(result.output, 'refused a population it should have covered').not.toMatch(
        /produced none for/,
      );
    }, 120_000);

    it(`${check.script} exits 2 when one registered module is in neither root`, () => {
      // The discrimination the fixture above cannot make: this tree holds every
      // source the passing one holds, in the same two roots, minus one
      // `package.json`. A check that walked only `src/modules` would be red on
      // *both* trees; one that walked "whatever is under packages/" would be
      // green on both.
      const result = halfMoved.run(check.script, check.args);
      expect(result.status, result.output).toBe(2);
      expect(result.output).toContain(STRANDED_MODULE);
    }, 120_000);
  }
});

describe('the population floor itself', () => {
  it('reads the module id out of a core path and an overlay path alike', () => {
    expect(moduleIdOf('modules/blog/backend.ts')).toBe('blog');
    expect(moduleIdOf('apps/example/modules/example_overlay/backend.ts')).toBe('example_overlay');
    expect(moduleIdOf('/abs/backend/src/modules/orders/services/order.service.ts')).toBe('orders');
    expect(moduleIdOf('kernel/lifecycle/plugin-helpers.ts')).toBeNull();
    // `node_modules/` is not a module tree, and a segment match that forgot the
    // separator would call every dependency one.
    expect(moduleIdOf('node_modules/typescript/lib/tsc.js')).toBeNull();
  });

  it('names the modules the walk missed rather than counting them', () => {
    const missing = modulesWithoutSources({
      registered: ['blog', 'cms', 'orders'],
      files: ['kernel/x.ts', 'apps/example/modules/example_overlay/backend.ts', 'modules/blog/a.ts'],
    });
    expect(missing).toEqual(['cms', 'orders']);
  });

  it('honours the exclusions a check declares, so its floor is the tree it reads', () => {
    // `check-command-coverage` excludes the audit writer by argument, and a
    // floor that asked for it would fail on every clean run.
    expect(
      modulesWithoutSources({
        registered: ['audit_logs', 'orders'],
        files: ['modules/orders/a.ts'],
        excluded: ['audit_logs'],
      }),
    ).toEqual([]);
  });

  it('refuses an index that registers nothing, rather than reading it as "all present"', () => {
    expect(vacuousModulePopulation({ registered: [], files: ['modules/blog/a.ts'] })).toMatch(
      /registers no module/,
    );
  });

  it('is silent when every registered module turned up', () => {
    expect(
      vacuousModulePopulation({
        registered: ['blog', 'orders'],
        files: ['modules/blog/a.ts', 'modules/orders/b.ts'],
      }),
    ).toBeNull();
  });
});
