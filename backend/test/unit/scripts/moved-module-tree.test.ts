import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createMovedModuleTreeFixture,
  createSplitModuleTreeFixture,
  endoraSpecifierResolutions,
  KEPT_MODULE,
  keptModuleSpecifier,
  manifestIndexSpecifiers,
  MINIMUM_MODULES_OUTSIDE_THE_APPLICATION_TREE,
  modulesInTheApplicationTree,
  packagedModuleIds,
  planSplitRelocation,
  routedModuleIds,
  runCheckInThisCheckout,
  type EndoraSpecifierResolution,
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
  // `specs/094-translation-boundary/`. Its walk visits each registered module's
  // **own directory** rather than its source files, which makes the residue
  // shape sharper here than for a file walk: over a moved tree the index still
  // answers for every module and the directories are simply not there, so a
  // check that asked "did the walk read anything?" would find the one module the
  // fixture keeps, read its bundles, and report a clean tree with 68 modules
  // unjudged. The floor is per module and refuses instead.
  // `specs/096-page-builder-block-ownership/`. Its module half is every module's
  // own sources, and over a moved tree the walk comes back with the
  // page-builder family alone — three packages, several hundred files, none of
  // them a module's. That is issue #215's exact shape: `files.length === 0` is
  // false, the renderer-map sites are all still there, and the check would
  // report a clean tree with 71 modules unjudged. The floor is per module and
  // refuses first, before a finding count can be printed.
  { script: 'check-block-names.ts', args: [], prefix: '[block-names]' },
  { script: 'check-bundle-pairing.ts', args: [], prefix: '[bundle-pairing]' },
  // `specs/110-instance-repository/` T129b (owner ruling D-219). Its render walk
  // is `layout.moduleWalkRoots` plus the non-module packages that declare
  // `./tailwind.css` plus the admin's own roots — so over a moved tree it comes
  // back with the kit, the shell, the page-builder family and the admin project,
  // several hundred files, none of them a module's. That is issue #215's exact
  // shape and it is worse here than a clean-line-over-nothing: those residual
  // files render the vocabulary too, so a check asking *"did I read anything?"*
  // would find most definitions rendered and print `findings=0` over 71
  // unjudged modules. The floor is per module and refuses first.
  { script: 'check-class-vocabulary.ts', args: [], prefix: '[class-vocabulary]' },
  // `specs/100-module-owned-documentation/`. Its module walk is
  // `check:bundle-pairing`'s — each registered module's own directory — so the
  // residue shape is the same: over a moved tree the index still registers 71
  // modules, none of their directories is there, and the documentation tree is
  // untouched, so a check asking "did I read any page?" would read all 77, find
  // every one of them attributed and reachable, and print a clean line over a
  // platform whose modules it could not see.
  { script: 'check-module-docs.ts', args: [], prefix: '[module-docs]' },
  // `specs/094-translation-boundary/`. An ordinary module file walk, and it is
  // the shape #215 was written about: `backend/src` without the module tree is
  // a few per cent of the literals, all of them the platform's own and every one
  // of them English, so a walk that asked "did I read anything?" would classify
  // that residue, find no Polish in it and print a clean line over 68 unjudged
  // modules.
  { script: 'check-default-language-prose.ts', args: [], prefix: '[default-language-prose]' },
  // `specs/113-module-owned-demo-data/` FR-016. Its walk visits each registered
  // module's **own directory** — `check:bundle-pairing`'s shape — and the
  // residue here is the sharpest of the family, because the check's *own*
  // subject is legitimately zero: no module ships a demo asset today, so
  // `sites=0` is the invariant rather than a blind run and cannot carry the
  // floor. Over a moved tree the index still answers for every module, none of
  // the directories is there, and a check that asked "did I find any asset?"
  // would print exactly the number it prints on a healthy tree. The floor is
  // per module and refuses first.
  { script: 'check-demo-data-budget.ts', args: [], prefix: '[demo-data-budget]' },
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
  { script: 'check-platform-surface.ts', args: [], prefix: '[platform-surface]' },
  { script: 'check-subscribe-seam.ts', args: [], prefix: '[subscribe-seam]' },
  { script: 'check-transaction-context.ts', args: [], prefix: '[transaction-context]' },
  // Feature 080, T061. Its population is *two* — the module walk it shares with
  // every check above, and a consumer walk over the whole application member —
  // so a moved module tree leaves it plenty of files and the floor is what
  // refuses. Over the split tree it must pass rather than merely survive: the
  // packages it derives its subject from are exactly the ones the split fixture
  // relocates, so a check that only knew `backend/src/modules` would report a
  // clean tree with no subject at all.
  //
  // **T061a gives it a third population that straddles both roots**, which is
  // what makes it worth more here than a check with one walk: the chain-parent
  // signal names `Invoice` out of a package and `Order` out of the application
  // tree, and reconciles each against the `@Entity()` declaration the walk found
  // for it. A walk that lost either root leaves a parent named and unresolved —
  // a `short-walk` refusal — which is #215 arriving through a door no module-id
  // floor covers, since both trees still hand it thousands of files.
  { script: 'check-singleton-identity.ts', args: [], prefix: '[singleton-identity]' },
  // Feature 111, Phase 4. Its floor was never in doubt — it delegates to
  // `refuseVacuousModulePopulation` before either addend of its union — and what
  // kept it out of this list was this fixture: its first vacuous condition is
  // *"the walk opened no test file under `backend/test/`"*, which every backend
  // here satisfied until FR-006 staged that tree, and giving it one used to red
  // `check-singleton-identity` for the anchor FR-001 has since corrected. Both
  // are gone, so it joins the list rather than keeping a block of its own: what
  // it was waiting for is exactly what the two phases added.
  { script: 'check-test-ownership.ts', args: [], prefix: '[test-ownership]' },
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
 * Feature 111, Phase 1 — the fixture's first-party packages are the fixture's.
 *
 * The fixture used to borrow this repository's `node_modules` by symlink, and
 * every `@endora-commerce/*` link inside that tree is **relative**
 * (`mod-blog -> ../../../packages/modules/blog`), so following the borrowed
 * symlink re-rooted all 76 of them in the **real checkout**. That is issue
 * #255's failure arriving inside the one instrument whose job is to notice that
 * a module is not where the registry says it is: a fixture that claims to have
 * moved a module while every reader still finds a complete copy at its real
 * address cannot refuse anything, and the check reports clean for exactly the
 * reason the fixture exists to catch.
 *
 * The guard is written **before** the specifier shape changes (FR-001 is Phase
 * 2), so today it is a green assertion over a tree in which every fixture-local
 * package is reached by a relative path and nothing escapes. What makes it
 * worth landing now is the third case below: it is the assertion that becomes
 * load-bearing the moment the index starts emitting bare specifiers, and it is
 * cheaper to have it standing than to add it in the same merge request as the
 * change it protects.
 */
function expectNoFirstPartySpecifierEscapes(
  label: string,
  resolutions: readonly EndoraSpecifierResolution[],
): void {
  const named = (verdict: EndoraSpecifierResolution['verdict']): string =>
    resolutions
      .filter((resolution) => resolution.verdict === verdict)
      .map(
        (resolution) => `  ${resolution.specifier} (named by ${resolution.from}) -> ${resolution.target ?? 'nothing'}`,
      )
      .join('\n');
  expect(
    resolutions.filter((resolution) => resolution.verdict === 'escaped'),
    `${label}: a first-party specifier left the fixture and answered another checkout:\n${named('escaped')}`,
  ).toEqual([]);
  expect(
    resolutions.filter((resolution) => resolution.verdict === 'unresolvable'),
    `${label}: the fixture holds these packages and this checkout's backend reaches them, ` +
      `but the fixture resolves neither:\n${named('unresolvable')}`,
  ).toEqual([]);
  // Not a vacuous green: a walk that stopped finding specifiers, or a `held`
  // set that came back empty, would satisfy both assertions above in silence.
  expect(
    resolutions.filter((resolution) => resolution.verdict === 'inside').length,
    `${label}: no first-party specifier resolved at all, so the two assertions above ` +
      'passed over nothing',
  ).toBeGreaterThan(0);
}

describe('a fixture resolves its own packages, not the real checkout\'s (feature 111, FR-003)', () => {
  it('resolves every first-party specifier the moved tree names inside itself', () => {
    expectNoFirstPartySpecifierEscapes('moved', endoraSpecifierResolutions(moved.root));
    expectNoFirstPartySpecifierEscapes('agreeing', endoraSpecifierResolutions(agreeing.root));
  });

  it('goes red over a fixture that borrows this repository\'s node_modules', () => {
    // The red proof, and it has to be a **built** fixture: the escape is silent
    // by construction — the borrowed tree resolves to a complete package and
    // every reader is happy — so there is nothing to go red over until a
    // fixture is standing that does it. The input enters at the top of the
    // analysis (issue #130) rather than as a value the guard normally computes.
    const borrowed = createMovedModuleTreeFixture({ borrowNodeModules: true });
    try {
      const resolutions = endoraSpecifierResolutions(borrowed.root);
      const escaped = resolutions.filter((resolution) => resolution.verdict === 'escaped');
      expect(escaped.length, JSON.stringify(resolutions, null, 2)).toBeGreaterThan(0);
      // It names the escaping specifier and its target, because a guard that
      // only said "something escaped" would send its reader to the wrong file.
      for (const resolution of escaped) {
        expect(resolution.specifier).toMatch(/^@endora-commerce\//);
        expect(resolution.target).not.toBeNull();
        expect(resolution.target).not.toContain(borrowed.root);
      }
      expect(escaped.map((resolution) => resolution.specifier)).toContain(
        '@endora-commerce/contracts',
      );
      expect(() => expectNoFirstPartySpecifierEscapes('borrowed', resolutions)).toThrow(
        /left the fixture and answered another checkout/,
      );
    } finally {
      borrowed.cleanup();
    }
  });
});

/**
 * The modules the split fixture may relocate — a **pool**, not a roster.
 *
 * Every member is chosen for one property, stated rather than assumed: **no
 * artefact under `backend/scripts` keys anything on its location, and
 * `backend/package.json` declares no program inside it**, so relocating one
 * changes no ledger key, no allow-list entry and no declared program. That is
 * what lets the split tree be held to the *same* verdict as the one-root tree —
 * the only difference between the two runs is where the sources are. A module
 * whose path a ledger keys on would move that key with it, and the resulting red
 * would be the ledger going stale rather than anything about the roots. Being
 * *named* is not the same as being keyed on: `stripe` and `comparisons` appear
 * in a dozen prose comments and in `MIGRATED_MODULES`, which is a list of ids
 * and travels with the module; what disqualifies a candidate is a
 * `modules/<id>/…` **path** in a ledger, a `scripts/*.ts` entry point of its
 * own, a cross-owner permission gate, an overlay reach into it, or a place in
 * a batch that is about to move it for real.
 *
 * **The list used to shrink on every move and the shrinking was the friction.**
 * The fixture relocates a module by copying `backend/src/modules/<id>` and
 * deleting the original, so a module that has really become a package fails the
 * copy outright — `ENOENT … lstat backend/src/modules/google_analytics`, which
 * is how the third package took all 73 proofs here with it. It is not lost from
 * the split tree by leaving: `createSplitModuleTreeFixture` copies every module
 * package this repository already ships, under the same
 * `packages/modules/<id>/` address and with its own real `package.json`, which
 * is the state relocation *simulates*. So the count that matters — modules the
 * estate must find outside `backend/src` — is this pool's still-available
 * members **plus** the real packages, and `planSplitRelocation` takes the
 * intersection with the application tree so a move costs no edit here.
 *
 * **It is a list and not a derivation, deliberately.** "Any six registered
 * modules that are not already packages" is expressible and would be wrong: the
 * property above is not one a walk can decide. Ledger keys are spelled several
 * ways, T053's cross-owner permission gates and overlay reach are recorded in a
 * spec rather than in the tree, and "is in the next batch" is a fact about work
 * in flight that no artefact carries. A derivation that cannot express the
 * constraint would pick a blocked module, go red for a reason that is not the
 * one the fixture measures, and send its author looking for a defect in the
 * check estate. So: a curated pool, with the availability question — the only
 * part that really is derivable, and the only part that went stale — derived.
 */
const PACKAGED_MODULE_CANDIDATES: readonly string[] = [
  'autopay',
  'email',
  'google_tag_manager',
  'meta_ads',
  'paypal',
  'stripe',
  'tpay',
  'payu',
  'quick_order',
  'taxes',
  // Replenished for T040b's fourth batch, which takes `email` — the pool's last
  // still-available member. Both additions are chosen for the property the
  // paragraph above states and for one the sweep has made scarce: they are
  // **deferred**, so they stay under `backend/src/modules` rather than being
  // consumed by the next batch. `pim_ergonode` and `admin_users` are two of the
  // three heavy singles T040b splits off from the batches (14 410 lines and 47
  // test files respectively); neither carries a `modules/<id>/…` path in any
  // ledger, an entry point of its own under `backend/scripts`, or an overlay
  // reach.
  //
  // **`pim_ergonode` has since been packaged as a single**, so it is a real
  // package rather than a relocation candidate and `modulesInTheApplicationTree`
  // drops it — which is the pool working as designed and cost this file no edit
  // beyond this paragraph. The reason it was expected to stay is worth
  // correcting rather than deleting: *deferred* is not *blocked*, and the
  // sentence above read as if it were. Nothing blocked this module; it was
  // split off the batches for its size alone. A pool member picked for being
  // large is a member the sweep will reach, so the next replenishment should
  // prefer one that is blocked on a **named criterion** — criterion 7 or 8, an
  // open ledger shard — which is a fact an artefact carries.
  'pim_ergonode',
  'admin_users',
];

const PACKAGED_MODULES = modulesInTheApplicationTree(PACKAGED_MODULE_CANDIDATES);

/**
 * The candidates for the module the half-moved tree strands, and why they are
 * not the pool above.
 *
 * `check-error-translations` declares an **exclusion**: its floor is the
 * eighteen modules that **declare** an error code, because most modules ship no
 * error sentence and asking every one of them for a bundle would make the floor
 * a list of exceptions. So a module outside that eighteen is *correctly* absent
 * from its expectation, and stranding one would leave that check green while the
 * other fifteen went red — a per-check answer, which is exactly what a shared
 * fixture must not have. Every candidate here is therefore a declaring module,
 * which every floor in the estate then covers, **free** on the same terms as the
 * pool above, and disjoint from it so the passing tree is unaffected. That
 * property is not left to memory: it is asserted below against
 * `routedModuleIds()` itself, for the whole pool rather than for today's pick,
 * so a successor that stopped declaring is a red here rather than one check
 * silently disagreeing with the other sixteen. The rest of each
 * successor's fitness was **measured once**, in the merge request that added
 * them — all four stranded in turn, all seventeen checks exiting 2 on each —
 * and is deliberately not a standing test: four more half-moved fixtures would
 * quadruple this file's five minutes to prove something only the next move can
 * change.
 */
const STRANDED_MODULE_CANDIDATES: readonly string[] = [
  'comparisons',
  'credentials',
  'dictionaries',
  'search',
  'assets_library',
  // T040b's fourth batch takes `assets_library`, the last member the
  // application tree still held.
  //
  // **This pool is running out for a structural reason and not for want of
  // curation, and the next batch should read this rather than re-derive it.**
  // A member has to satisfy three conditions at once: `ERROR_TRANSLATION_KEYS`
  // must route a code to it (the paragraph above), no ledger may key on its
  // path, and it has to still be under `backend/src/modules` when the fixture
  // runs. Derived on 2026-08-25, the routed set that is still in the
  // application tree is eight modules; batch four takes four of them
  // (`assets_library`, `carts`, `invoices`, `settings`), and of the four left
  // — `catalog`, `inventory`, `orders`, `megamenu` — the first three each own a
  // cross-module ledger shard keyed on their own files, so stranding one is a
  // stale-entry red (exit 1) rather than the missing-population red (exit 2)
  // this fixture asserts. That leaves exactly one.
  //
  // **Batch five took `megamenu` and made the rewrite the comment above
  // predicted, so this pool no longer drains.**
  //
  // `createSplitModuleTreeFixture` now stages the half-moved state out of a
  // **package** as well as out of the application tree: it has already copied
  // every module package to `packages/modules/<id>/`, and deleting the
  // `package.json` it copied leaves the identical state — sources at a package
  // address that no glob produces and no root covers. Two consequences worth
  // stating, because they change what a member has to be. Nothing is *moved*,
  // so no path changes and a ledger keyed on the stranded module stays valid
  // where a relocation would have made it stale. And the population this draws
  // from **grows** with every batch rather than shrinking, which is what ends
  // the replenishment treadmill four batches have now paid for.
  //
  // The two remaining conditions are unchanged and are what this list still
  // exists for: the member must declare an error code (the paragraph above,
  // asserted below for the whole pool), and no check script's
  // ledger may key on its path — withholding the manifest takes the module out
  // of every walk, so a key on it would go stale and produce an exit 1 where
  // this fixture asserts the missing-population exit 2. Derived on 2026-08-26
  // over `backend/scripts`, these three carry no such key.
  'megamenu',
  'search',
  'credentials',
];

const STRANDED_MODULE = ((): string => {
  // The application tree first — that half needs no package to exist and is the
  // state a half-finished `git mv` literally leaves. When the pool has no member
  // there any more, a real package stages the same state by having its
  // `package.json` withheld; see the fixture.
  const [inTree] = modulesInTheApplicationTree(STRANDED_MODULE_CANDIDATES);
  if (inTree !== undefined) return inTree;
  const packaged = new Set(packagedModuleIds());
  const [asPackage] = STRANDED_MODULE_CANDIDATES.filter((id) => packaged.has(id));
  if (asPackage !== undefined) return asPackage;
  throw new Error(
    'no member of STRANDED_MODULE_CANDIDATES is under backend/src/modules or is a module ' +
      'package this repository ships, so the half-moved tree has nothing to strand. Add a ' +
      'module that declares an error code and that no check script keys on its path.',
  );
})();

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

  it('resolves every first-party specifier both split trees name inside themselves', () => {
    // The tree this matters most for. It holds 75 of the 76 members of this
    // checkout's `@endora-commerce` scope, so with the borrowed tree every one
    // of them answered the real checkout — including the module packages whose
    // *location* is the whole subject of the proofs above.
    expectNoFirstPartySpecifierEscapes('split', endoraSpecifierResolutions(split.root));
    expectNoFirstPartySpecifierEscapes('half-moved', endoraSpecifierResolutions(halfMoved.root));
  }, 120_000);

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

  /**
   * Feature 111, Phase 2 — the fixture names a packaged module the way the
   * generator does (FR-001, FR-005; `contracts/split-fixture-package-naming.md`
   * § 1 and § 4).
   *
   * The specifier decides the **anchor**, not the address: `resolveManifestPath`
   * answers a bare specifier with the resolved `package.json` and a relative one
   * with the manifest module file, and every package-root asset is found by
   * joining a manifest declaration to `dirname(manifestPath)`. So a fixture that
   * spells it relatively puts the anchor at `<pkg>/src` and hands the estate a
   * layout no client instance and no generator ever produces.
   *
   * The four assertions below are § 4's, and each is written because an **exit
   * code cannot carry it**: three of the four checks exited 0 over this tree
   * while reading the wrong file, which is the shape issue #113 is about one
   * level up. They are the observable that the anchor is the package root, so a
   * change that quietly reverts § 1 is red here rather than merely different.
   */
  it('names every staged package bare and a stranded module relatively (§ 1)', () => {
    const bare = (specifier: string): boolean => !specifier.startsWith('.');
    const splitSpecifiers = manifestIndexSpecifiers(split.root);
    const halfMovedSpecifiers = manifestIndexSpecifiers(halfMoved.root);
    // **Every specifier in the split tree is bare, and the last one to become so
    // is the kept module's.** This assertion read *"the mixed result is the
    // design, not a transitional state"* and named
    // `../../packages/platform/dist/lifecycle/manifest.js` as the relative half,
    // which was true for as long as the host published no subpath reaching
    // inside it: `specs/115-lifecycle-container-move/` Phase 6 gave `_lifecycle`
    // `@endora-commerce/platform/lifecycle` and the real committed index now
    // holds 71 specifiers and not one relative. The fixture is uniform because
    // the tree is, which is the claim FR-001 makes; a literal here was a derived
    // fact written down (D-100), in the test whose subject is a derivation, and
    // it went stale in the merge request that changed the generator.
    expect(splitSpecifiers.filter(bare).length).toBeGreaterThan(0);
    expect(splitSpecifiers.filter((specifier) => !bare(specifier))).toEqual([]);
    // The kept module is named exactly as the **real** index names it, read off
    // the committed artefact rather than composed here, so the next change of
    // spelling moves this assertion with it instead of stranding it.
    expect(splitSpecifiers).toContain(keptModuleSpecifier());
    expect(bare(keptModuleSpecifier()), keptModuleSpecifier()).toBe(true);
    // The stranded module is the refusal, not a preference: it has no
    // `package.json`, so `createRequire(...).resolve('<pkg>/package.json')`
    // throws inside `resolveManifestPath` at the index's first import, and every
    // spawned check would die at module resolution — a crash where the half-moved
    // proof above asserts an exit 2.
    const strandedSpecifiers = halfMovedSpecifiers.filter((specifier) =>
      specifier.includes(`/${STRANDED_MODULE}/`),
    );
    expect(strandedSpecifiers, `no specifier for ${STRANDED_MODULE}`).toHaveLength(1);
    expect(strandedSpecifiers.filter(bare)).toEqual([]);
    // And it is the *only* difference between the two trees' spellings, so the
    // stranding is what the half-moved proofs measure rather than a second
    // change riding along with it.
    expect(halfMovedSpecifiers.filter(bare).length).toBe(splitSpecifiers.filter(bare).length - 1);
  });

  it('reads every module\'s bundles, rather than one module\'s (§ 4.1)', () => {
    // A conditional predicate — the obligation attaches to a module's *first*
    // bundle — is vacuously clean over a tree whose packages ship nothing
    // findable, so this check's exit code is not evidence and its counts are.
    // Measured before Phase 2: `files=2`, 1 module shipping bundles and 70
    // shipping none, `findings=0`, exit 0. None of its four refusals fires,
    // because a bundle *was* read and the module walk *is* complete.
    const counts = /modules shipping bundles=(\d+) shipping none=(\d+)/;
    const overTheFixture = counts.exec(split.run('check-bundle-pairing.ts').output);
    const overThisCheckout = counts.exec(
      runCheckInThisCheckout('check-bundle-pairing.ts').output,
    );
    expect(overThisCheckout, 'this checkout reported no bundle counts').not.toBeNull();
    expect(overTheFixture?.[0]).toBe(overThisCheckout?.[0]);
    // Not a vacuous agreement: two trees that both found nothing would satisfy
    // the equality above.
    expect(Number(overThisCheckout?.[1])).toBeGreaterThan(1);
  }, 120_000);

  for (const script of ['check-action-route-permissions.ts', 'check-module-docs.ts']) {
    it(`${script} has an emitted artefact to judge for staleness (§ 4.2)`, () => {
      // `emitted-freshness.ts`' subject is *the file whose bytes the run read*,
      // and a registry naming a package's **source** has no staleness question —
      // correctly, and with the consequence that these two checks exercised
      // `stale-artefact` / `unpairable-artefact` only in their own companion
      // tests. The token is the observable that the anchor moved; an exit-code
      // assertion would not notice it going away.
      const token = /emitted-manifests:(\d+)\/(\d+)/.exec(split.run(script).output);
      expect(token, `${script} printed no emitted-manifests token`).not.toBeNull();
      expect(Number(token?.[2])).toBeGreaterThan(0);
      expect(token?.[1]).toBe(token?.[2]);
    }, 120_000);
  }

  /**
   * Feature 111, Phase 3 — the two trees the fixture was missing (FR-006,
   * FR-007).
   *
   * Three checks could be spawned here and none of them could reach a verdict,
   * each refusing — correctly — for a population this fixture had never staged:
   * `check-test-ownership` on *"the walk opened no test file under
   * `backend/test/`"*, and both admin checks on the absence of
   * `@endora-commerce/admin-kit`. That is the state
   * `contracts/split-fixture-package-naming.md` § 6 is about: a check whose
   * population **is** the module tree, recorded in the inventory as one whose
   * population is not, because the shared fixture could not stage it.
   *
   * The assertions are the observables rather than the exit codes alone. A
   * refusal is printed *before* a `read:` line, so a token that only exists on
   * the far side of the vacuous gate is what says the population arrived; an
   * exit code would also be satisfied by a check that started failing for some
   * reason of its own.
   *
   * **Phase 4 has since taken all three answers out of this block**, and what is
   * left below is what `CHECKS` cannot say. `check-test-ownership` is a member
   * of that list now, so its exit codes over all three trees, its prefix and its
   * agreeing-registry control are asserted there; the one thing the shared list
   * does not read is the two addends of its union, which is what stays here.
   * `check-admin-zones` gets a block of its own further down, for a reason that
   * is stated there. `check-admin-surface` keeps this block's original
   * assertion, because it does **not** discriminate — measured, exit 0 over the
   * half-moved tree — and staging its population is all this feature owes it.
   */
  it('check-test-ownership reads both addends of its union over the split tree (§ 3.1)', () => {
    const result = split.run('check-test-ownership.ts');
    expect(result.status, result.output).toBe(0);
    // Each addend is floored separately in the check, because a union whose
    // addends are not is a half that can go to zero unnoticed — and an exit code
    // cannot carry that. The application half is the tree Phase 3 stages; the
    // package half was already here.
    const counts = /application=(\d+) packages=(\d+)/.exec(result.output);
    expect(counts, `no test-ownership counts in: ${result.output}`).not.toBeNull();
    expect(Number(counts?.[1])).toBeGreaterThan(0);
    expect(Number(counts?.[2])).toBeGreaterThan(0);
  }, 120_000);

  it('check-admin-surface no longer refuses for a population the fixture did not stage (§ 3.2)', () => {
    // Its published set: the kit's own `exports` map, read once the kit is a
    // member of this workspace. Not an assertion that the check *passes* — what
    // this feature owes it is a population, and its findings and ledgers are its
    // own. Exit 2 is the one answer that says the fixture is still short.
    //
    // It stays out of `CHECKS` on a measurement rather than on a shortfall: over
    // the half-moved tree it exits **0**, its `manifest-index` expectation
    // shrinking with the module the fixture strands (55/55 -> 54/54), so the
    // shared list would assert no discrimination for it. Its source matches
    // neither spelling of the shared guard, and its `not-a-module-walk` is
    // correct.
    const result = split.run('check-admin-surface.ts');
    expect(result.status, result.output).not.toBe(2);
    expect(result.output).not.toContain('refusing to report a vacuous pass');
    const read = /admin-kit-exports:(\d+)\/(\d+)/.exec(result.output);
    expect(read, `check-admin-surface printed no admin-kit-exports token: ${result.output}`).not.toBeNull();
    expect(Number(read?.[2])).toBeGreaterThan(0);
    expect(read?.[1]).toBe(read?.[2]);
  }, 120_000);

  /**
   * Feature 111, Phase 4 — `check-admin-zones` discriminates, in a block of its
   * own (FR-008).
   *
   * It is marked `derived-population` in `check-inventory.test.ts` on the
   * measurement below, and it is **not** in `CHECKS` for one reason worth
   * stating rather than working around: over a tree with no admin render at all
   * this check's *own* vacuous refusal fires before the module floor, so its
   * moved-tree message is the zone one — *"the enum declares zone names and the
   * walk found neither a render nor a contribution"* — and carries no walk size,
   * which is what every member of that list is held to. Both refusals are
   * correct and only one of them is the floor's, so the floor is exercised where
   * it can be: over the half-moved tree, which is the sharper case anyway, since
   * a partial move is what a package split actually performs.
   *
   * Its entry read `not-a-module-walk` until this phase, on the ground that
   * *"over the moved tree and the split tree alike it would exit 2 on the kit,
   * which asserts no discrimination at all"*. That was true and FR-007 ended it.
   */
  it('check-admin-zones reads both roots and passes over the split tree', () => {
    const result = split.run('check-admin-zones.ts');
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('[admin-zones]');
    expect(result.output, 'refused a population it should have covered').not.toMatch(
      /produced none for/,
    );
    // The `admin-ui` token counts the family members **other than** the kit, so
    // it is only printed once the kit itself is one: a workspace with no kit
    // refuses before this line, and one with a kit and no second member prints
    // nothing rather than `0/0`. It is the observable that FR-007's staging
    // arrived, and an exit code would not carry it.
    const admin = /admin-ui:(\d+)\/(\d+)/.exec(result.output);
    expect(admin, `no admin-ui token in: ${result.output}`).not.toBeNull();
    expect(Number(admin?.[2])).toBeGreaterThan(0);
    expect(admin?.[1]).toBe(admin?.[2]);
    // And the module half, which is the one this block is about: both floors
    // covered, neither short.
    const modules = /module-admin:(\d+)\/(\d+)/.exec(result.output);
    expect(modules, `no module-admin token in: ${result.output}`).not.toBeNull();
    expect(modules?.[1]).toBe(modules?.[2]);
  }, 120_000);

  it('check-admin-zones refuses a moved tree, for its own reason rather than the floor\'s', () => {
    const result = moved.run('check-admin-zones.ts');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain('[admin-zones]');
    // Named rather than merely counted, because this is the discrimination the
    // block above is worth nothing without — and because which refusal fires is
    // the fact that keeps it out of `CHECKS`.
    expect(result.output).toContain('neither a render nor a contribution');
  }, 120_000);

  it('check-admin-zones exits 2 on its module floor when one module is in neither root', () => {
    // The floor itself, and the tree that can reach it: the half-moved tree
    // holds every admin render the passing one holds, so the zone refusal is
    // satisfied and the module population is what is short.
    const result = halfMoved.run('check-admin-zones.ts');
    expect(result.status, result.output).toBe(2);
    expect(result.output).toContain(STRANDED_MODULE);
    expect(result.output).toMatch(/the walk read \d+ file\(s\)/);
  }, 120_000);

  it('check-singleton-identity finds its allowances used, not stale (§ 4.3)', () => {
    // `WHOLE_FILE_REACHES_ALLOWED`'s entries say the artefact sharing the
    // process is the package's **root** export — the manifest the index
    // imports. With a source-naming index no artefact is in the process,
    // conjunct 1 of the rule is false, the reach is not found, and the entry
    // describing it reads stale. The entries are right about this repository;
    // the fixture was wrong about itself.
    //
    // **Phase 3 is what makes this assertion load-bearing rather than
    // vacuous**, and the two halves are worth keeping apart. Staleness is
    // judged only in the tree that holds the file (`if (!keys.has(file))
    // continue;`), and all four allowances name a file under `backend/test` —
    // which this fixture did not stage until FR-006. So before it, `ledger-size=4`
    // printed over four entries none of which had been looked at, and `sites=0`
    // said so in the run's own words. The `sites` assertion below is that
    // reading, not a decoration: it is issue #237's shape, where a healthy file
    // count stands beside a syntax walk that classified nothing.
    const result = split.run('check-singleton-identity.ts');
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain('violations=0');
    expect(result.output).not.toContain('stale-allowance');
    const sites = / sites=(\d+)/.exec(result.output);
    expect(sites, `no read-size line in: ${result.output}`).not.toBeNull();
    expect(Number(sites?.[1])).toBeGreaterThan(0);
  }, 120_000);
});

describe('the split fixture selects its modules rather than naming them', () => {
  it('relocates every candidate the application tree still holds, in pool order', () => {
    // Reproducibility: the pool is ordered, the filter preserves order, and
    // nothing about the tree it builds varies between runs. The 73 proofs above
    // are worth nothing over a fixture that does.
    expect(PACKAGED_MODULES).toEqual(
      PACKAGED_MODULE_CANDIDATES.filter((id) => PACKAGED_MODULES.includes(id)),
    );
    expect(modulesInTheApplicationTree(PACKAGED_MODULES)).toEqual(PACKAGED_MODULES);
  });

  it('leaves a candidate that has really become a package to the real packages', () => {
    // The edit that used to be required on every move, made unnecessary: the
    // inputs enter above the decision, so the property is provable without
    // building a fixture and without waiting for the next module to move.
    const relocate = planSplitRelocation({
      candidates: ['autopay', 'blog', 'email'],
      available: ['autopay', 'email'],
      alreadyPackaged: ['blog', 'credit_limits', 'google_analytics', 'quote_requests'],
      floor: 6,
    });
    expect(relocate).toEqual(['autopay', 'email']);
  });

  it('refuses a split tree with too few modules outside the application tree', () => {
    expect(() =>
      planSplitRelocation({
        candidates: ['autopay'],
        available: ['autopay'],
        alreadyPackaged: ['blog'],
        floor: 6,
      }),
    ).toThrow(/would hold 2 module\(s\) outside the application tree and needs at least 6/);
  });

  it('counts the real module packages toward that floor, not only the relocated ones', () => {
    // "Outside the application tree" is the property; being relocated by this
    // fixture is one way of getting there and the pool is allowed to drain.
    expect(() =>
      planSplitRelocation({
        candidates: [],
        available: [],
        alreadyPackaged: ['a', 'b', 'c', 'd', 'e', 'f'],
        floor: 6,
      }),
    ).not.toThrow();
  });

  it('holds the real pool above that floor today', () => {
    const outside = new Set([...PACKAGED_MODULES, ...packagedModuleIds()]);
    expect(outside.size).toBeGreaterThanOrEqual(MINIMUM_MODULES_OUTSIDE_THE_APPLICATION_TREE);
  });

  it('strands a module that really declares an error code', () => {
    // The constraint that made `comparisons` the choice, enforced for every
    // successor rather than remembered for the incumbent.
    const routed = routedModuleIds();
    for (const candidate of STRANDED_MODULE_CANDIDATES) {
      expect(routed, `${candidate} declares no error code`).toContain(candidate);
    }
    expect(routed).toContain(STRANDED_MODULE);
  });

  it('keeps the two pools disjoint, so the passing tree is unaffected', () => {
    for (const candidate of STRANDED_MODULE_CANDIDATES) {
      expect(PACKAGED_MODULE_CANDIDATES).not.toContain(candidate);
    }
  });
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
