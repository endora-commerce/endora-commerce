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
/**
 * **Swept on 2026-09-01, twenty-eight entries at once, and the sweep is the
 * point rather than the numbers.**
 *
 * Feature 095's drift report (`read-size-drift.ts`) printed its first block on
 * this file and found that **28 of the 35 recorded sizes no longer described
 * the tree** — every one of them inside its band, so nothing had ever gone red
 * and nobody had ever been asked. The three known wrong records this year
 * (Phase 1b, batch 9, batch 11) were the visible tip of that.
 *
 * **One cause covers the bulk**: feature 080's F4 moved 66 modules into
 * `packages/modules/`, and these numbers were written before it. Every module
 * walk reads 1541 -> 1895 and every whole-repo walk 5470 -> 6936, which is the
 * same population arriving in twenty different checks. It is growth, not a
 * shrinking walk: the `sources=` tokens reconcile in full on every one of them,
 * which is the evidence that nothing stopped looking.
 *
 * **`check-release-intent` is why this could not wait.** It read `files 55 ->
 * 83` against a ceiling of exactly 83 — zero headroom — so the next merge
 * request adding one file to its population would have gone red for a reason
 * that had nothing to do with it, on somebody else's branch.
 *
 * The sweep re-records; it widens nothing, and no assertion moved. What stops
 * the next twenty-eight is not this comment but the drift block, which now
 * prints on every run whether or not anything failed.
 *
 * **Re-recorded again on 2026-09-01 by feature 091's P7a and P7c**, twenty-five
 * entries, every one of them growth and every `sources=` token reconciling in
 * full. Those two rows give three module packages an `src/admin/` layer —
 * `price_lists`, `sales_channels` and `inventory`, eleven new source files, three
 * `.ts` and eight `.tsx` — take two files out of `admin/src/modules/`, delete one
 * ledger shard, and add four zone renders and four contributions. So `sites` moves
 * where a check counts renders and contributions (`check-admin-zones`, 25 -> 35)
 * and `files` moves in every walk the three packages are in.
 *
 * **Four of the seven files the `sourceRoots` family gained are not theirs, and
 * that is worth writing down because it is the sweep's own shape arriving
 * immediately after the sweep.** `fix/095-read-size-sweep` forked before P4b
 * (`e7bbadce7`) and recorded 1895 from its own tree; the merge that landed it
 * brought P4b's four new `.ts` files under the two PIM packages' `src/admin` with
 * it, so the
 * record was four short of `master` from the moment it existed. Measured with
 * `git ls-tree` over the walk's own roots: 1895 at `2abdb00ce`, 1899 at
 * `e7bbadce7` and at the branch point, 1902 here. The remaining +3 is P7a and
 * P7c's three `src/admin/index.ts`. A record swept on a branch describes that
 * branch's tree, not the tree it merges into.
 *
 * **Re-recorded on 2026-09-02 by feature 091's P7b**, twenty-eight entries, and
 * every one of them is this merge request's own doing rather than a share of
 * somebody else's: P7a and P7c had swept the file to zero drift the day before,
 * so the branch point had thirty-five entries in agreement and nothing to
 * apportion. Two of the twenty-eight move **down**, which is worth stating
 * because down is the defect direction and neither of these is a defect:
 * `check-lock-claims` reads two ledger shards fewer (`cross-module-imports/`'s
 * `customers.ts` and `organizations.ts` are deleted, the second being the last
 * of P7b's four boundary keys), and `check-admin-surface` reads four kit-symbol
 * sites fewer because the two duplicated `admin/src` components that imported
 * them are gone.
 *
 * The rest is one row's arithmetic seen from twenty-six angles. P7b adds a
 * `src/admin/` layer to `quick_order` (its first) and a zone file to each of
 * `price_lists`, `sales_channels` and `carts`; it moves
 * `DefaultPreferencesPanel` and `CartApprovalPolicyPanel` out of `admin/src` and
 * deletes the duplicate `DisplayModeOverrideRow` and `EntityChannelMembership`
 * left standing by P7a; it adds four test files and one `tsconfig.ui.json`. So a
 * walk over module sources gains one `.ts` (`quick_order`'s `src/admin/index.ts`
 * — the family at 1902 -> 1903), a walk over `backend/test` gains one (the new
 * contract test, 1649 -> 1650), and a walk over the whole tree gains eight
 * (`check-diacritic-folds`, 4935 -> 4943). `check-module-boundary` reports both
 * halves in place: module files 1865 -> 1873, admin files 142 -> 138.
 *
 * Two `sites` numbers are exact rather than approximate and are the ones to read
 * if this record is ever doubted. `check-admin-zones` moves 35 -> 41: two renders
 * (`OrganizationDetail` and `CustomerDetail`), five contributions (`price_lists`,
 * `sales_channels`, `carts`, and `quick_order` twice), less one foreign module
 * id (`CartApprovalPolicyPanel`'s `carts` namespace, whose ledger entry retires
 * here). And `check-default-language-prose` moves 29300 -> 29315: twenty new
 * `carts` bundle strings — ten keys in each shipped language — less the five
 * `core` keys this merge request removes, which are unread the moment the host
 * stops handing its own copy to a contributor.
 *
 * **Re-recorded on 2026-09-02 by feature 091's P4d**, twenty-four entries, all
 * growth, all this merge request's own — P7b had swept the file to zero drift
 * hours earlier, so there was nothing of anybody else's to apportion. Nothing
 * moves down: the one file this row deletes from `admin/src`
 * (`components/OrderEntryTabs.tsx`) is outnumbered by what replaces it.
 *
 * The whole of it is five files added and two deleted, seen from twenty-four
 * angles. Added: `packages/admin-kit/src/zones/RouteTabsZone.tsx`, `orders`'
 * first `src/admin/` layer (`index.ts` plus one zone `.tsx`), `quick_order`'s
 * second zone `.tsx`, one `tsconfig.ui.json`, and two admin test files.
 * Deleted: `admin/src/components/OrderEntryTabs.tsx` and its test. So the
 * numbers separate by extension and by root, which is the way to check this
 * record if it is ever doubted:
 *
 *   * a module walk that reads **`.ts` only** gains exactly **one** —
 *     `orders`' `src/admin/index.ts` — which is the `+1` on
 *     `check-entry-scope`, `check-port-catches`, `check-kernel-boundary` and
 *     the rest of that family (1903 -> 1904);
 *   * a walk over module sources **and** `.tsx` gains three, and pays one back
 *     for the deleted admin component: `check-module-boundary` 3964 -> 3967,
 *     reporting both halves in place (module files 1873 -> 1876, admin host
 *     files 98 -> 97);
 *   * a whole-repo walk gains six (`check-nul-bytes` 6971 -> 6977: seven files
 *     added, two deleted, plus the changeset this merge request carries) or
 *     four where the `tsconfig.ui.json` and the markdown are out of the
 *     population (`check-diacritic-folds` 4943 -> 4947). `check-naming.sh`
 *     7031 -> 7037 counts the changeset too.
 *
 * Two `sites` numbers are exact rather than approximate. `check-admin-zones`
 * moves 41 -> 45: two renders — `OrderCreatePage` and `QuickOrderOnBehalfPage`,
 * which are two mounts of one place and are both this member's — and two
 * contributions, `orders`' standard tab and `quick_order`'s quick one. The
 * foreign-id count is unchanged at 4: the two module ids `OrderEntryTabs.tsx`
 * spelled were in a file the route table and the nav claim for nobody, so they
 * were the admin application's and in no ledger; deleting them therefore
 * removes a coupling this check never counted. And `check-admin-surface` moves
 * 2336 -> 2345 while its **ledger goes to zero**: the two host reaches into
 * `admin/src/components/` become two bare specifiers into the kit, and the
 * three new module admin files plus the generated registry's new import supply
 * the rest.
 */
export const RECORDED_READ_SIZES: Readonly<Record<string, RecordedReadSize>> = {
  'backend/scripts/check-action-route-permissions.ts': {
    prefix: '[action-route-permissions]',
    run: { kind: 'tsx', path: 'scripts/check-action-route-permissions.ts', args: [] },
    files: 1808,
    sites: 73,
    // `emitted-manifests` is this check saying which artefact its manifest half
    // came from: the manifests are imported rather than walked, and a packaged
    // module's resolves at its build output. It is the disclosure half of the
    // staleness refusal; see `scripts/lib/emitted-freshness.ts`.
    sources: ['manifest-index', 'emitted-manifests'],
  },
  'backend/scripts/check-channel-resolution.ts': {
    prefix: '[channel-resolution]',
    run: { kind: 'tsx', path: 'scripts/check-channel-resolution.ts', args: ['--enforce'] },
    files: 1904,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-command-coverage.ts': {
    prefix: '[command-coverage]',
    run: { kind: 'tsx', path: 'scripts/check-command-coverage.ts', args: ['--strict'] },
    files: 1458,
    sites: null,
    // 64, not 65: this check excludes modules by argument, and the expectation
    // is derived after the exclusion rather than despite it.
    sources: ['manifest-index'],
  },
  'backend/scripts/check-container-imports.ts': {
    prefix: '[container-imports]',
    run: { kind: 'tsx', path: 'scripts/check-container-imports.ts', args: [] },
    files: 1705,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-diacritic-folds.ts': {
    prefix: '[diacritic-folds]',
    run: { kind: 'tsx', path: 'scripts/check-diacritic-folds.ts', args: [] },
    files: 4947,
    // It had none until issue #244, on the stated ground that "the unit is the
    // fold, and a file without one is exactly what #244 is about". True of the
    // two fold signals and no longer the whole check: the `slug-run` signal
    // judges every `.replace()` whose pattern it can read, cleared ones
    // included, so there is now a population here that does not move with the
    // findings.
    sites: 434,
    sources: [],
  },
  'backend/scripts/check-doc-snippets.ts': {
    prefix: '[doc-snippets]',
    run: { kind: 'tsx', path: 'scripts/check-doc-snippets.ts', args: [] },
    files: 1048,
    sites: 9,
    sources: [],
  },
  'backend/scripts/check-entity-tenant-classification.ts': {
    prefix: '[tenant-classification]',
    run: { kind: 'tsx', path: 'scripts/check-entity-tenant-classification.ts', args: [] },
    files: 1904,
    sites: 236,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-presence.ts': {
    prefix: '[entry-presence]',
    run: { kind: 'tsx', path: 'scripts/check-entry-presence.ts', args: [] },
    files: 1904,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-scope.ts': {
    prefix: '[entry-scope]',
    run: { kind: 'tsx', path: 'scripts/check-entry-scope.ts', args: [] },
    files: 1904,
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
    sites: 40,
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
    files: 124,
    sites: 825,
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
    files: 1650,
    sites: 530,
    sources: [],
  },
  'backend/scripts/check-harness-teardown.ts': {
    prefix: '[harness-teardown]',
    run: { kind: 'tsx', path: 'scripts/check-harness-teardown.ts', args: [] },
    files: 1650,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-kernel-boundary.ts': {
    prefix: '[kernel-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-kernel-boundary.ts', args: [] },
    files: 1904,
    sites: 30,
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
    files: 202,
    sites: 14,
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
    //
    // **Batch 11 — `newsletter` and `transactional_emails`, seventeen routes
    // and fifteen nav entries — takes it to 108**, which is that thirty-two
    // exactly. Fifteen rather than nine again for the `PALETTE_ITEMS` reason:
    // nine sidebar rows and six hand-written Navigate rows, of which three
    // named destinations no manifest action covered and are declarations now.
    // Measured on the merge commit rather than on the branch.
    //
    // **Batch 12 — `invoices`, `ksef` and `quote_requests`, eight routes and
    // four nav entries — takes it to 96**, which is that twelve exactly. Four
    // rather than three for the `PALETTE_ITEMS` reason once more: three sidebar
    // rows and one hand-written Navigate row, which was a second copy of
    // `quote_requests`' own `open-rfq-inbox` action and is deleted rather than
    // replaced. Measured on the merge commit rather than on the branch.
    files: 2,
    sites: 96,
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
    // number was last written down. **2187 -> 2206 with P5b**, which is
    // `@endora-commerce/page-builder-admin`'s twenty-three sources joining the
    // family population less the ten `admin/src` files the move left behind
    // (twenty out, nine shims and `newsletter`'s own variable vocabulary back
    // in), plus the tree's own growth since 2187 was written.
    //
    // `sites` does not move with P5b, and the reason is the point rather than a
    // coincidence. The package's three `useTranslation` calls all name `core`,
    // which is `_i18n`'s bundle under a synthetic alias and is no module id, so
    // none of them is a `foreign-module-id` site — `ColorPaletteModal`'s two
    // read `cms` until that merge request moved the fifteen
    // `pageBuilder.colorPalette.*` keys to `core`, exactly as P5a moved the
    // other thirty-three, and had they been left they would be two findings in
    // a package that owns no module id at all.
    //
    // **15 -> 16 when the foreign-id walk widened to a module's own sources.**
    // `files` does not move with *that* one, and it is the measurement rather
    // than an aside: the module walk roots were already the *render* half's
    // population, so the widening opens no new file — it reads the ones it had,
    // for a question it was not asking. What moves is `sites`, by exactly one:
    // the `visibility-gate` on `credentials` that batch 10 wrote into
    // `mod-settings`' admin layer, correct and outside every instrument in this
    // estate from the day it landed.
    //
    // **2206 -> 2212, of which P9 is one.** The one is this merge request's:
    // the `FulfilmentStrategyPicker` the kit publishes, its old path staying as
    // a shim, so the admin side of the move is a wash. `sites` does not move at
    // all, because the component reads `useTranslation('core')` and named no
    // module id before or after — which is the whole of why §10.2 routed it to
    // the kit rather than to `./admin-ui`. The other five arrived with batch 11
    // and were not re-recorded there; the split is derived rather than
    // apportioned, this merge request's delta being measured on its own base
    // before the merge (2207 -> 2208) and the merged tree read after it.
    //
    // **2212 -> 2214 and 16 -> 18 with batch 12**, and both deltas are this
    // batch's entire doing rather than a share of one: the branch is
    // `origin/master` plus one commit, so the two trees were measured and
    // differenced rather than apportioned. `files` moves by the net of
    // twenty-two source files arriving under the module walk roots
    // (`invoices`, `ksef` and `quote_requests`' nineteen screens plus three
    // `./admin` entry points) against twenty leaving `admin/src` — nineteen
    // moved and the P8 e-mail-outcome shim, whose last reader went with the
    // directory. `sites` moves by exactly the mechanism this batch adds: one
    // render, `invoices`' `<AdminZone name="invoice.detail.after">`, and one
    // contribution, `ksef`'s. The `foreign-ids` half does not move — the drain
    // this batch pays was a ledgered *import*, and the module ids in the
    // moved screens are each module's own.
    //
    // **2214 -> 2230 and 18 -> 25 with P4b**, both this merge request's entire
    // doing and measured rather than apportioned: `origin/master` was read
    // before the change and the merged tree after it, and the three other
    // entries this branch moves are separated the same way. `files` is sixteen:
    // the kit's six `field-protection` sources, `pim_ergonode`'s six-file
    // `src/admin` (its first, so `module-admin` goes 42 -> 43) and
    // `pim_pimcore`'s four, less the 540-line
    // `admin/src/modules/pim_ergonode/components/FieldProtectionToggle.tsx`
    // this deletes. `sites` is seven: one render — the eighth
    // `product.editor.field.after` mount, on the attributes tab — and six
    // contributions, three from each PIM. The `foreign-ids` half does not move:
    // both PIMs name their **own** id in their own sources, which is what a
    // `scopeKey` and a `useTranslation` in an owner's file are, and the two
    // ledgered imports this batch retires are `check:module-boundary`'s.
    // **No zone member is added** — `zone-enum` stays 5/5 — because all three
    // places were already declared and already rendered by P4a, which is what
    // `unrendered-zone` having no ledger requires.
    files: 2246,
    sites: 45,
    // `zone-enum` is `AdminZoneNameSchema` held against `AdminZonePropsMap`:
    // the enum is the independent author of this check's population and the map
    // is the second declaration reconciled against it, so a member added
    // without a props type moves the expectation in the same run.
    // `manifest-index` is issue #215's shared floor over the module walk.
    // `admin-ui` arrives with P5b, which creates the second admin-ui member and
    // so the first non-empty expectation this token could carry — the reasoning,
    // including why P5c's *"and carries a ledger key"* condition is dropped
    // rather than waited on, is on the `coverage` block in the check itself.
    // `module-admin` is the floor that moved with the widened foreign-id walk,
    // and it exists because neither of the others can see what it sees:
    // `manifest-index` is satisfied by any file a registered module contributes,
    // which for a module package is its backend sources, so a package's *admin
    // layer* dropping out of the walk leaves it green, and `admin-ui` counts
    // packages that are not modules at all. Its expectation is the generated
    // admin contribution registry's — a second program's answer to "which
    // packages ship admin code, and under which subpath" — and it grows with
    // every batch of Story 3.
    sources: ['zone-enum', 'admin-ui', 'manifest-index', 'module-admin'],
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
  'backend/scripts/check-default-language-prose.ts': {
    prefix: '[default-language-prose]',
    run: { kind: 'tsx', path: 'scripts/check-default-language-prose.ts', args: [] },
    // Every `.ts` file under a module's own directory, minus its `migrations/`
    // (a declared bound — an applied migration cannot be edited, so a finding
    // there has no repair a ledger entry could drain), its tests and its
    // declaration files.
    //
    // **1449 -> 1460 and 29029 -> 29264, of which batch 12 is +6 and +56.**
    // Measured rather than apportioned: this branch is `origin/master` plus one
    // commit, and `origin/master` reads 1454 / 29208. The population is a
    // module's **own** directory, so the nineteen screens that moved into
    // `invoices`, `ksef` and `quote_requests` are in it where they were not
    // before, and three `./admin` entry points come with them — the twenty
    // files that left `admin/src` were never in this walk at all, which is why
    // the file delta is positive here and net-of-two next door. The 235 sites
    // are those files' string and template literals, plus the three entry
    // points' route paths and label keys. The 5 and 179 between 1449 / 29029
    // and the merge base are the tree's growth across the merge requests
    // between, inside the band and not re-recorded there; they are named rather
    // than absorbed.
    //
    // **1460 -> 1464 and 29264 -> 29289 with P4b**, all four files and all
    // twenty-five sites this merge request's, measured against `origin/master`
    // rather than apportioned. The four are the `.ts` files the two PIM
    // packages' new admin layers add — `pim_ergonode`'s `./admin` entry point,
    // its protections client and its field-protection source descriptor, and
    // `pim_pimcore`'s descriptor. The three `.tsx` zone components in each
    // package are outside this walk, which reads `.ts`; nothing the kit gains
    // is in it either, the population being a **module's** own directory.
    files: 1469,
    // Every string and template literal the walk offered the classifier. It is
    // deliberately not the findings — a number that moves with the tree's
    // health cannot answer "did you read the tree" — and it is two orders
    // larger than `files`, which is what makes it the number that moves first
    // when a position filter or the parser narrows.
    sites: 29320,
    // `manifest-index` is issue #215's shared floor over the module walk.
    // `detected-languages` is `SUPPORTED_LANGUAGES` minus the default, held
    // against the languages this check has a detector for: `1/1` today, and a
    // third shipped language makes it `1/2`, which the shared reporter refuses
    // as a short walk. That is what turns § 1.3's Polish-only bound into a
    // refusal instead of an implied coverage claim.
    sources: ['manifest-index', 'detected-languages'],
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
    //
    // **353 -> 354 and 2436 -> 2408 with P5b**, and the site fall accounts
    // exactly. Nine `cms` chrome files carrying 41 specifiers between them left
    // for `@endora-commerce/page-builder-admin` and nine one-line shims took
    // their place, which is -32; `newsletter` gained
    // `email-variables.ts` (+1) and its three screens each grew a second
    // specifier, taking the builder from the package and their own vocabulary
    // from that new file (+3). The file count moves by one for the same reason:
    // shim for component, one for one, plus `newsletter`'s new file. The three
    // `invoices` reaches this merge request retires move neither number — a
    // rewritten specifier is still a specifier, which is precisely why
    // `check:module-boundary` and not this check is where they were ledgered.
    //
    // **354 -> 358 and 2408 -> 2362, and P9 is -5 of the -46.** This merge
    // request is the P8 shape again in miniature: one published component, a
    // shim at the old path, no directory moved. Its -5 accounts exactly and all
    // of it comes off the published file — `FulfilmentStrategyPicker` had seven
    // specifiers (`react`, `lucide-react`, `@endora-commerce/contracts` and
    // four `@/…` reaches) and its shim has two. Its two consumers are a wash,
    // one specifier before and one after, which is why the two
    // `cross-module-imports` keys they retire move this number by nothing: a
    // rewritten specifier is still a specifier.
    //
    // The other -41, with the +4 files, is **batch 11** — `newsletter` and
    // `transactional_emails` moving their admin directories into their packages
    // — which did not re-record it. That is the silent fall this entry keeps
    // warning about, inside the band and therefore invisible until the next
    // merge request had to read the line. The split is derived rather than
    // apportioned: P9's delta was measured on its own base before the merge
    // (2408 -> 2403 at `6fa00d9a0`) and the merged tree read after it.
    //
    // **358 -> 360 and 2362 -> 2280 with batch 12**, and the whole of both
    // deltas is this batch's: the branch is `origin/master` plus one commit, so
    // the numbers are a difference of two measurements rather than an
    // apportionment. `files` moves by two because the population follows the
    // **surface** and not the tree — `invoices`, `ksef` and `quote_requests`
    // contribute twenty-two files under their packages where they contributed
    // twenty under `admin/src`, the two extra being their `./admin` entry
    // points; the twentieth leaving is the P8 e-mail-outcome shim, deleted with
    // the directory rather than moved. `sites` falls by 82 for the reason this
    // entry keeps recording: a screen written against `@/components/ui/*` and
    // `@/lib/*` names one specifier per module it reaches, and the same screen
    // written against the kit names one per **barrel** — nineteen screens
    // collapsing four and five host paths each into `ui`, `lib`, `components`
    // and `i18n`. The one reach this batch actually retires,
    // `invoices` -> `ksef`, moves neither number, because a specifier replaced
    // by a `<AdminZone>` mount is a specifier gone from a file this walk still
    // reads: the drain is `check:module-boundary`'s to see, which is where it
    // was ledgered.
    //
    // **360 -> 369 and 2280 -> 2314 with P4b**, and this is the rare merge
    // request that moves both **up**, which is worth stating because every
    // accounting above it describes a fall. Both deltas are this branch's,
    // measured against `origin/master` and not apportioned. `files` is nine:
    // `pim_ergonode` grows its first `src/admin` (six files) and `pim_pimcore`
    // grows four more, against the one `admin/src` file this deletes. `sites`
    // is thirty-four, and the collapse this entry keeps describing does not
    // apply because nothing was rewritten from `@/…` — ten of the eleven new
    // module-surface files are *new*, each naming `react`, the contracts
    // package and one or two kit subpaths, and the file that goes was a single
    // 540-line component with five specifiers. The two `cross-module-imports`
    // keys this batch retires move neither number: both were reaches out of
    // `catalog`'s directory, which is the admin application's population here
    // and is `check:module-boundary`'s to judge.
    //
    // `admin-kit-exports` goes 6/6 -> 7/7 in the same run — the kit publishes
    // `./field-protection` — which is the second derivation doing its job: a
    // subpath declared and not built, or built and not declared, is what makes
    // a reach unjudgeable, and this one is both.
    files: 385,
    sites: 2345,
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
    //
    // **3699 -> 3916, and only ten of that is P5b's** — the nine chrome files
    // and eleven e-mail-builder files that left `admin/src`, less the nine
    // shims and `newsletter`'s new `email-variables.ts`. The other 227 are the
    // module tree's growth across the batches between, unrecorded because every
    // one of them stayed inside the -10%/+50% band and nothing asked. Recording
    // it here rather than leaving it is the rule applied to the merge request
    // that moved the number, and the split is stated so the next reader does not
    // read 217 files of drift as this one's blast radius.
    //
    // **3916 -> 3934, and eight of that is batch 12's.** Measured rather than
    // apportioned: this branch is `origin/master` plus one commit, and
    // `origin/master` reads 3926. The eight is two populations rather than one,
    // which is the thing worth writing down — `files` here is the source walk
    // **plus** the module-package surfaces reader, and that reader is lazy, so
    // it opens a package's manifest and its emitted module only for a subpath a
    // module actually reached. The source half moves by two: twenty-two files
    // arriving under three packages against twenty leaving `admin/src`. The
    // other six are the surfaces reader following the three new `./admin`
    // subpaths, which did not exist for it to open before. The ten between 3916
    // and 3926 are the tree's growth across the merge requests between, which
    // stayed inside the band and were not re-recorded; they are named here
    // rather than absorbed, so nobody reads eighteen files as this batch's
    // blast radius.
    //
    // **3934 -> 3947 with P4b**, all thirteen this branch's, measured against
    // `origin/master` rather than apportioned — and, like batch 12's eight, it
    // is the two populations rather than one. The source half moves by ten: the
    // eleven files the two PIM packages' admin layers add, less the one
    // `admin/src` component this deletes. The other three are the lazy
    // module-package surfaces reader following `pim_ergonode`'s brand-new
    // `./admin` subpath, which did not exist for it to open before. The kit's
    // six new `field-protection` sources are in **neither** half: this check's
    // populations are module sources and the admin application, and
    // `@endora-commerce/admin-kit` is an `admin-ui` package that is neither.
    // The two `cross-module-imports` keys this batch retires are the whole
    // point and move `files` by nothing — they are `ledger-size 17 -> 15`.
    files: 3967,
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
    files: 6977,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-overlay-determinism.ts': {
    prefix: '[overlay:check]',
    run: { kind: 'tsx', path: 'scripts/check-overlay-determinism.ts', args: [] },
    files: 8,
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
    //
    // **471 -> 501, of which batch 12 is +3**, measured against `origin/master`
    // at 498. The three are the three `./admin` subpaths this batch adds to the
    // admin contribution registry — one import line each, which is what a unit
    // of this number is. `files` does not move: the artefact set is fixed at
    // eight and this batch adds no generated file. The 27 between 471 and the
    // merge base are earlier batches' registry entries, inside the band and not
    // re-recorded; named here rather than absorbed, and `files` is left at 6
    // because this batch did not move it.
    sites: 507,
    sources: [],
  },
  'backend/scripts/check-port-catches.ts': {
    prefix: '[port-catches]',
    run: { kind: 'tsx', path: 'scripts/check-port-catches.ts', args: [] },
    files: 1904,
    sites: 162,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-port-dependencies.ts': {
    prefix: '[port-deps]',
    run: { kind: 'tsx', path: 'scripts/check-port-dependencies.ts', args: [] },
    files: 1690,
    sites: 1427,
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
    files: 1857,
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
    sites: 1670,
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
    files: 1784,
    sites: 664,
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
    files: 83,
    sites: 91,
    sources: ['workspace-globs'],
  },
  'backend/scripts/check-shared-table-wipes.ts': {
    prefix: '[shared-table-wipes]',
    run: { kind: 'tsx', path: 'scripts/check-shared-table-wipes.ts', args: [] },
    files: 1650,
    sites: 154,
    sources: [],
  },
  'backend/scripts/check-subscribe-seam.ts': {
    prefix: '[subscribe-seam]',
    run: { kind: 'tsx', path: 'scripts/check-subscribe-seam.ts', args: [] },
    files: 1904,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-transaction-context.ts': {
    prefix: '[transaction-context]',
    run: { kind: 'tsx', path: 'scripts/check-transaction-context.ts', args: [] },
    files: 1904,
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
    files: 3827,
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
    sites: 1068,
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
    //
    // **386 -> 396 with P5b, and the walk counts `.tsx` only, which is what
    // makes the move account exactly.** `admin/src` lost fourteen — the seven
    // page-builder chrome components out of `cms` and the seven e-mail-builder
    // ones out of `_shared` — and gained the seven shims that replace the first
    // set, so it is 7 down; `@endora-commerce/page-builder-admin/src` arrives
    // carrying all fourteen, so the walk is 7 up. The package's eleven `.ts`
    // files move no number here and are outside this walk by construction.
    files: 419,
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
    files: 7037,
    sites: null,
    sources: ['manifest-index'],
  },
  'scripts/check-language.sh': {
    prefix: '[language]',
    run: { kind: 'bash', path: 'scripts/check-language.sh', args: [] },
    files: 5255,
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
