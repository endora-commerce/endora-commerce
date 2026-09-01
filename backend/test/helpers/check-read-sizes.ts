/**
 * What every static check reads, recorded — and the band that ratchets it
 * (issue #244).
 *
 * ## Why a number per check
 *
 * Seven times a check has reported `violations=0` because it was not looking:
 * a walk that came back short (#215), a population definition that excluded a
 * live entry point (#228), a file that hid a site (#235, #237), a spread that
 * bypassed excess-property checking (#238), an input transform that ate 41% of
 * the file (#241), and a population defined by the presence of the very thing
 * being checked (#244). Each was repaired where it was found. The common cause
 * was never repaired: **a check's output said what it found and never said what
 * it read**, so "found nothing" and "read nothing" printed the same green.
 *
 * Every check now prints a read line — `scripts/lib/read-size.ts` for the
 * twenty-four tsx ones, `scripts/lib/read-size.sh` for the three shell ones —
 * and this file is what makes that number *bite*: it records what each check
 * reads on the current tree, and `test/unit/scripts/check-read-size.test.ts`
 * spawns each check and compares.
 *
 * ## The band, and why it is not exact
 *
 * A tree gains and loses files constantly, so an exact-match ratchet is noise
 * and a symmetric ±50% catches nothing. The band is therefore **asymmetric**,
 * because its two edges answer different questions:
 *
 *   * **Lower edge, −10%.** This is the defect direction and the one that
 *     matters. Measured against what the family actually does: moving
 *     `src/modules` out removes 93% of the files a module walk reads; a glob
 *     that stops matching a subtree removes tens of percent. Downward drift
 *     from ordinary work is far smaller — over the last 60 days of `master` the
 *     backend source count never fell, and deleting a whole module (~20 files)
 *     is 1.4% of a 1459-file walk. −10% therefore sits well above the noise and
 *     well below every shape in the family. Per-module loss, which is finer
 *     than any percentage, is caught by the `sources=` reconciliation instead.
 *   * **Upper edge, +50%.** This edge catches nothing defective; it exists so a
 *     recorded number cannot quietly become decorative. It has to clear
 *     ordinary growth, and growth here is fast: `backend/src/**.ts` went
 *     1348 → 1483 in the week this was written (+10%), and 1021 → 1483 in the
 *     month (+45%), because feature 072 is converting 65 modules. A tighter
 *     ceiling would fail weekly on correct MRs and be raised without being
 *     read, which is how a ratchet dies. +50% asks for a re-record roughly
 *     every five weeks at that rate, in the MR that grew the tree.
 *
 * Small populations get {@link READ_SIZE_SLACK} absolute units instead of a
 * percentage: six generated artefacts and seven citing documents cannot move by
 * 10% of themselves, and a band that rounds to zero would fail on the seventh
 * artefact arriving.
 *
 * **Never widen the band to make a run pass.** Re-record the number, in the
 * merge request that changed the population, and say what changed it.
 */

/** The multiplier a run may fall to before the recorded number is a lie. */
export const READ_SIZE_LOWER = 0.9;

/** The multiplier a run may rise to before the recorded number is stale. */
export const READ_SIZE_UPPER = 1.5;

/** Absolute units of slack, for populations too small for a percentage. */
export const READ_SIZE_SLACK = 2;

/** The inclusive range a recorded number accepts. */
export function readSizeBounds(recorded: number): { readonly min: number; readonly max: number } {
  return {
    min: Math.max(0, Math.min(Math.floor(recorded * READ_SIZE_LOWER), recorded - READ_SIZE_SLACK)),
    max: Math.max(Math.ceil(recorded * READ_SIZE_UPPER), recorded + READ_SIZE_SLACK),
  };
}

/** How the ratchet runs a check — the invocation `.gitlab-ci.yml` uses. */
export interface CheckInvocation {
  /** `tsx` runs it from `backend/`; `bash` runs it from the repository root. */
  readonly kind: 'tsx' | 'bash';
  /** Path relative to the root named by {@link CheckInvocation.kind}. */
  readonly path: string;
  readonly args: readonly string[];
}

export interface RecordedReadSize {
  /** The prefix the check prints, brackets included. */
  readonly prefix: string;
  readonly run: CheckInvocation;
  /** Files opened on the current tree. */
  readonly files: number;
  /** Sites examined inside them, or `null` where the file is the unit. */
  readonly sites: number | null;
  /**
   * The independent derivations the check reconciles against, by name. Empty
   * means the read size rests on the check's own answer — which is a statement,
   * and {@link READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE} carries the reason.
   */
  readonly sources: readonly string[];
}

/**
 * There is deliberately no `volatilePopulation` escape hatch here.
 *
 * One existed, for exactly one check. `check-nul-bytes` walks the whole
 * repository, and a working tree that had built the docs site or served an
 * upload read 8288 files where a clean checkout read 5163 — so its ceiling was
 * suppressed with that reason attached, and the record said the count
 * "legitimately grows with whatever the working tree holds". It did not: the
 * trees producing the gap were `docs/.docusaurus` and `backend/var/assets`,
 * both named in `.gitignore`, neither declared in `SKIPPED_DIRECTORIES`. Issue
 * #248 declared them, the two trees now agree to the file, and the ceiling is
 * back.
 *
 * The field is gone with it rather than left dormant, because a suppression
 * nobody uses is a way to make a ceiling disappear without measuring anything,
 * and the whole of this file's rule is the sentence above: never widen the band
 * to make a run pass. If a population turns up that genuinely moves, the field
 * comes back in the merge request that measured it.
 */

/**
 * Recorded on 2026-08-22, from a run of each check over this branch.
 *
 * Re-recorded, not widened. This merge request changes what *every* module walk
 * reads — from one spelled root to the list `scripts/lib/module-roots.ts`
 * derives (feature 080, T040a) — so the numbers below are the measurement that
 * says the change moved nothing on a tree with one root: all sixteen
 * module-walk checks print the byte-identical line they printed before it. The
 * differences from the 2026-08-19 record are ordinary growth (`src` went
 * 1459 → 1541 in three days, feature 072's conversion still landing) plus the
 * three files this branch adds, and every one of them was inside the band when
 * it was taken.
 *
 * The keys are the script paths the inventory uses, so
 * `check-inventory.test.ts` can sweep both directions: a check with no record
 * fails there, and a record naming no check fails too.
 */
export const RECORDED_READ_SIZES: Readonly<Record<string, RecordedReadSize>> = {
  'backend/scripts/check-action-route-permissions.ts': {
    prefix: '[action-route-permissions]',
    run: { kind: 'tsx', path: 'scripts/check-action-route-permissions.ts', args: [] },
    files: 1536,
    sites: 54,
    // `emitted-manifests` is this check saying which artefact its manifest half
    // came from: the manifests are imported rather than walked, and a packaged
    // module's resolves at its build output. It is the disclosure half of the
    // staleness refusal; see `scripts/lib/emitted-freshness.ts`.
    sources: ['manifest-index', 'emitted-manifests'],
  },
  'backend/scripts/check-channel-resolution.ts': {
    prefix: '[channel-resolution]',
    run: { kind: 'tsx', path: 'scripts/check-channel-resolution.ts', args: ['--enforce'] },
    files: 1541,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-command-coverage.ts': {
    prefix: '[command-coverage]',
    run: { kind: 'tsx', path: 'scripts/check-command-coverage.ts', args: ['--strict'] },
    files: 1267,
    sites: null,
    // 64, not 65: this check excludes modules by argument, and the expectation
    // is derived after the exclusion rather than despite it.
    sources: ['manifest-index'],
  },
  'backend/scripts/check-container-imports.ts': {
    prefix: '[container-imports]',
    run: { kind: 'tsx', path: 'scripts/check-container-imports.ts', args: [] },
    files: 1444,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-diacritic-folds.ts': {
    prefix: '[diacritic-folds]',
    run: { kind: 'tsx', path: 'scripts/check-diacritic-folds.ts', args: [] },
    files: 4088,
    // It had none until issue #244, on the stated ground that "the unit is the
    // fold, and a file without one is exactly what #244 is about". True of the
    // two fold signals and no longer the whole check: the `slug-run` signal
    // judges every `.replace()` whose pattern it can read, cleared ones
    // included, so there is now a population here that does not move with the
    // findings.
    sites: 330,
    sources: [],
  },
  'backend/scripts/check-doc-snippets.ts': {
    prefix: '[doc-snippets]',
    run: { kind: 'tsx', path: 'scripts/check-doc-snippets.ts', args: [] },
    files: 943,
    sites: 8,
    sources: [],
  },
  'backend/scripts/check-entity-tenant-classification.ts': {
    prefix: '[tenant-classification]',
    run: { kind: 'tsx', path: 'scripts/check-entity-tenant-classification.ts', args: [] },
    files: 1541,
    sites: 225,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-presence.ts': {
    prefix: '[entry-presence]',
    run: { kind: 'tsx', path: 'scripts/check-entry-presence.ts', args: [] },
    files: 1541,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-scope.ts': {
    prefix: '[entry-scope]',
    run: { kind: 'tsx', path: 'scripts/check-entry-scope.ts', args: [] },
    files: 1620,
    // Re-recorded twice, both downward and both deliberately.
    //
    // 47 → 41, by feature 080's T042b: seven module CLI scripts became
    // manifest-declared commands the host runs (D-160.9), so their files left
    // `scripts/` — they no longer start a process and are no longer entry
    // points — and one new declared program, `src/cli.ts`, replaced them.
    // `package-scripts` fell 18 → 12 for the same reason: seven
    // `backend/package.json` programs now name one path instead of seven.
    //
    // 41 → 40, by D-167: `quote_requests/scripts/backfill-quote-channel.ts` is
    // deleted. It was the tree's last `scripts/` file that was not also a
    // declared program, so `cli` falls 8 → 7 and nothing else moves — the
    // ledger is untouched, because that file established its scope.
    //
    // 40 → 38, by feature 080's T053(d): `settings`' two `modules:install` /
    // `modules:uninstall` deprecation shims are deleted. They declared
    // themselves DEPRECATED, `spawn`ed `_lifecycle`'s singular scripts and
    // forwarded argv, so D-160.9's conversion does not apply — that converts a
    // module's **own** command, and a shim over a platform command must not
    // compose. `cli` falls 7 → 5, `package-scripts` 12 → 10, and their two
    // `NO_SCOPE_NEEDED` entries went with them (the ledger's stale direction
    // reported both before they were removed, which is that ratchet working).
    //
    // 38 → 37, by D-174: `admin_actions` no longer subscribes to the module
    // state-changed Redis channel, so its `on('message')` handler is gone —
    // `message` falls 3 → 2 and its `NO_SCOPE_NEEDED` entry with it. The
    // invalidation did not move to a second handler: the platform's existing
    // subscriber drives the in-process cache registry, and that handler was
    // already a site.
    //
    // A downward move is the direction this band exists to refuse, so each
    // number is moved in the merge request that shrank the population and
    // nowhere else.
    sites: 37,
    sources: ['manifest-index', 'package-scripts'],
  },
  'backend/scripts/check-error-translations.ts': {
    prefix: '[error-translations]',
    run: { kind: 'tsx', path: 'scripts/check-error-translations.ts', args: [] },
    // The bundles the walk opens, and the predicates' units together: the
    // declared codes P1 and P3 judge plus the written `errors.*` keys P2 walks.
    //
    // **Not re-recorded by feature 090's Phase 4**, which is the measurement
    // worth keeping: deleting the prefix chain moved neither number. The check
    // read 289 routed codes before and reads 289 declared codes after, because
    // the migration was answer-preserving over the whole enumeration — so the
    // band that was recorded against the chain is the band the derivation meets.
    files: 90,
    sites: 763,
    // Feature 080's T010, and feature 090's Phase 4 for the second entry.
    // `manifest-index` expects the module directories that declare a code:
    // every id the generated index registers, less the ones whose manifest
    // declares none, reconciled against the directories the walk opened a
    // bundle in. **Both halves of that move, and neither is written down here**
    // — the registered set grows with each module, and the declaring set is
    // what D-129's sweep spent eight merge requests changing. This comment
    // carried the answer instead ("18 of the registered 66"), which was already
    // wrong when Phase 4 deleted `ERROR_TRANSLATION_KEYS`, stayed wrong through
    // seven batches of the sweep, and was flagged in three of them: a
    // hand-written copy of a figure three checks re-derive (D-100), surviving
    // only because the band is ±50%. The run prints the current pair.
    //
    // `error-codes` is the second, independent derivation: the
    // platform's published enumeration in `@endora-commerce/contracts`, against
    // the manifests, which is P3's population. Neither is the filesystem walk
    // being reconciled, and an enumerated code nobody declares is a *finding*
    // that names the code rather than a short walk.
    sources: ['manifest-index', 'error-codes'],
  },
  'backend/scripts/check-fixture-substitution.ts': {
    prefix: '[fixture-substitution]',
    run: { kind: 'tsx', path: 'scripts/check-fixture-substitution.ts', args: [] },
    // Re-recorded for issue #275, which widened the read detection to
    // destructuring bindings and `getKnex()` builder chains. Measured rather
    // than inferred: on this tree the unwidened check read 427 and the widened
    // one 443, so **17 files** are ones it had been opening and reporting clean
    // because it recognised no read in them (one net, after the two repaired
    // sites stopped reading at all). The other 22 of the 405 → 443 move is the
    // tree growing since 2026-08-19, which `files` shows at 1237 → 1302. Both
    // numbers were inside the band; this is the MR that changed the population,
    // so this is where they get re-recorded.
    files: 1375,
    sites: 465,
    sources: [],
  },
  'backend/scripts/check-harness-teardown.ts': {
    prefix: '[harness-teardown]',
    run: { kind: 'tsx', path: 'scripts/check-harness-teardown.ts', args: [] },
    files: 1375,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-kernel-boundary.ts': {
    prefix: '[kernel-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-kernel-boundary.ts', args: [] },
    files: 1541,
    sites: 31,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-lock-claims.ts': {
    prefix: '[lock-claims]',
    run: { kind: 'tsx', path: 'scripts/check-lock-claims.ts', args: [] },
    // Re-recorded for issue #279, which added `packages/contracts/src` to the
    // population: 113 → 192 files and 6 → 9 named-subject claims on the tree
    // the widening landed against. The second source is the contracts barrel,
    // `index.ts`, which is what the package says it publishes — the same
    // derived floor the manifest index provides for the module half.
    files: 183,
    sites: 10,
    sources: ['manifest-index', 'contracts-barrel'],
  },
  'backend/scripts/check-admin-registrations.ts': {
    prefix: '[admin-registrations]',
    run: { kind: 'tsx', path: 'scripts/check-admin-registrations.ts', args: [] },
    // Two, and it is the honest number rather than a rounding of one: this
    // check's subject is exactly the admin's two hand-written registries.
    // `sites` is what moves — 122 routes plus 85 nav entries today, shrinking
    // with every Story 3 batch, and **re-recorded downwards by the batch that
    // shrinks it**. The band's floor is what refuses a walk that came back
    // short, so leaving a number the drain has outgrown widens that floor's
    // distance from the truth batch by batch until it stops refusing anything.
    // Six batches took it from 249 to 217, `pwa` moving it by one because that
    // batch was one nav entry; the plan's own batch 6 — `webhooks`,
    // `comparisons`, `api_keys`, four routes and six nav entries — took it
    // to 207, and batch 7 — `promotions`, `payment_methods`,
    // `customer_accounts`, `product_feeds`, seventeen routes and eight nav
    // entries — takes it to 182. Batch 8 — `seo`, `taxes`, `credit_limits`,
    // `delivery_methods`, `megamenu`, `returns`, eleven routes and eight nav
    // entries — took it to 163, which is this band's floor to the unit and was
    // not re-recorded; batch 9 — `assets_library` and `custom_fields`, two
    // routes and two nav entries — takes it to 159, and both are recorded here.
    //
    // **Batch 10 — `dictionaries`, `settings` and `credentials`, nine routes
    // and ten nav entries — takes it to 140**, which is that nineteen exactly.
    // Ten rather than six nav entries because `adminNavEntries` counts a
    // `PALETTE_ITEMS` row beside a sidebar one: the four Navigate rows those
    // three modules carried are manifest actions now. Measured on the merge
    // commit rather than on the branch, which is the thing batch 9 and Phase 1b
    // both got wrong on the sibling entry below — see its own note.
    files: 2,
    sites: 140,
    // `AppShell.tsx` writes the `module` strings and the generated index is
    // rendered from the manifests, so the reconciliation has two authors.
    sources: ['manifest-index'],
  },
  'backend/scripts/check-admin-zones.ts': {
    prefix: '[admin-zones]',
    run: { kind: 'tsx', path: 'scripts/check-admin-zones.ts', args: [] },
    // Every module's sources, the admin application's own and the kit's — a
    // zone may be rendered by a module screen, by an installed package's screen
    // or by the admin itself, so all three are the host population. `sites` is
    // renders plus contributions plus foreign module ids: 7 renders (the three
    // `product.editor.*` mounts, `field.after` five times) and 9 foreign ids
    // when P4a landed, with contributions at zero because P4a is the mechanism
    // and drains nothing. It moves in both directions as the batches run — the
    // zone members grow with the places they mount, the ledger empties — and
    // the batch that moves it re-records it here. It has already moved once:
    // 18 -> 16 when !1230's kit-namespace repair merged in, taking two of the
    // three `kit-namespace` sites with it. **16 -> 15 with batch 10**, whose
    // one `module-namespace` entry — `settings`' preview button naming
    // `credentials` for a label — was repaired at the source rather than
    // relocated; `files` rises 2165 -> 2187, which is that batch moving nine
    // files under a module walk root plus the tree's own growth since the
    // number was last written down.
    files: 2187,
    sites: 15,
    // `zone-enum` is `AdminZoneNameSchema` held against `AdminZonePropsMap`:
    // the enum is the independent author of this check's population and the map
    // is the second declaration reconciled against it, so a member added
    // without a props type moves the expectation in the same run.
    // `manifest-index` is issue #215's shared floor over the module walk.
    sources: ['zone-enum', 'manifest-index'],
  },
  'backend/scripts/check-bundle-pairing.ts': {
    prefix: '[bundle-pairing]',
    run: { kind: 'tsx', path: 'scripts/check-bundle-pairing.ts', args: [] },
    // Bundle files opened, and the number is the population's whole shape: 62
    // of the 69 registered modules ship a bundle, each in both shipped
    // languages, so `files` is 62 × 2 and moves by two whenever a module gains
    // or loses its strings. It is deliberately *not* the modules read — that is
    // `sites`, and the two answer different questions here: a module dropping
    // one bundle moves `files` and leaves `sites` where it was, which is exactly
    // the defect this check refuses.
    files: 124,
    // Every registered module, shipping or not. It moves only with the module
    // set, so a run whose `sites` fell while `files` held is a module that left
    // the index rather than a translation that left a package.
    sites: 69,
    // `manifest-index` is issue #215's shared floor over the module walk, whose
    // unit here is the module's **own directory** — `dirname(manifestPath)`, the
    // anchor the boot reconciler joins `bundlesDir` to. `shipped-languages` is
    // `SUPPORTED_LANGUAGES` against the languages the walk actually probed for:
    // it is 0 when no module shipped anything, which with a conditional
    // predicate is the vacuously-clean state, and it stays at the full count
    // when every module drops a language — that is a run of findings, not a run
    // that read nothing.
    sources: ['manifest-index', 'shipped-languages'],
  },
  'backend/scripts/check-admin-surface.ts': {
    prefix: '[admin-surface]',
    run: { kind: 'tsx', path: 'scripts/check-admin-surface.ts', args: [] },
    // The module-attributed admin surface directories — 308 files over 50
    // modules when Phase 1b landed — and every `from '…'` inside them, which is
    // the finer population the per-symbol verdict runs on. Both grow as Story 3
    // moves directories into packages: a packaged module's `src/admin` is in the
    // same walk, so the file count follows the surface rather than the tree.
    //
    // **`sites` falls for as long as Story 3 runs, and this is the accounting
    // for the fall — as of `8fb2b3929`, the merge that put batch 9 on
    // `master`.** The epoch is part of the claim rather than decoration: the
    // next drain batch moves both numbers again and re-records them under its
    // own name, and an accounting with no commit behind it cannot be
    // re-derived by the reader who has to check it.
    //
    // The mechanism is a **collapse, not a loss of sight**. A screen that took
    // eight `@/components/ui/*` imports takes one from
    // `@endora-commerce/admin-kit/ui`, so packaging a directory removes
    // reaches while the walk keeps every file — which is why `files` rose from
    // 308 to 352 across the same period the site count fell. Phase 1b's own
    // commit measures `files=308 sites=2831`. Replaying the walk over each
    // commit's blobs from there to `8fb2b3929`: **19 of the 138 first-parent
    // commits moved either number, the other 119 moved neither**, and every
    // unit of the −317 belongs to one of the 19 —
    //
    //   admin registry + first conversion −2 · permission labels +4 ·
    //   quote re-dating +1 · phase-4 batches one/two/three −9 −4 −16 ·
    //   batch 4 −35 · batch 5 −54 · P2 pickers −1 · batch 6 +1 ·
    //   webhooks/comparisons/api_keys −28 · `089-pimcore-pim-sync` +55 ·
    //   batch 7 −109 · P4c assets −10 · P4e custom-field values −8 ·
    //   P4a zones +1 · batch 8 −86 · P6 client exits −3 · batch 9 −14.
    //
    // Batch 8 is where the floor went — it took the count to 2531 against the
    // 2543 a record of 2826 demanded, and did not re-record — but it is 86 of
    // 317, so "batch 8 collapsed five screens" is a quarter of the answer.
    // Batches 4 through 9 are −325 between them, and one merge that is not a
    // drain at all puts 55 back: `089-pimcore-pim-sync` is a module arriving
    // with an admin surface, which is this population growing. **P3's session
    // cluster moved this number by zero** — its consumers are host files,
    // outside this walk — so publishing to the kit is not by itself a fall.
    //
    // Read by class instead of by merge, over the 298 files present in both
    // trees: 742 `@/…` reaches became 303 kit reaches (`@/components/ui/*`
    // −459 against `admin-kit/ui` +77 is the bulk of it), 51 files joined the
    // walk (+167) and 7 left it (−29). Nothing is unattributed. The one
    // quantity that is **not** a tree change is the 5 between the 2826
    // recorded at Phase 1b and the 2831 its own commit measures — that record
    // was the tree three first-parent commits earlier — and batch 9 repeated
    // it in the other direction, recording 2517 from its base before it merged
    // P6's −3, where `master` prints 2514. Both are inside the band and
    // neither is a defect of the check; they are what taking the number off a
    // branch costs, in a population every admin merge request perturbs. The
    // number below is read off the merge commit.
    //
    // **What the band can and cannot say here.** 1029 of the 2514 reaches are
    // still `@/…`, in the 20 directories Story 3 has not moved, and a drained
    // alias reach has historically cost the total 0.42 sites — so about 430
    // more will go, and at a −10% floor this entry needs re-recording every
    // two or three batches until the drain ends. That recurrence is the
    // ratchet working rather than a defect in it: the band is the only thing
    // that makes a fall get explained at all, and widening it would delete the
    // signal exactly while the population moves fastest. The different
    // question — did the walk stop *looking* — is answered by the `sources=`
    // line beside it, complete at every measurement above.
    //
    // **Batch 10 — `dictionaries`, `settings` and `credentials` — takes it to
    // 2448, and `files` to 353.** That is −66 against the 2514 above, from 28
    // files moved out of three admin directories. The accounting above puts the
    // historical cost of a drained alias reach at 0.42 sites, and those three
    // directories held 139 of them, which predicts −58; the 8 it overshoots by
    // is the same collapse one notch further, in two places a reach count does
    // not predict. Three of the 28 files went to `@endora-commerce/mod-pwa`
    // rather than to the module whose directory they sat in, and two private
    // helpers — a ninth copy of `toAbsoluteAssetUrl` and a tenth
    // `import.meta.env` read — became kit imports the walk had not been
    // counting as alias reaches at all. `files` rises by one rather than
    // falling because `credentials` grows a **second** UI directory:
    // `src/admin-ui/` is D-191's published-component subpath, two files where
    // the admin held one.
    //
    // **Measured on the merge commit**, which the two records above this one
    // were not — Phase 1b's by five and batch 9's by three, both inside the
    // band and therefore silent. The instruction that produces the right number
    // is in the accounting above and is worth repeating as an instruction:
    // merge `origin/master` first, then read the line.
    //
    // **P8 takes it to 2436, and `files` stays at 353.** It is not a drain
    // batch — no directory moved, and every one of the four old paths is still
    // there as a shim — so the −12 is the **collapse** this entry keeps
    // describing, arriving without the move. A site is one `from '…'`, so it
    // accounts exactly and every unit is one of two kinds. Seven come off the
    // four published files: `ScopePicker` had nine specifiers and its shim has
    // two (−7), `ContentLanguageTabs` three and two (−1), `email-outcome` one
    // and two (+1), `Section` two either way (0). The other five come off the
    // five editors — `cms`' three and `blog`'s two — which each took
    // `ContentLanguageTabs` and `ScopePicker` from two sibling paths and now
    // take both from one kit subpath. The other six consumers are a wash: one
    // specifier before and one after. Nothing left the walk unwatched, which
    // the `sources=` line beside it says independently.
    files: 353,
    sites: 2436,
    // Two derivations, neither the walk counting itself: the generated manifest
    // index for the modules a surface directory is attributed to, and the kit's
    // own `exports` map against the barrels on disk — a subpath declared and not
    // built, or built and not declared, is what makes a reach unjudgeable.
    sources: ['manifest-index', 'admin-kit-exports'],
  },
  'backend/scripts/check-module-boundary.ts': {
    prefix: '[module-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-module-boundary.ts', args: [] },
    // 3529 -> 3699 with feature 091's P1: `admin/src` outside the module root
    // joins the walk as a **source** population, and it is 100 `.ts`/`.tsx`
    // files. Re-recorded in the merge request that grew the tree, which is the
    // rule; the remaining 70 are the module tree's own growth since the number
    // was last written down.
    files: 3699,
    sites: null,
    // `module-packages` joined when a bare specifier became able to reach a
    // module (feature 080): the names the walk read off each module package's
    // manifest, reconciled against the package roots the layout found by
    // walking directories. It is printed only while there is at least one such
    // package — `expected=0` is a refusal in this grammar, and no module package
    // was the whole tree until !910.
    //
    // `admin-surfaces` joined with feature 091's FR-017, and it moved `files`
    // by the 327 `.ts`/`.tsx` files under the admin module root: the check's
    // population is now module-owned admin code as well, recorded before any
    // admin directory moves into its module's package. Its expectation is the
    // surface directories the route table and the nav attribute to a module —
    // an independent derivation, and not the walk counting itself.
    // `admin-host` joined with P1 and was the host population's short-walk
    // floor. **That day came** (feature 091, P6): `IdleLogout.tsx` was the last
    // host reach, it took the client exit, `host.ts` was deleted, and the token
    // went with it — printed only while there is host debt, because
    // `expected=0` is a refusal in this grammar. Its own entry said that
    // staleness is the two-way property rather than a defect, so the entry is
    // removed here in the merge request that drained it rather than left for
    // the next one to find.
    sources: ['manifest-index', 'module-packages', 'admin-surfaces'],
  },
  'backend/scripts/check-nul-bytes.ts': {
    prefix: '[nul-bytes]',
    run: { kind: 'tsx', path: 'scripts/check-nul-bytes.ts', args: [] },
    // Both bounds are asserted again (issue #248). The number now agrees
    // between a clean checkout and a tree that had built the docs site and
    // served uploads — 8288 against 5163 before, 5165 against 5165 after —
    // because the two generated trees that made them differ, `.docusaurus` and
    // `backend/var/assets`, are declared exclusions. Re-recorded here on this
    // branch, which is the tree the exclusions were measured on.
    files: 5470,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-overlay-determinism.ts': {
    prefix: '[overlay:check]',
    run: { kind: 'tsx', path: 'scripts/check-overlay-determinism.ts', args: [] },
    files: 6,
    // Every import specifier in the six rendered artefacts, which is the
    // population the `foreign` verdict answers over (feature 080, T030a):
    // 133 + 67 + 225 + 159 in the four generated files, one in each override
    // manifest. Recorded 2026-08-21.
    //
    // **586 → 527 (T040b batch two), and it is a *downward* re-record, which is
    // only legitimate when every unit of the fall is an import that stopped
    // existing.** It is. The entities registry names one class per entity for a
    // module in the application tree and one `entities` **array** per package
    // (D-168), so a package with `n` entities removes `n - 1` import lines:
    // batch two's fourteen own 53 entities across the thirteen that own any, for
    // exactly −40, measured against the merge base per artefact (the other three
    // artefacts moved by 0). The remaining 19 were already gone — batch one's own
    // collapse, which landed inside the −10% floor and re-recorded nothing, which
    // is the slack-absorption the `check-release-intent` entry below warns about
    // in the other direction.
    //
    // **527 → 471 (T040b batch five)**, and the same rule applies: every unit of
    // the fall is an import that stopped existing. This batch's six modules own
    // 18 entities between them (`admin_actions` 1, `admin_roles` 1,
    // `admin_users` 1, `megamenu` 3, `organizations` 8, `price_lists` 4), and a
    // package contributes one `entities` array import in place of one class
    // import per entity — exactly −12, measured per artefact against the merge
    // base, with the other three generated files and the three override
    // manifests moving by 0. The other 44 of the 56 were already gone: batches
    // three and four's own collapse, which landed inside the −10% floor and
    // re-recorded nothing. Re-recorded 2026-08-26.
    sites: 471,
    sources: [],
  },
  'backend/scripts/check-port-catches.ts': {
    prefix: '[port-catches]',
    run: { kind: 'tsx', path: 'scripts/check-port-catches.ts', args: [] },
    files: 1541,
    sites: 139,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-port-dependencies.ts': {
    prefix: '[port-deps]',
    run: { kind: 'tsx', path: 'scripts/check-port-dependencies.ts', args: [] },
    files: 1422,
    sites: 1278,
    sources: ['manifest-index'],
  },
  // Two derivations, deliberately, because the check has two inputs that can be
  // silently missing and they have different authors: `manifest-index` is the
  // generated composer artefact (issue #215's floor over the module walk), and
  // `platform-barrels` reconciles D-160.7's five published subpaths against what
  // the tree actually holds. A barrel that vanished would make the published
  // surface short, which turns correct reaches into findings rather than hiding
  // them — so it is exit 2 in the check itself, and the 5/5 here is what makes a
  // *quietly narrowed* surface visible in the recorded line.
  // `sites` is every (specifier, symbol) reach into the platform the walk
  // judged, cleared ones included, so it does not move with the findings.
  'backend/scripts/check-platform-surface.ts': {
    prefix: '[platform-surface]',
    run: { kind: 'tsx', path: 'scripts/check-platform-surface.ts', args: [] },
    files: 1435,
    // **Re-recorded upward, and this is the move that ends the re-recording**
    // (feature 080, T060).
    //
    // The number fell twice for the same reason and neither fall was a defect
    // in the tree: 1642 → 1588 at module #4, then 1588 → 1414 by the first batch
    // of ten. A module in a package writes `@endora-commerce/platform/kernel`,
    // and this check's population was **relative** specifiers only — so its
    // platform reaches left the walk as the module left the tree, and 216 of
    // them (the ten of batch one's 104, plus the 112 of modules #1–#5) were
    // judged by nothing while the check printed a clean line over the
    // remainder. Worse than the loss was its shape: module #5's fall landed
    // inside the −10% floor, so nothing re-recorded it and `master` read 1518
    // against a recorded 1588 for two batches. A monotone decline and a band
    // that absorbs one module of it is a ratchet that stops ratcheting exactly
    // while the layout is moving.
    //
    // T060 puts the bare specifier in the population: `<host>/<subpath>`
    // resolves to the same barrel the relative specifier resolves to, so a
    // module's platform reaches are **the same number in both layouts**. 1415 →
    // 1631 on the run that landed it, +216 counted independently with the
    // check's own specifier reader (`quote_requests` 36, `blog` 24,
    // `promotions` 24, `audit_logs` 22, `payment_methods` 17, `credit_limits`
    // 15, `shipments` 15, `seo` 14, `google_analytics` 13, `languages` 10,
    // `addresses` 7, `currencies` 7, `import_export` 6, `analytics` 5,
    // `health_checks` 1), and no finding and no ledger key moved with it.
    //
    // So the next batch of module moves must leave this number **where it is**,
    // which is what makes it a record worth holding: it is no longer a function
    // of where the modules live. And the number is no longer what guards the
    // population either — `host-dependents` below is, per package and derived on
    // every run, so a walk that stopped reading those specifiers is exit 2
    // rather than a band nobody re-recorded.
    sites: 1631,
    // The third source is T060's floor: every module package whose manifest
    // declares the host package must have contributed a host reach to this walk.
    // The manifest is rendered from the bare specifiers the package's sources
    // import (`manifests:generate`), so the two derivations are independent and
    // a walk that stopped reading those specifiers makes them disagree in the
    // same run. It appears only while a module package declares the host, which
    // is every tree since !910 — `expected: 0` is itself a refusal.
    sources: ['manifest-index', 'platform-barrels', 'host-dependents'],
  },
  // Re-recorded by D-171.1, which widened the published-port population from
  // `packages/contracts/src` alone to include a module package's declared
  // `./ports` subpath. Both numbers move for the same reason and neither is
  // slack absorbed: `files` gains the ports sources themselves, `sites` gains
  // the ports they declare. `ports-subpaths` is the second source that arrived
  // with it — a package's `exports` map declares `./ports` because the
  // generator saw the file, so a walk that stopped finding them disagrees with
  // the manifests in the same run. It grows with every module package that
  // publishes a port, which is a legitimate re-record and not a band to widen.
  'backend/scripts/check-port-shape.ts': {
    prefix: '[port-shape]',
    run: { kind: 'tsx', path: 'scripts/check-port-shape.ts', args: [] },
    files: 1600,
    sites: 615,
    sources: ['manifest-index', 'ports-subpaths'],
  },
  // Small on purpose: this population is the *workspace*, not a source tree —
  // `.changeset/config.json`, `pnpm-workspace.yaml`, one manifest per member
  // (11) and the pending changesets (21). Two moves are foreseeable and both are
  // legitimate re-records rather than defects, stated here so that whoever
  // meets one is not deciding under pressure whether to widen the band:
  //
  //   * **The first release.** `pnpm run version:packages` consumes every
  //     pending changeset, so `files` drops 34 → 13 and `sites` 39 → 18, well
  //     under the floor. The population genuinely changed; re-record it in the
  //     release merge request.
  //   * **66 module packages.** One manifest each takes it past the ceiling in
  //     one merge request. Same answer.
  //
  // Never widen the band: the floor is what catches a `packages/` tree that
  // moved, which is the only way this check can silently read a residue.
  //
  // **Re-record every time a changeset lands — the slack is not a budget.**
  // This entry stood at 22 while the tree read 33, which is the ceiling exactly:
  // `READ_SIZE_SLACK` had absorbed eleven changesets one at a time, and the
  // twelfth had nowhere to go. The next author to write a changeset met a red
  // read-size test with nothing wrong in their diff, which is the failure this
  // ratchet is supposed to prevent rather than produce. The number below is the
  // tree, measured, and a merge request adding a changeset moves it by one.
  'backend/scripts/check-release-intent.ts': {
    prefix: '[release-intent]',
    run: { kind: 'tsx', path: 'scripts/check-release-intent.ts', args: [] },
    // Re-recorded twice in one day, and the two moves are different kinds.
    //
    // **34 → 17 (!966): the population changed, not the tree.** Both numbers
    // used to fold in `.changeset/*.md`, whose count follows the release cycle
    // rather than the repository — at 30 pending changesets `files` sat exactly
    // on this band's +50% ceiling, so the next merge request to add one failed,
    // and a release consuming all thirty would have dropped it under the −10%
    // floor in the same week. A band cannot bound a quantity that oscillates in
    // both directions, so the changesets are read, judged, and reported as
    // `changesets=` beside these numbers instead of inside them.
    //
    // **17 → 27 (T040b batch one): the tree grew.** The
    // population is `2 + members`, and ten module packages are ten new members.
    // This is the ordinary re-record — the remaining ~51 moves will move it
    // again, and the answer stays "re-record", never "widen".
    //
    // **27 → 41 (T040b batch two)**: the same ordinary re-record, fourteen more
    // members. `sites` moved 34 → 48 and stayed inside its band, so it is left
    // where it is rather than tracked per batch.
    //
    // **41 → 55 and 34 → 62 (T040b batch three)**: fourteen more members again,
    // and this time `sites` left its band rather than drifting inside it — the
    // finer population is the *patterns and members* the ignore list is matched
    // over, so it grows faster than `files` does. Both are re-recorded from the
    // run rather than the ceiling being raised: the previous batch's decision to
    // let `sites` ride is what put it 22 % outside on the next one, so it is
    // tracked per batch from here.
    files: 55,
    sites: 62,
    sources: ['workspace-globs'],
  },
  'backend/scripts/check-shared-table-wipes.ts': {
    prefix: '[shared-table-wipes]',
    run: { kind: 'tsx', path: 'scripts/check-shared-table-wipes.ts', args: [] },
    files: 1375,
    sites: 149,
    sources: [],
  },
  'backend/scripts/check-subscribe-seam.ts': {
    prefix: '[subscribe-seam]',
    run: { kind: 'tsx', path: 'scripts/check-subscribe-seam.ts', args: [] },
    files: 1541,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-transaction-context.ts': {
    prefix: '[transaction-context]',
    run: { kind: 'tsx', path: 'scripts/check-transaction-context.ts', args: [] },
    files: 1541,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-singleton-identity.ts': {
    prefix: '[singleton-identity]',
    run: { kind: 'tsx', path: 'scripts/check-singleton-identity.ts', args: [] },
    // The consumer population, not the module one: every file under the
    // application member (`src`, `test` and `scripts` alike), the platform's
    // sources and every module package's. The test tree is in it because that is
    // where 176 of the 181 files holding a reach live, and leaving it out would
    // have made the check blind to both defects it exists for.
    files: 3227,
    // Reaches into a module package's source examined, cleared ones included —
    // it does not move with the findings, which is what #244 asks of a site
    // count.
    //
    // **The prediction that stood here was that it falls, and it rises.** It read
    // "it falls as the sweep converts a reach to a bare specifier or to an
    // `import type`, so it is re-recorded downwards on purpose", which is true of
    // an individual reach and false of the population: a module still under
    // `backend/src/modules` contributes *no* reach at all, because there is no
    // package source for anything to reach. Packaging one turns every test import
    // of that module into a reach, and the conversions the sentence describes
    // remove a few of them. So the number grows by a module's worth per move and
    // is re-recorded **upwards**.
    //
    // 328 → 637, and every unit is accounted for. 328 was measured at bc820e86,
    // the merge request that wrote this entry. `master` reads **426** today: +98
    // arrived with T040b's third batch after the number was recorded, and the
    // +50% ceiling absorbed it silently — which is the drift a band is supposed
    // to tolerate and is worth naming, because it means this figure was not
    // current before this re-record either. The remaining **+228** is batch
    // four's seven packages: +228 as the moves landed, measured per package —
    // `assets_library` 26, `carts` 34, `custom_fields` 24, `customers` 25,
    // `email` 32, `invoices` 56, `settings` 31 — **less 17** that the batch's
    // own repairs then removed, which is the direction the old sentence was
    // right about: fifteen `invoices` service specifiers re-pointed from the
    // package's `src` to its `dist`, and two error classes that stopped being
    // imported at all.
    //
    // **T061a moves neither number.** The chain-parent signal walks the same
    // files and examines the same reaches, asking a second question of each. It
    // adds a third corroboration instead: `tenant-chains`, every class name a
    // `@TransitivelyScoped` decorator names, reconciled against the `@Entity()`
    // declaration the walk found for it. Two authors in two roots — `Invoice` is
    // a package's and `Order` is the application tree's — so a walk that lost
    // one of them leaves a parent named and unresolved rather than reporting
    // clean over the half it kept.
    //
    // **Re-recorded upwards by T040b packaging `orders` and `payments`**, which
    // is the rise the paragraph above predicts rather than an exception to it:
    // both modules were under `backend/src/modules`, contributing no reach at
    // all, and packaging them turned every test import of either into one. 637
    // -> 963. Re-record it, never widen the band — the floor is what would catch
    // the walk losing the package tree.
    sites: 963,
    sources: ['manifest-index', 'entities-registry', 'tenant-chains'],
  },
  'backend/scripts/i18n-hardcoded-strings.ts': {
    prefix: '[i18n:hardcoded]',
    run: { kind: 'tsx', path: 'scripts/i18n-hardcoded-strings.ts', args: [] },
    // Three root families since feature 091: `admin/src`, the packages that
    // declare `endora: { type: 'admin-ui' }` — the admin kit today (Phase 1b:
    // 57 of the admin's own components moved into it, and a ratchet that
    // stopped at the application would have read their entries as drained
    // rather than relocated) — and every module package's own `src/admin` layer
    // (Phase 4 — the drain relocates a screen at a time, which is the same
    // laundering at a finer granularity). The number grows with each batch.
    files: 386,
    sites: null,
    // `admin-ui` is the workspace manifests' own answer to "how many packages
    // ship a tree of admin UI", reconciled against how many of them the walk
    // actually opened a file in (feature 091, P5c). It replaced a by-name
    // refusal — "no member is `@endora-commerce/admin-kit`" — with a floor that
    // covers the second such package too, which is what P5b creates. It reads
    // `1/1` on this tree, and adding the token moved `files` by nothing: the
    // kit was already a root, under its name.
    sources: ['admin-ui'],
  },
  'scripts/check-naming.sh': {
    prefix: '[naming]',
    run: { kind: 'bash', path: 'scripts/check-naming.sh', args: [] },
    files: 5530,
    sites: null,
    sources: ['manifest-index'],
  },
  'scripts/check-language.sh': {
    prefix: '[language]',
    run: { kind: 'bash', path: 'scripts/check-language.sh', args: [] },
    files: 4338,
    sites: null,
    sources: ['manifest-index'],
  },
  'scripts/check-pdfmake-footprint.sh': {
    prefix: '[pdfmake-gate]',
    run: { kind: 'bash', path: 'scripts/check-pdfmake-footprint.sh', args: [] },
    files: 115,
    sites: null,
    sources: [],
  },
};

/**
 * Checks whose read size rests on their own walk, with why no independent
 * derivation exists.
 *
 * **Two-way**: a check recording no source and missing here fails, and an entry
 * for a check that has since gained one fails too. It is not expected to empty
 * — most of these populations genuinely have no second author — but an entry
 * is a standing invitation to find one, and #228 is the worked example of
 * finding one where nobody expected it (`package.json` scripts, for a check
 * whose population had been three syntactic shapes).
 */
export const READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE: Readonly<Record<string, string>> = {
  'backend/scripts/check-diacritic-folds.ts':
    'the population is every source file in the repository that could contain a fold or ' +
    'build a slug. Nothing derives that set: both are legal anywhere, which is the whole ' +
    'of issues #240 and #244.',
  'backend/scripts/check-doc-snippets.ts':
    'the population is the markdown under `docs/docs` and `specs`. A document enrols by ' +
    'carrying a marker, and no registry lists which documents ought to cite a source. ' +
    'Feature 080 T010 looked again and found no second author: the floor it added — every ' +
    'declared root contributes a file — is derived from the check\'s own constant, which ' +
    'is why it is a guard rather than a `sources=` entry.',
  'backend/scripts/check-fixture-substitution.ts':
    'the population is `backend/test`, which no manifest, registry or package script ' +
    'enumerates — a test file enrols by existing.',
  'backend/scripts/check-harness-teardown.ts': 'same population as `check-fixture-substitution`.',
  'backend/scripts/check-nul-bytes.ts':
    'the population is the whole repository minus two declared exclusions. A deny-list has ' +
    'no positive enumeration to reconcile against, and that is deliberate: an allow-list ' +
    'would leave the next extension-less script silently unscanned.',
  'backend/scripts/check-overlay-determinism.ts':
    'the artefact list comes from the generators themselves, and so does the entry list ' +
    'inside each artefact — a rendered file has no second author. The independent half ' +
    'exists and is a test rather than a second walk: the companion test compares ' +
    '`coveredArtifactPaths()` against the `*.generated.ts` files on disk. The `sites` ' +
    'population is floored per artefact instead (feature 080, T030a), in the idiom ' +
    "`check-doc-snippets` uses for its roots: a guard derived from the check's own " +
    'examinations rather than a `sources=` entry it would be reconciling with itself.',
  'backend/scripts/check-shared-table-wipes.ts': 'same population as `check-fixture-substitution`.',
  'scripts/check-pdfmake-footprint.sh':
    'the population is one installed dependency directory. Nothing derives how many files ' +
    'a published package ships.',
};

/**
 * Checks that disclose files but no finer population, with what it would take.
 *
 * **Two-way**, and this one *is* expected to drain: issues #235 and #237 are
 * both cases where the file count was unchanged and the site count was the
 * number that moved, so a check answering per site while reporting per file is
 * carrying the defect family's fourth member. Every entry below names the walk
 * it would cost, because in each case the check records only what it *found*
 * and never counts what it cleared — the second walk is the work, not a
 * decision anybody has to make.
 */
export const READ_SIZE_WITHOUT_A_SITE_POPULATION: Readonly<Record<string, string>> = {
  'backend/scripts/check-channel-resolution.ts':
    'reports the resolutions it rejects; counting the channel reads it cleared needs the ' +
    'analyzer to return them.',
  'backend/scripts/check-command-coverage.ts':
    'reports unaudited writes; the examined population is every write-shaped call, which ' +
    '`analyzeSource` discards as it goes.',
  'backend/scripts/check-container-imports.ts':
    'the unit is the file: one import of the container library per file is the whole rule.',
  'backend/scripts/check-entry-presence.ts':
    'reports the entry points that fail the rule; the ones that decide presence correctly ' +
    'are not collected.',
  'backend/scripts/check-harness-teardown.ts':
    'reports hand-released resources; the teardown calls it cleared are not collected.',
  'backend/scripts/check-module-boundary.ts':
    'reports cross-module reaches; the specifiers and table references it cleared are not ' +
    'collected, and there are two populations (imports and SQL) rather than one.',
  'backend/scripts/check-nul-bytes.ts': 'the unit is the file: a NUL anywhere in it is the rule.',
  'backend/scripts/check-subscribe-seam.ts':
    'reports bare subscriptions; the seam-registered ones are in `backend.ts` bodies the ' +
    'check does not enumerate. Its queue-consumer half *does* enumerate its own population ' +
    'in both directions and prints it as `module queue consumers read=`, but one `sites=` ' +
    'number cannot say two things, and the half that would go silent is the one that cannot ' +
    'count — so the check refuses (exit 2) on zero worker sites instead.',
  'backend/scripts/check-transaction-context.ts':
    'reports escaping statements; the SQL that stays inside its transaction is not collected.',
  'backend/scripts/i18n-hardcoded-strings.ts':
    'reports hard-coded literals; the translated ones are not collected.',
  'scripts/check-naming.sh':
    'four rules over four different units (module directories, migration identifiers, ' +
    'contract keys, route segments); one `sites=` number cannot say four things.',
  'scripts/check-language.sh':
    'the unit is the comment line, and only the offending ones survive the perl filter.',
  'scripts/check-pdfmake-footprint.sh': 'the unit is the dependency directory, measured whole.',
};
