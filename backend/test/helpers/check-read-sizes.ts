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
 * Every check now prints a read line — `scripts/lib/read-size.ts` for the tsx
 * ones, `scripts/lib/read-size.sh` for the shell ones — and this file is what
 * makes that number *bite*: it records what each check
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
 * > **That last sentence is wrong, and P7d found it by deriving its own** (see
 * > below). `check-default-language-prose`'s walk is
 * > `name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')`
 * > over `layout.moduleWalkRoots`, so it opens **no JSON at all** — not a
 * > module's `i18n/` bundle and not `_i18n`'s. No bundle string has ever been in
 * > its `sites`. The **number** 29300 -> 29315 is not in doubt and is not
 * > changed here; what is corrected is the reason, which named a population the
 * > check does not read. P7b's fifteen came from its own `.ts` files —
 * > `quick_order`'s new `src/admin/index.ts`, the three sibling `index.ts`
 * > files it added contributions to, and the `carts` route and service it
 * > extended. Recorded rather than quietly overwritten, because a re-recording
 * > whose stated reason is unfalsifiable is the thing this header exists to
 * > prevent.
 *
 * **Re-recorded on 2026-09-02 by feature 091's P7d**, twenty-four entries — and
 * every one of them is this merge request's own, on P7b's terms: the branch
 * point had thirty-five entries in agreement, so there was nothing to
 * apportion. Every row moves **up**; none moves down.
 *
 * The whole of it is one file-count arithmetic seen from many angles. P7d adds a
 * `src/admin/` layer to `payments` (its first) and a `zones/` directory to each
 * of `inpost` and `dhl_parcel`: **four new module `.ts` files**
 * (`payments`' and the two carriers' `src/admin/index.ts` — the carriers' were
 * modified, not added — plus `dhl_parcel`'s `zones/download-pdf.ts`) and **four
 * new module `.tsx`** (`OrderPaymentsTab`, moved out of `admin/src`;
 * `InpostLabelButton`; `DhlDocuments`; `DhlCourierBooking`). It takes **two**
 * files out of `admin/src/modules/orders/` — the moved tab and
 * `api/carrier-documents-client.ts`, deleted — and adds three admin test files
 * and one `tsconfig.ui.json`.
 *
 * So the numbers fall out by extension, and that is the way to check them:
 *
 *   - a walk over module `.ts` **only** gains exactly **2** — `payments`'
 *     `src/admin/index.ts` and `dhl_parcel`'s `download-pdf.ts` — which is the
 *     twelve-check family at 1903 -> 1905, and `check-command-coverage`
 *     (1457 -> 1459), `check-container-imports` (1704 -> 1706),
 *     `check-port-dependencies` (1689 -> 1691) and `check-port-shape`
 *     (1783 -> 1785) on their own narrower roots;
 *   - a walk over module `.ts` **and** `.tsx` gains **6**:
 *     `check-platform-surface` 1854 -> 1860 and `check-singleton-identity`
 *     3824 -> 3830;
 *   - a walk over module sources **plus** `admin/src` gains 6 - 2 = **4**:
 *     `check-admin-zones` 2243 -> 2247 and `check-admin-surface` 382 -> 386;
 *   - `i18n:hardcoded` reads `.tsx` on those two roots and gains 5 - 2 = **3**,
 *     417 -> 420;
 *   - a whole-tree walk gains the eight files added less the one deleted, plus
 *     this row's changeset — so **+9**: `check-nul-bytes` 6971 -> 6980 and
 *     `check-naming.sh` 7031 -> 7040. The changeset is the file that is easy to
 *     forget, because it is written last, after the numbers have been read;
 *     `check-diacritic-folds` (4943 -> 4950) and `check-language.sh`
 *     (5251 -> 5258) gain **7**, being the same arithmetic without the
 *     `tsconfig.ui.json`.
 *   - `check-module-boundary` reports both halves in place: module files
 *     1873 -> 1879, admin files 138 -> 136.
 *
 * Three `sites` numbers are exact rather than approximate. `check-admin-zones`
 * moves 41 -> 46: four renders (`OrderDetail`'s payment tab body, and
 * `OrderShipmentsTab`'s row zone, footer zone and the `useAdminZone` its tab
 * counts — three of the four are `AdminZone` JSX, one is the hook) and four
 * contributions (`payments`, `inpost`, `dhl_parcel` twice), less **three**
 * foreign module ids, which is the whole of `orders`' half of that ledger.
 * `check-overlay-determinism` moves 506 -> 507: one import line in
 * `admin/src/modules.generated.ts`, `payments` joining the registry. And
 * `check-default-language-prose` moves 29315 -> 29334 — nineteen — which is
 * measured per file rather than reasoned about, `analyzeSource` being exported:
 * `payments/src/admin/index.ts` 0 -> 3, `dhl_parcel/.../download-pdf.ts`
 * 0 -> 2, `dhl_parcel/src/admin/index.ts` 6 -> 15, `inpost/src/admin/index.ts`
 * 6 -> 11. The six `dhl_parcel` bundle keys this row adds in each shipped
 * language contribute **nothing**, which is what produced the correction above.
 *
 * **Re-recorded again on 2026-09-02 by feature 091's P4d**, the same twenty-four
 * entries, and every one of them this merge request's own: it merged P7d before
 * measuring, so the baseline it moves from is P7d's own record with zero drift.
 * Every row moves **up**.
 *
 * The whole of it is seven files added and two deleted. Added:
 * `packages/admin-kit/src/zones/RouteTabsZone.tsx`; `orders`' first `src/admin/`
 * layer (`index.ts` plus `zones/OrderEntryStandardTab.tsx`);
 * `quick_order`'s `zones/OrderEntryQuickTab.tsx`; one `tsconfig.ui.json`; two
 * admin test files; and this row's changeset. Deleted:
 * `admin/src/components/OrderEntryTabs.tsx` and its test. So, by extension and
 * by root, which is how to check this record:
 *
 *   - a walk over module `.ts` **only** gains exactly **1** — `orders`'
 *     `src/admin/index.ts`, the sole new `.ts` under a module root — which is
 *     the twelve-check family at 1905 -> 1906 and the four narrower roots
 *     (`check-command-coverage` 1459 -> 1460, `check-container-imports`
 *     1706 -> 1707, `check-port-dependencies` 1691 -> 1692, `check-port-shape`
 *     1785 -> 1786);
 *   - a walk over module `.ts` **and** `.tsx` gains **3**:
 *     `check-platform-surface` 1860 -> 1863, `check-singleton-identity`
 *     3830 -> 3833;
 *   - a walk over module sources **plus** `admin/src` gains 3 + 1 - 1 = **3**
 *     (the kit's new `.tsx`, less the deleted admin component):
 *     `check-admin-zones` 2247 -> 2250, `check-admin-surface` 386 -> 389;
 *   - `i18n:hardcoded` gains 3 - 1 = **2**, 420 -> 422;
 *   - a whole-tree walk gains the seven added less the two deleted, **+6**:
 *     `check-nul-bytes` 6980 -> 6986 and `check-naming.sh` 7040 -> 7046;
 *     `check-diacritic-folds` (4950 -> 4954) and `check-language.sh`
 *     (5258 -> 5262) gain **4**, the same arithmetic without the
 *     `tsconfig.ui.json` and the changeset;
 *   - `check-module-boundary` reports both halves in place: module files
 *     1879 -> 1882, admin host files 98 -> 97.
 *
 * Three `sites` numbers are exact. `check-admin-zones` moves 46 -> 50: two
 * renders and two contributions, and nothing else — the two renders are
 * `OrderCreatePage` and `QuickOrderOnBehalfPage`, which are two mounts of one
 * place and both this member's, and the contributions are `orders`' standard
 * tab and `quick_order`'s quick one. The foreign-id count does **not** move,
 * which is worth stating because the row deletes a file that spelled two module
 * ids: `admin/src/components/OrderEntryTabs.tsx` is claimed by neither the route
 * table nor the nav, so it was the admin application's own and its ids were
 * never in that population. `check-overlay-determinism` moves 507 -> 508: one
 * import line in `admin/src/modules.generated.ts`, `orders` joining the
 * registry. And `check-default-language-prose` moves 29334 -> 29339 — five —
 * measured per file with `analyzeSource` rather than reasoned about, on P7d's
 * instruction: `orders/src/admin/index.ts` 0 -> 3 and
 * `quick_order/src/admin/index.ts` 5 -> 7. The two bundle keys this row moves
 * between `_i18n` and the two modules contribute nothing, that walk opening no
 * JSON at all.
 *
 * **Re-recorded on 2026-09-02 by feature 097 — one entry, and one field of it.**
 * `check-module-boundary`'s `sites` moves from `null` to **11127**, because the
 * check now prints a site count for the first time (FR-012); the entry's removal
 * from `READ_SIZE_WITHOUT_A_SITE_POPULATION` is the other half of that
 * transition, and the ratchet in `check-read-size.test.ts` requires the two to
 * move together in both directions. Nothing else in this file is touched, and
 * that is a deliberate refusal rather than an omission.
 *
 * **`files` does not move at all**, which is the fact that made the separation
 * easy to prove rather than to argue. A module's `migrations/` directory is
 * inside `layout.moduleWalkRoots` and always has been, so the 225 migration
 * files were already in `files=4147`; what feature 097 changes is the *rule*
 * applied to them, not the walk. Measured on this branch and on its branch
 * point: `files=4147` both sides.
 *
 * **Thirty rows in this file are drifted and none of that drift is this merge
 * request's.** `files 1916 -> 2003` across every module-tree walk is
 * `specs/089-unopim-pim-sync/`'s merge, which arrived after those numbers were
 * last written down; the drift report names them on every run, and re-recording
 * them here would file another merge request's growth under this one's name. Two
 * agents have already refused the same re-record, and this is the third.
 */
/**
 * **Re-recorded on 2026-09-03, thirty-one entries, and none of the movement is
 * this merge request's own.** That is the whole reason it exists: the entries
 * below drifted across sixteen merges by four different features, the drift
 * report named them on every run, and four merge requests in a row correctly
 * declined to re-record growth that was not theirs — the note above this one is
 * the last of those refusals. A ratchet whose repair belongs to nobody is a
 * ratchet nobody repairs, so this is the merge request that owes it, and it
 * changes nothing but the numbers and this comment.
 *
 * **The baseline is measured, not assumed.** Every entry that had drifted was
 * blamed to `543151a4a` (feature 091's batch 15) or to `2abdb00ce` (the 095
 * sweep), so the whole estate was run in a worktree at `ff2637487` — batch 15's
 * merge into `master`. All thirty-one read back their recorded value **exactly**.
 * The drift therefore belongs entirely to the merges after it, and no recorded
 * number was already wrong when it was written. Four checkpoints were taken:
 * `ff2637487`, `1fffd1a83` (the merge after `089-unopim-pim-sync`), `4b7273cc0`
 * (the merge after batch 16) and `627c6abe5` (this branch point), which is what
 * lets each number below be apportioned rather than reasoned about.
 *
 * **Three merges account for nearly all of it, and one of them cancels part of
 * another** — the case this file's own rule says must be stated rather than
 * netted:
 *
 *   - `089-unopim-pim-sync` (`14384dbac`) adds two module packages,
 *     `pim_unopim` and `pim_connector`: **+76** `.ts` under the module walk
 *     roots, +67 under `backend/test`, +193 repo-wide.
 *   - `feat/091-batch16-admin-drain` (`4326b2cda`) moves `cms`' and `blog`'
 *     screens into their packages: **+11** module `.ts`, and **-3** repo-wide,
 *     because the admin application loses more files than the packages gain.
 *   - `fix/pim-package-entity-surface` (`a04ec6254`) deletes
 *     `pim_connector/src/backend/services/field-path.ts`: **-1** module `.ts`.
 *
 * So the twelve-check module-walk family is 1916 -> 2002 as **+76, +11, -1**,
 * and recording the net +86 without saying so would leave a row that is
 * internally consistent and wrong about its own cause.
 *
 * The rest, per population:
 *
 *   - **`backend/test`** (`check-fixture-substitution`, `check-harness-teardown`,
 *     `check-shared-table-wipes`) 1653 -> 1749: 089-unopim +67,
 *     `fix/product-feeds-port-catches` +2, `feat/096-block-vocabulary` +1,
 *     `feat/080-permission-dependencies` +2, `fix/port-catches-promise-form` +4,
 *     `feat/073-off-state-residue` batch one +8 and batch two +11, and
 *     `feat/073-off-state-coverage-ratchet` +1.
 *   - **whole repository** (`check-nul-bytes` 6991 -> 7278, `check-naming.sh`
 *     7051 -> 7338) is the same sixteen merges summing to +287, of which
 *     089-unopim is +193 and batch 16 is -3.
 *   - **`check-language.sh`** 5261 -> 5473 and **`check-diacritic-folds`**
 *     4953 -> 5142 are that walk minus the roots each excludes;
 *     `feat/097-migration-sql-boundary`'s fifteen new ledger shards are in the
 *     first (`backend/scripts` is in scope) and in neither the second nor
 *     `check-diacritic-folds`, which is why those two numbers move differently.
 *   - **`check-doc-snippets`** 1048 -> 1102 is nine documentation merges, the
 *     largest being 089-unopim (+15); its `sites` 9 -> 11 is
 *     `design/f12-documentation-generation` alone, the only merge in the window
 *     that changed a `verbatim-from` marker (21 -> 25 markers).
 *   - **`check-lock-claims`** 202 -> 222 moves for **three** reasons, two of
 *     which cancel: 089-unopim +6 manifests, batch 16 **-2** ledger shards,
 *     `feat/097-migration-sql-boundary` +15 shards, and
 *     `feat/073-off-state-coverage-ratchet` +1 check script.
 *   - **`check-singleton-identity`** 3904 -> 4150 walks all of `backend/`, so it
 *     takes both the module growth and every test merge above.
 *
 * **Five `sites` numbers are pinned to a single merge and are the ones to read
 * if this record is doubted**, each measured per file rather than reasoned
 * about:
 *
 *   - `check-admin-surface` 2158 -> 2159 and `check-module-boundary`
 *     11125 -> 11129: `feat/080-permission-dependencies` adds one import to
 *     `admin_users`' `src/admin/pages/AdminRolesPage.tsx` (+1 to both), and
 *     `fix/port-catches-promise-form` adds three more module imports (+3 to the
 *     second). Both records were written on branches that `master` had already
 *     moved past — the shape this file's P4b note describes — so neither is
 *     growth those branches could have seen.
 *   - `check-default-language-prose` 29646 -> 31619: +1796 from 089-unopim,
 *     +174 from batch 16, and **+3** from `feat/080-permission-dependencies`,
 *     the last measured with `analyzeSource` over each changed file and landing
 *     entirely in `quote_requests/src/manifest.ts` (84 -> 87 classified
 *     literals).
 *   - `check-platform-surface` 1670 -> 1742: +64 from 089-unopim, then exactly
 *     +8 from the two `check:port-catches` repair merges — four platform symbol
 *     reaches each, all of them `rethrowIfModuleDisabled`.
 *   - `check-fixture-substitution` 533 -> 567: +32 from 089-unopim, +1 from
 *     batch 16, and +1 from `fix/product-feeds-port-catches`, whose
 *     `credentials-off-delivery.test.ts` is the file that started reading the
 *     database.
 *
 * **`check-port-catches` 168 -> 196 is the one number that cannot be decomposed
 * exactly, and it is recorded as explained rather than as measured.** The +28 is
 * `089-unopim-pim-sync`'s, and `5253b3ea2` said so in this file when it declined
 * to re-record: it kept 168 = 162 + 6 so that the inherited drift would stay
 * visible to whoever owned it. Measured with the analyzer of the day, that merge
 * moved the site count 162 -> 193; the remaining three sites are the interaction
 * between that growth and the promise-form widening's own renames, which were
 * measured against a different base. The cause is not in doubt; the split
 * between two changes that overlap in the same files is not recoverable from
 * either measurement, and inventing one would be worse than saying so.
 *
 * Everything else is one of the three merges named at the top, seen through a
 * narrower filter. Every `sources=` token reconciles in full on every entry, on
 * all four checkpoints, which is the evidence that this is growth and not a walk
 * that stopped looking. No band was widened and no assertion moved.
 */
/**
 * **Re-recorded 2026-09-03 by `feat/096-block-names-live`, for 25 fields across
 * 20 entries** — every one of them the arithmetic of that branch's own files:
 * five rename migrations, `page-builder-core`'s `migration/` and `palette.ts`,
 * `cms`' `block-names` CLI command and this check estate's newest member. No
 * predicate widened; the walks are reading the same trees with more files in
 * them.
 *
 * **Which entries were re-recorded was measured on two trees, never by
 * parking.** The same test was run against a **detached worktree of
 * `origin/master`** and against the branch, and the two drift reports were
 * differenced: 11 entries drift on `master` at `4ac598c6b`, the *same* 11 drift
 * on the branch, and **not one entry moves from *agree* into *drift* because of
 * this branch**. So those 11 are deliberately left alone — absorbing somebody
 * else's stale record into this merge request is how a number comes to describe
 * neither tree, and it would take the signal away from whoever owns it. The 20
 * below are the entries that *do* agree on the merged tree, which is the whole
 * of what a record is for.
 *
 * **Parking would have lied about two of them, and that is now written down**
 * (`master`'s own `docs(register)` commit of the same day): `check:naming` and
 * `check:language` take their population from `git ls-files --cached --others`,
 * and `--cached` answers from the **index**, so a file that has been committed
 * stays in the list after it is moved off disk — the delta reads zero and the
 * run counts a path it did not open. Measured against the detached baseline
 * instead, this branch adds +26 files to `check:naming` and +23 to
 * `check:language`, both entirely inside the +21 each was already drifting by.
 *
 * ## F7 — `endora new storefront` (2026-09-03)
 *
 * **Eight entries re-recorded, and three deliberately left drifting.** The
 * separation was measured on two trees rather than reasoned about: the same test
 * was run in a **detached worktree of `origin/master`** at `83c66ecbb` and on the
 * branch, and the two drift reports were differenced. `master` itself drifts on
 * `check-doc-snippets` (sites 11 -> 12, files 1102 -> 1115), `check-lock-claims`
 * (sites 14 -> 15, files 226 -> 241) and `check-diacritic-folds`' **sites**
 * (489 -> 492). This branch touches nothing under `docs/`, `specs/` or the
 * ledgers, so the first two are not its to absorb — taking them would put a
 * number in this file that describes neither tree and would remove the signal
 * from whoever owns it.
 *
 * The third overlaps, and is recorded at the branch's own reading (497) with the
 * overlap named in place. `recorded + my delta` would have written 494, a number
 * no tree reads, and would have carried `master`'s three sites forward
 * indefinitely.
 *
 * **Parking was invalid for two of these and the reason is now twice measured.**
 * `check:naming` and `check:language` take their population from
 * `git ls-files --cached --others`; `--cached` answers from the index, so a file
 * that has been committed stays in the list whatever happens to it on disk, and a
 * delta taken by moving files aside on the branch reads zero. Both are measured
 * against the detached baseline instead.
 *
 * ## Feature 104 §§ 1.5–1.6 — the scaffold's registry (2026-09-04)
 *
 * **Four entries re-recorded, three deliberately left drifting**, on F7's
 * separation and by the same method: the drift report named seven, and each of
 * the seven checks was then run twice — once on the branch, once with the two
 * files this branch **adds** parked off disk — so what is mine is a measurement
 * rather than an inference. It adds
 * `packages/cli/src/new-storefront/npmrc.ts` and one changeset, and edits
 * nothing else that any of these seven walks counts.
 *
 * `check-lock-claims` (sites 14 -> 15, files 226 -> 240), `check-rsc-discipline`
 * (sites 86 -> 90, files 332 -> 334) and `check-doc-snippets` (files
 * 1186 -> 1209) read **the same numbers with and without this branch's files**.
 * They are `master`'s: 267 files were added to it between the last re-record and
 * this branch's base, by merges that did not come back for these entries.
 * Absorbing them here would put this branch's name on somebody else's movement
 * and remove the signal from whoever owns it.
 *
 * **Parking is valid for all four re-recorded here, including the two shell
 * checks**, and the reason is the F7 caveat read precisely rather than repeated:
 * `--cached` answers from the index, so it holds a file that has been
 * *committed*. Both of this branch's files are untracked at the moment of
 * measurement, so `--cached` never held them and `--others` stops listing them
 * the moment they leave the disk — the delta is real. A branch parking a file it
 * has already committed still needs the detached baseline.
 */
/**
 * **Re-recorded on 2026-09-05, thirteen numbers over twelve entries, and the
 * attribution was measured rather than assumed** (`specs/107-override-report-and-ladder/`).
 *
 * The drift report named twelve entries on this branch. Running it again in a
 * **detached worktree at `origin/master`** — the baseline this branch was rebased
 * onto — named three, at +14 files each:
 * `check-doc-snippets`, `check-nul-bytes` and `check-naming.sh`. That +14 is
 * `master`'s own, from the twenty-one merges that landed while this branch was
 * open, and it is re-recorded here because the record has to describe the tree;
 * it is not this branch's growth and nothing in it is this branch's to explain.
 *
 * What **is** this branch's, measured as the difference between the two runs:
 *
 *  - `check-overlay-determinism` **+3 files** — the three `.md` renderings of the
 *    divergence report join `coveredArtifactPaths()`. One derivation emits two
 *    files (FR-015), and both are byte-compared: a `.md` outside the gate would
 *    be the one artefact of the pair free to drift, and the one a human reads.
 *  - `check-nul-bytes` **+9**, `check-naming.sh` **+9**, `check-language.sh`
 *    **+4**, `check-singleton-identity` **+3** — the branch's net file count
 *    (17 added, 8 deleted, the changeset among them) arriving in each whole-tree
 *    walk at the size of the subtree it covers.
 *
 * **Measure on a clean tree, and `pnpm --filter docs run build` does not leave
 * one.** Taken with the site built, `check-nul-bytes` read **+78**: the 77
 * module documentation pages the build copies into `docs/docs/modules/` are
 * git-ignored, so they are absent from a fresh checkout and from CI, and
 * recording that number would have raised the ceiling by a population no
 * pipeline holds. `git clean -fdX docs/` before the census.
 *  - `check-doc-snippets` **+2** and `check-module-docs` **+1** — the
 *    customisation-ladder page, and `specs/107-…/tasks.md` for the first of the
 *    two.
 *  - `check-default-language-prose` **+96 sites**, `check-diacritic-folds`
 *    **+2 sites**, `check-fixture-substitution` **+1 site**,
 *    `check-lock-claims` **+1 file** — the new sources being classified. The
 *    prose check's site count is per **literal**, so a check and a generator
 *    carrying this much English prose move it by two figures without moving any
 *    finding.
 *  - `check-diacritic-folds` **-1 file** and `check-test-ownership` **-1** — the
 *    three superseded `test/overlay/` files leaving, against the one that
 *    replaces them.
 *
 * The lesson, which is feature 095's own and is worth writing down where the
 * next author meets it: a re-recorded value is a measurement of *this branch
 * against a base*, so a rebase invalidates it without touching a line anyone
 * wrote — and a census run only on the branch cannot tell the branch's growth
 * from the base's. Both runs, or neither.
 *
 * ## 2026-09-05 — `specs/109-backend-test-kit/` Phase 1b: the kit package
 *
 * Nine entries, and they are two movements in opposite directions that happen to
 * land in one merge request. **A new workspace package arrives**
 * (`packages/test-kit`, 14 source and test files plus its manifest, tsconfigs
 * and two vitest configurations), and **two files leave `backend/test`** —
 * `run-isolation.ts` and `run-isolation-provision.ts` become the kit's
 * `./database`, which is T022.
 *
 *  - **whole-repository walks gain the package.** `check-nul-bytes` 7656 ->
 *    7674 and `check-naming.sh` 7716 -> 7734 (**+18** each: every file the
 *    package adds, the changeset among them); `check-language.sh` 5775 -> 5789
 *    and `check-diacritic-folds` 5246 -> 5260 (**+14** each — those two walk
 *    source rather than everything, so the manifest, the lockfile delta and the
 *    changeset are outside them).
 *  - **`backend/test` walks lose the two moved files.**
 *    `check-fixture-substitution`, `check-harness-teardown` and
 *    `check-shared-table-wipes` all read 1561 -> **1559**, which is the same
 *    population measured by three checks and is why the three move together.
 *    `check-singleton-identity` 4299 -> **4297** walks all of `backend/` and
 *    sees the same two.
 *  - **sites move where the moved code carried them.**
 *    `check-fixture-substitution` 557 -> **555** (the `rowCount` existence probe
 *    in `run-isolation-provision.ts`, whose ledger entry retires with it — see
 *    that check's own note) and `check-diacritic-folds` 524 -> **522**. Both are
 *    site counts falling while a file count elsewhere rises, which is the
 *    #235/#237 shape and the reason both numbers are recorded.
 *  - **`check-release-intent` +1 and +1**, as its own note predicts: a merge
 *    request adding a changeset moves its file count by one, and the new package
 *    moves its site count by one.
 *  - **+1 more on the two whole-repository walks**, `check-nul-bytes` 7674 ->
 *    **7675** and `check-naming.sh` 7734 -> **7735**, for the package's
 *    `README.md`. It is recorded as its own line rather than folded into the +18
 *    above because it was measured in a second census after the first: a file
 *    added between two runs is exactly the drift this report exists to name, and
 *    writing it as though one census had seen it would be tidying the record.
 *
 * `check-test-ownership` does **not** move, which is worth stating because it
 * looks as though it should: its population is `backend/test/**` plus the module
 * walk roots, and the kit is neither a module package nor under `backend/test`.
 * Its `package-test-scripts` author counts module packages, so 56/56 stands.
 *
 * ## 2026-09-06 — the storefront stops inventing `http://localhost:3001`
 *
 * Five entries, and **only two of them are this branch's** — which is the whole
 * reason the drift report exists and is why the split is written down rather
 * than folded into one number. The branch adds four files
 * (`storefront/lib/env.mjs`, `storefront/instrumentation.ts` and two tests) and
 * deletes none; every other change it makes is to a file that already existed.
 * The attribution was **measured, not inferred**: each of the five checks was run
 * twice in one tree, once with the four files in place and once with them moved
 * aside.
 *
 *  - **`check-nul-bytes` 7757 -> 7767**, of which **+4** is this branch's (7763
 *    without the four files, 7767 with) and **+6** is `master`'s.
 *  - **`check-diacritic-folds` 5291 -> 5294**, all **+3** this branch's. Three and
 *    not four because this walk reads `.ts`/`.tsx`/`.js` and the seam is `.mjs`.
 *    That asymmetry against its whole-repository neighbour is the useful part of
 *    the record.
 *  - **`check-doc-snippets` 1255 -> 1261**, **`check-naming.sh` 7817 -> 7827** and
 *    **`check-language.sh` 5829 -> 5833** — **none of it this branch's**, and each
 *    measured as unchanged by parking the four files. `check-naming.sh` and
 *    `check-language.sh` exclude `storefront/`; `check-doc-snippets` reads
 *    `docs/docs` and `specs`. They are re-recorded here anyway, because the census
 *    prints on a green run precisely so that staleness is repaired by whoever sees
 *    it rather than inherited by whoever comes next.
 *
 * The seam being `.mjs` is itself a measurement and not a preference:
 * `storefront/next.config.js` is loaded by Node, which cannot import TypeScript,
 * and `next.config.ts` was tried and reverted — Next's TS-config loader resolves
 * `typescript` from the instance, which a scaffolded client storefront does not
 * have, so the `endora new storefront` criterion went red on A5 with
 * `MODULE_NOT_FOUND` and A6 had no build to boot.
 */
/**
 * **Re-recorded on 2026-09-08 by `specs/110-instance-repository/` T118 —
 * eighteen entries, every one of them `+1`, and the +1 is one file.**
 *
 * The branch adds exactly one source file,
 * `packages/platform/src/kernel/i18n/error-envelope-options.ts`, and modifies
 * seven. That single addition is the whole of the movement, and the arithmetic
 * closes by root, which is how to check this record:
 *
 *   - a **whole-tree** walk gains 2 — the source file and this row's own
 *     changeset: `check-nul-bytes` 8089 -> 8091 and `check-naming.sh`
 *     8149 -> 8151. `check-diacritic-folds` 5467 -> 5468 and `check-language.sh`
 *     6091 -> 6092 gain only 1, being the same arithmetic without the
 *     changeset, which is the file that is easy to forget because it is written
 *     last, after the numbers have been read;
 *   - a walk whose roots **include the platform's own sources** gains 1 — the
 *     platform is one of the packages `layout.sourceRoots` produces: the family
 *     at 2148 -> 2149 (`check-kernel-boundary`, `check-channel-resolution`,
 *     `check-entity-tenant-classification`, `check-entry-presence`,
 *     `check-entry-scope`, `check-port-catches`, `check-subscribe-seam` and
 *     `check-transaction-context`), plus `check-action-route-permissions`
 *     2021 -> 2022, `check-divergence` 2282 -> 2283, `check-env-inputs`
 *     698 -> 699, `check-module-boundary` 4866 -> 4867 and
 *     `check-singleton-identity` 4490 -> 4491;
 *   - a walk over **module sources only** does not move at all, which is the
 *     fact that makes the attribution provable rather than argued:
 *     `check-command-coverage`, `check-container-imports` and
 *     `check-port-dependencies` all agree, because the new file is the
 *     platform's and no module's.
 *
 * Two `sites` numbers move and each is exactly one site, from a different
 * commit of the same branch. `check-kernel-boundary` 30 -> 31 is the new file's
 * own `@endora-commerce/contracts` import — a platform outward import, which is
 * that check's third population. `check-port-shape` 721 -> 722 is the *first*
 * commit's: `OrganizationTaxProfilePort` moved out of
 * `organizations`' `./backend` into `@endora-commerce/contracts`, and a
 * published container name is a site there. Its `files` does not move, the
 * declaration having been counted at its old address too.
 *
 * `check-platform-surface` is **not** in this list and that is worth stating,
 * because it reads the platform and would be the first place to look: its
 * recorded `files` already covers the tree the new file joined, so the entry
 * agrees on this branch and re-recording it would have filed a number that did
 * not move.
 */
/**
 * **Re-recorded on 2026-09-09 by `specs/110-instance-repository/` T118c, the
 * `assets_library` drain — twenty-nine entries over four new files.** The
 * arithmetic closes by root, which is how to check this record:
 *
 *   - `packages/modules/cms/src/backend/services/asset-embed-resolver.ts` — a
 *     **module source**, so every module walk gains 1: `check-action-route-permissions`,
 *     `check-block-names`, `check-channel-resolution`, `check-command-coverage`,
 *     `check-entity-tenant-classification`, `check-entry-presence`,
 *     `check-entry-scope`, `check-kernel-boundary`, `check-subscribe-seam`,
 *     `check-transaction-context`, and the `files` half of `check-port-catches`,
 *     `check-default-language-prose`, `check-port-dependencies`,
 *     `check-port-shape` and `check-platform-surface`;
 *   - its co-located test beside it, so the four walks that read a package's tests
 *     as well gain **2**: `check-admin-zones`, `check-class-vocabulary`,
 *     `check-container-imports`, `check-divergence`;
 *   - `backend/test/contract/cms/storefront-asset-embed.contract.test.ts`, so the
 *     three `backend/test/**` walks gain 1: `check-fixture-substitution`,
 *     `check-harness-teardown`, `check-shared-table-wipes`;
 *   - the whole-tree walks gain **3** or **4** depending on the changeset:
 *     `check-nul-bytes` and `check-naming.sh` take it, `check-diacritic-folds`
 *     (`.ts`/`.tsx`/`.js` only) and `check-language.sh` (markdown half is
 *     `docs/docs/**`) do not;
 *   - `check-module-boundary` gains **4** for two files, measured by parking them:
 *     that walk reaches a module package's sources under more than one root.
 *
 * **Six `sites` numbers move and every one of them is code that already existed.**
 * The `cmsAssetResolver` closure was in `backend/src/composition.ts`, which no
 * module walk reads; it is now in a module, so `check-port-catches` 212 -> 213
 * (its `catch`), `check-port-dependencies` 1551 -> 1552 and `check-port-shape`
 * 722 -> 723 (the `lazyPort` resolution), `check-platform-surface` 1870 -> 1871
 * (its `rethrowIfModuleDisabled` import), `check-default-language-prose`
 * 34428 -> 34429 and `check-module-boundary` 12551 -> 12560 all count it for the
 * first time rather than gaining anything new.
 *
 * **This census is the third shape this branch produced, and the two facts that
 * moved it are worth more than the numbers.** (1) The test was first written at
 * `backend/test/unit/cms/asset-embed-resolver.test.ts`, where `check:test-ownership`
 * refused it as `misplaced-test`; moving it into the package turned four
 * `backend/test/**` entries into six module-walk ones. (2) The resolver was then
 * extracted from `backend/index.ts` into a service file, so that its test would not
 * have to compose a container — a module test naming
 * `@endora-commerce/platform/composition`, which is a host-internal subpath and
 * which `check:platform-surface` cannot refuse there because
 * `collectPlatformSurfaceSources` drops `.test.ts`. That extraction is what put a
 * **module source** in the diff, which is the whole of why fifteen module walks are
 * in this list and none was in the first census.
 *
 * **And the two shell entries were measured on the *staged* tree, deliberately.**
 * `list_files` is `git ls-files --cached --others --exclude-standard`, so the
 * index is part of the population: with the abandoned test path deleted from disk
 * but still in the index, `check-naming.sh` read 8188 rather than 8187. A recorded
 * value that depends on what is staged is one nobody can reproduce, so stage the
 * change before reading these two.
 */
/**
 * **Re-recorded on 2026-09-10 by `specs/110-instance-repository/` T118c, the `mfa`
 * drain — twenty-nine entries over three new files, and the shape they were read
 * in is part of the record.**
 *
 * **The tree shape: `pnpm install` plus `pnpm run build:packages`, and no
 * `composer:generate`.** That is the `quality` job's shape and it is not the same
 * as a developer's: `composer:generate` places ~77 module pages under
 * `docs/docs/modules/`, which `check-nul-bytes` and `check-language.sh` would open,
 * and every package's `dist` is git-ignored and read by `check-nul-bytes` all the
 * same, so a tree that has not built the packages reads a different number from
 * the one CI reads. Measured here with `docs/docs/modules/` holding its three
 * committed entries and every package built. The two shell entries were read on
 * the **staged** tree, for the reason the block above gives.
 *
 * The arithmetic closes by file, which is how to check this record. Three files
 * arrive and one of them is a module source, so the census is the
 * `assets_library` one minus its fourth file:
 *
 *   - `packages/modules/mfa/src/backend/services/account-identity.ts` — a **module
 *     source**, so every module walk gains 1: `check-action-route-permissions`,
 *     `check-block-names`, `check-channel-resolution`, `check-command-coverage`,
 *     `check-entity-tenant-classification`, `check-entry-presence`,
 *     `check-entry-scope`, `check-kernel-boundary`, `check-subscribe-seam`,
 *     `check-transaction-context`, and the `files` half of `check-port-catches`,
 *     `check-platform-surface`, `check-default-language-prose`,
 *     `check-port-dependencies` and `check-port-shape`;
 *   - its co-located test beside it, so the four walks that open a package's tests
 *     gain **2**: `check-admin-zones`, `check-class-vocabulary`,
 *     `check-container-imports`, `check-divergence`;
 *   - `backend/test/integration/mfa/account-identity-wiring.test.ts`, so the three
 *     `backend/test/**` walks gain 1: `check-fixture-substitution`,
 *     `check-harness-teardown`, `check-shared-table-wipes`;
 *   - `check-test-ownership` gains **2** — the co-located test and the backend one —
 *     and `check-singleton-identity` **3**, all three files;
 *   - the four whole-tree walks gain **3** for the three `.ts` files, and the two
 *     that read every extension gain a **fourth** for this merge request's own
 *     changeset: `check-nul-bytes` 8132 -> 8136 and `check-naming.sh`
 *     8192 -> 8196, against `check-diacritic-folds` (`.ts`/`.tsx`/`.js`) and
 *     `check-language.sh` (markdown half is `docs/docs/**`) at +3. Both were first
 *     recorded at +3 and re-measured after the changeset was written, which is the
 *     trap the `assets_library` census names: the changeset is a file this walk
 *     opens like any other, and it is the last one a drain writes.
 *   - `check-module-boundary` gains **4** for two files, the same reason that census
 *     gives: the walk reaches a module package's sources under more than one root,
 *     and the backend test is outside its population.
 *
 * **Four `sites` numbers move and three of them are the drain itself.**
 * `check-port-dependencies` 1558 -> 1564 is **net**: seven resolutions arrive in
 * `mfa`'s registration — four `lazyPort` reads and three contributed-name reads —
 * against the one `mfaActorBridge` cradle read that goes. `check-port-shape`
 * 728 -> 732 counts the four `lazyPort<T>` calls and not the three cradle reads,
 * which are contributed names rather than ports. `check-module-boundary`
 * 12569 -> 12575 and `check-default-language-prose` 34470 -> 34477 are the
 * specifiers and the literals the two new module files write.
 *
 * **`check-port-catches`' `sites` deliberately did not move, and that is an
 * assertion rather than an absence.** The drain puts four port reaches into a
 * module source and wraps none of them: on an authentication path, a `catch` that
 * read `ModuleDisabledError` as "this account has no e-mail" or "the password does
 * not match" is the fail-open the composition checklist's item 7 refuses. A
 * `sites` that had moved here would mean somebody wrote one.
 */
/**
 * **Re-recorded on 2026-09-11 by `review/119-infakt-adaptations`, 58 fields across
 * 39 entries — the whole of feature 119's growth, measured on one tree.**
 *
 * The drift census read `39 drifted, 5 agree, 0 not measured, of 44 recorded`
 * before this sweep and `0 drifted` after it. Every number is growth: the
 * `sources=` token of every one of the 39 reconciles in full, which is the
 * evidence that these are walks reading the same trees with more files in them
 * rather than walks that stopped looking. **No band was widened and no
 * assertion moved.**
 *
 * **One cause covers nearly all of it.** `feat/119-infakt-integration` adds two
 * module packages — `invoice_ledger` (the shared ledger rails) and `infakt` (the
 * vendor adapter) — each with backend sources, an admin layer, an `i18n/` pair,
 * a `docs/` page and co-located tests. That is one population arriving in
 * thirty-nine checks, seen through each one's own filter:
 *
 *   - a **module `.ts` walk** gains **45**: `check-channel-resolution`,
 *     `check-entity-tenant-classification`, `check-entry-presence`,
 *     `check-entry-scope`, `check-kernel-boundary`, `check-port-catches`,
 *     `check-subscribe-seam` and `check-transaction-context` all move
 *     2131 -> 2176, and `check-port-dependencies` 1951 -> 1996 on its own
 *     narrower root;
 *   - a walk over module `.ts` **and** `.tsx` gains more, because both packages
 *     ship an admin layer: `check-platform-surface` 2429 -> 2479 and
 *     `check-block-names` 2100 -> 2150 at +50, `check-port-shape`
 *     2050 -> 2097 at +47, `check-action-route-permissions` 2004 -> 2044 at +40;
 *   - a walk that also opens a package's **tests** gains 57–64:
 *     `check-container-imports` 2213 -> 2270 and `check-divergence`
 *     2392 -> 2449, `check-admin-zones` 2743 -> 2807 and
 *     `check-class-vocabulary` 2841 -> 2905 on the wider roots;
 *   - a **whole-tree** walk gains 97–132: `check-nul-bytes` 8153 -> 8285 and
 *     `check-naming.sh` 8213 -> 8345 read every extension, so they also count
 *     the two packages' JSON bundles, their manifests and this branch's own
 *     changeset; `check-language.sh` 6123 -> 6226 and `check-diacritic-folds`
 *     5492 -> 5589 are the same walk minus the roots each excludes;
 *   - the **small** populations move by exactly what arrived and are the easiest
 *     to check: `check-bundle-pairing` and `check-error-translations` 130 -> 134,
 *     two modules × two shipped languages; `check-module-docs` 106 -> 108, one
 *     page each; `check-overlay-determinism` and `check-release-intent` 87 -> 89,
 *     two workspace members; `check-lock-claims` 308 -> 312, two manifests plus
 *     the two files `packages/contracts/src/index.ts` now re-exports.
 *
 * **Three numbers are this adaptation branch's own, and they are the ones to
 * read if the record is ever doubted**, because each is a file moving between
 * two populations rather than a file arriving:
 *
 *   - the three `backend/test/**` walks — `check-fixture-substitution`,
 *     `check-harness-teardown` and `check-shared-table-wipes` — move
 *     1590 -> 1620, which is **+30 and not +39**. The feature adds 39 backend
 *     test files; this branch moves **9** of them into the packages that own
 *     their subjects, which is what `check:test-ownership` was red about, so
 *     thirty is what is left under `backend/test`.
 *   - `check-test-ownership` itself moves 1711 -> 1750 and its `sites` do not
 *     move at all. Its population is application **and** packages, so the same
 *     nine files are in it before and after: the move is net zero there by
 *     construction, which is the cross-check on the paragraph above.
 *   - `check-singleton-identity` moves `files` 4517 -> 4611 and its **`sites`
 *     stay at 869**, which they would not have done without the move. Its sites
 *     are value reaches into a module package's *source* by filesystem path, and
 *     the nine moved files held fifteen of them
 *     (`../../../../packages/modules/<id>/src/...`). Rewritten as relative
 *     specifiers inside the package, those reaches leave the population
 *     entirely — the same shape D-168's repair note records one check over.
 *
 * **Two `sites` numbers are the feature's own declarations rather than its
 * files**, and are worth naming because a reviewer can count them.
 * `check-off-state-coverage` 202 -> 205 is measured per call and decomposes
 * exactly: two `expectModuleAbsent` sites — the `infakt` and `invoice_ledger`
 * off-state files — plus one `withModuleOff` in
 * `backend/test/contract/infakt/webhook.test.ts`. Both spellings are in that
 * check's walk and only the first is in its finding population, which is why
 * the site total moves by three where the coverage answer moves by two. And
 * `check-entity-tenant-classification` 260 -> 265 is the five entity classes
 * `invoice_ledger` owns; `infakt` owns none, which is why its `./backend`
 * barrel publishes an empty `entities` array.
 *
 * Everything else is the two packages seen through a narrower filter. The
 * measurement was taken in the shape the `quality` job runs in — the generated
 * module-documentation copies cleaned and `docs/.module-docs-copies.json`
 * removed — because those copies are in `check-nul-bytes`' and
 * `check-naming.sh`' walks and a working tree that has built the docs site reads
 * seventy-nine files more than CI does.
 * **Re-recorded on 2026-09-11 by `specs/110-instance-repository/` T140 — ten
 * entries, all of them this merge request's own, all of them `files`.**
 *
 * The change adds four files and deletes none: the `endora new instance`
 * acceptance criterion (`backend/scripts/acceptance/instance.ts`), its
 * judgement (`instance-assertions.ts` beside it), its recorded expectation
 * (`backend/acceptance/instance-expected-state.json`) and its unit test
 * (`backend/test/unit/acceptance/instance-assertions.test.ts`). It adds no
 * `check-*` script, so no entry arrives and no `sites` number moves anywhere.
 *
 * The ten movements are that arithmetic seen through each walk's own
 * population, and reading them by extension and root is how to check them:
 *
 *   - **the whole tree, JSON included** gains all four — `check-nul-bytes`
 *     8157 -> 8161 and `check-naming.sh` 8217 -> 8221. There is no changeset in
 *     that four, which is the file a row is usually apt to forget: `backend` is
 *     in the changesets `ignore` list, so a merge request touching only it
 *     carries none;
 *   - **the whole tree minus JSON** gains three — `check-language.sh`
 *     6126 -> 6129;
 *   - **the application tree including `backend/test/**`** gains three —
 *     `check-singleton-identity` 4519 -> 4522;
 *   - **the application tree excluding the tests** gains two, the criterion and
 *     its judgement — `check-platform-surface` 2429 -> 2431;
 *   - **`backend/test/**` alone** gains one, the unit test —
 *     `check-fixture-substitution`, `check-harness-teardown`,
 *     `check-shared-table-wipes` (all 1592 -> 1593) and `check-test-ownership`
 *     (1712 -> 1713);
 *   - **`check-diacritic-folds`** gains one for a reason worth stating, because
 *     it is the only entry whose number does not fall out of the two clauses
 *     above: its walk is the whole tree **minus `backend/scripts` and
 *     `backend/test/unit/scripts`**, whose job is to spell the shapes it
 *     refuses. So neither of the two new script files is in its population and
 *     the unit test is the whole of its +1, 5494 -> 5495.
 *
 * Every entry was in agreement at the branch point, so there is nothing here
 * belonging to another merge request and nothing apportioned.
 *
 * ## 2026-09-11 — the `linked` group is derived, and three entries this author owed
 *
 * Five entries, **all of them this author's and only two of them this branch's**,
 * which is why the split is written down rather than folded into one number.
 *
 *   - **This branch's two are `sites`, not `files`**, because it adds no file: it
 *     rewrites `test/unit/release/changeset-flow.test.ts` to read the `linked`
 *     group out of `.changeset/config.json` instead of naming three of its four
 *     members. `check-fixture-substitution` 582 -> **583** for the
 *     `manifests.find(...)` the derivation uses — `find` is in that check's read
 *     vocabulary, and the site is correctly **not** a violation because its
 *     fallback is a `throw` rather than a fabricated value — and
 *     `check-diacritic-folds` 545 -> **546** for the `.replace()` that strips the
 *     scope off a package name, its `sites` being `replaceSites`. Both are
 *     populations growing by one real construct, which is the ordinary
 *     re-record.
 *   - **The other three are `specs/114-release-shape-gate/tasks.md`**, landed in
 *     !1583 by this author without a census: `check-nul-bytes` 8161 -> **8162**
 *     and `check-naming.sh` 8221 -> **8222**, the two whole-tree walks, and
 *     `check-doc-snippets` 1284 -> **1285**, whose population is `docs/docs` plus
 *     `specs`. One file, three walks, +1 each. They are re-recorded here rather
 *     than left for the next branch to discover, which is what this report is
 *     for.
 *
 * **Measured in a pristine worktree, and that is the point of this entry.** The
 * same census run in this author's working checkout reported `check-nul-bytes`
 * at **8166** — eight files high, none of them tracked: two
 * `admin/vite.config.ts.timestamp-*.mjs`, four `.env` files,
 * `storefront/tsconfig.tsbuildinfo`, and a stale `packages/api-client/` directory
 * left behind by the package D-202 deleted. That check reads git-ignored files by
 * design, so a whole-tree walk measured in a working checkout reads high by
 * whatever that checkout happens to be carrying — and recording 8166 would have
 * put one developer's local residue into the shared record, where every CI run
 * afterwards reports drift against a number no clean tree can produce. It is the
 * `docs/docs/modules` trap in a second costume: the tree shape is not only the
 * module doc copies, it is everything ignored.
 */
/**
 * **Catch-up merge of `origin/master` into `feat/119-infakt-integration`, 2026-09-11
 * — thirteen fields across eleven entries, none of them new work.**
 *
 * The two blocks above are the two sides of this merge and both are true of the
 * merged tree: feature 119's two module packages arrived on one side while
 * `specs/110-instance-repository/` T140 and !1583 arrived on the other, and no
 * entry's recorded value described the union. Every number below was
 * **re-measured on the merged tree**; none was summed from the two sides'
 * deltas, and no band was widened.
 *
 * **The attribution is a measurement rather than an arithmetic.** With the five
 * files the master side adds withdrawn from the tree — the acceptance criterion,
 * its judgement, its recorded expectation, its unit test and
 * `specs/114-release-shape-gate/tasks.md` — and its edit to
 * `test/unit/release/changeset-flow.test.ts` reverted, all nine affected
 * TypeScript checks read back the branch's own recorded value exactly: 8289,
 * 5591/547, 1302, 1622/586, 1622, 1622, 1751, 2479, 4613. So the two sides'
 * populations are disjoint here and nothing is double-counted. That the observed
 * deltas then match `master`'s own recorded deltas file for file is a
 * cross-check on the record, not the method that produced it.
 *
 * **`check:naming` and `check:language` are the two the parking method cannot
 * reach**, and they are measured after **staging** the resolution instead. Their
 * population is `git ls-files --cached --others --exclude-standard` — the index,
 * not the disk — so withdrawing a staged file leaves it listed, and during an
 * unresolved merge a conflicted path is listed once per stage, which reads two
 * high. Measured staged: 8354 and 6232.
 */
/**
 * **2026-09-11 — `AGENTS.md` becomes a router: fourteen files, ten entries, no
 * new work.**
 *
 * The branch moves prose. It adds **fourteen** tracked files and deletes none:
 * twelve markdown documents under `specs/conventions/`, which is where the
 * bodies `AGENTS.md` used to inline now live, plus
 * `backend/test/helpers/agents-router.ts` and
 * `backend/test/unit/docs/agents-router.test.ts`, the ratchet that holds the
 * shape. Every number below falls out of which of those fourteen a walk can
 * see, and each was **measured** on the tree rather than summed from a delta.
 *
 *   - **The two whole-tree walks take all fourteen** — `check-nul-bytes`
 *     8087 -> **8101** and `check-naming.sh` 8147 -> **8161**. Those two are the
 *     **only** numbers in this block that moved when the branch caught up with
 *     `origin/master` at `86fea9052`, and what moved them was not this branch:
 *     it recorded 8171 -> 8185 and 8231 -> 8245 against its own branch point,
 *     and then `release/version-0.8.0` consumed all 85 remaining changesets,
 *     taking 85 files out of both whole-tree populations. The delta is the same
 *     fourteen on either side of that; the base is not. Re-measured on the
 *     merged tree after the resolution was committed and with `git status`
 *     empty, which for `check-naming.sh` is mandatory rather than tidy — it
 *     reads `git ls-files --cached`, the index, where a conflicted path is
 *     listed once per stage.
 *   - **`check-doc-snippets` takes the twelve documents**, 1303 -> **1315**: its
 *     roots are `docs/docs` and `specs`, and `specs/conventions/` is under the
 *     second. Its `sites` also moves, 12 -> **13**, and that one is worth a
 *     sentence because it is not a file count. `sites` is the documents that
 *     *enrol* by carrying the `verbatim-from:` hint anywhere in their text, and
 *     `check-inventory.md` — the routed home of this estate's own inventory
 *     table — carries the marker inside its `check:doc-snippets` row, as a
 *     backticked example of the syntax. The row said the same words in
 *     `AGENTS.md` and enrolled nothing, because `AGENTS.md` is under neither
 *     root. The enrolment is harmless and stable: `MARKER` is anchored to a
 *     whole trimmed line, the example sits mid-row inside a table cell, so the
 *     document is scanned and yields no marker, which is the green it prints.
 *     It is recorded here rather than engineered away, because breaking the
 *     literal would corrupt the row that documents the syntax.
 *   - **`check-language.sh` takes the two TypeScript files**, 6238 -> **6240**:
 *     markdown is in neither of its two populations — its source scan is keyed on
 *     source-code extensions and its prose scan on `docs/docs/**` — so the twelve
 *     documents are invisible to it. That asymmetry with `check-naming.sh`, which
 *     walks the same `git ls-files` listing and takes all fourteen, is the whole
 *     difference between the two and is why neither number can be inferred from
 *     the other.
 *   - **The `backend/test/**` walks take the two**, one file each of helper and
 *     test — `check-fixture-substitution`, `check-harness-teardown` and
 *     `check-shared-table-wipes`, all 1623 -> **1625** — except
 *     `check-test-ownership`, 1754 -> **1755**, whose population is the test
 *     files rather than everything under that root, so the helper is not in it.
 *   - **`check-singleton-identity`** 4621 -> **4623**, the two new files being
 *     under a walked root.
 *   - **`check-diacritic-folds`** moves on both axes and neither is the twelve
 *     documents: its walk is the whole tree minus `backend/scripts` and
 *     `backend/test/unit/scripts`, and it reads source rather than markdown, so
 *     `files` 5597 -> **5599** is the two TypeScript files alone. `sites`
 *     548 -> **554** is the six `.replace()` calls the two of them contain —
 *     heading normalisation strips backticks and emphasis, collapses whitespace
 *     and drops the leading hashes, and the test does the same to build its
 *     fixtures. None is a slug construction and none is a violation; they are
 *     six more expressions in the population the check examines, which is the
 *     ordinary re-record.
 *
 * **Measured twice in a worktree stood up for this branch and worked in nowhere
 * else** — once against its branch point and once against `86fea9052` after the
 * catch-up merge — with `git clean -fX docs/docs/modules` and
 * `rm -f docs/.module-docs-copies.json` first and `pnpm run build:packages`
 * before anything. The census agreed on all 44 entries at the branch point, which
 * is what makes the deltas above attributable: every one of them is exactly the
 * count of this branch's own files that the walk in question can see, and
 * `check-nul-bytes` — the one walk that reads git-ignored files, and therefore
 * the one that would have absorbed any local residue — moved by precisely the
 * fourteen tracked files and nothing else.
 *
 * **The census was established on the new base before anything was attributed to
 * it**, in a second pristine worktree detached at `86fea9052`: 0 drifted, 44
 * agree, 0 not measured, of 44 recorded. That is what makes the catch-up honest.
 * Of the ten entries this block records, `master` had moved the base of exactly
 * two, and the census over the merged tree then reported exactly those two as
 * drifted and nothing else — a prediction and its measurement, in that order.
 * Neither number is a sum of the two sides' deltas; both were read off the run.
 */
export const RECORDED_READ_SIZES: Readonly<Record<string, RecordedReadSize>> = {
  'backend/scripts/check-action-route-permissions.ts': {
    prefix: '[action-route-permissions]',
    run: { kind: 'tsx', path: 'scripts/check-action-route-permissions.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source
    // (`services/account-identity.ts`). It declares no action, so nothing else moves.
    // **Feature 103 (overlay file shadowing retired): 1884 -> 1883.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go, `claimed-module-ids.ts`
    // arrives.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1883 -> 1935.** 52 module
    // packages gain a `vitest.config.ts`, and its route walk reads a package root.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 1936 -> 1944.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1946 -> 1947.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1947 -> 1949 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 1949 -> 1950 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 1949 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 1952 -> 1958 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 1958 -> 1955.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1955 -> 2014.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 1955 -> 1946.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2014 -> 2004.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2005), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 1955 -> 1962 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The module's route registrations and admin surface, which this walk reads to pair an action with the code its target enforces.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's route registrations and admin surface, which this walk pairs against its manifest actions.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2018 -> 2019.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2021
    // -> 2035 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2036 -> 2047.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2047 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2048 -> 2045 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2045 -> 2046 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2048 -> 2049 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2049 -> 2047. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2047 -> 2020 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2020
    // -> 2021. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2020 -> 2011.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2011 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new
    // `services/notification-context.ts`. No action and no route moved.
    // **`specs/110-instance-repository/` T119b: files 2012 -> 2001 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2001 -> 2002. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2003 rather than the
    // 2014 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2003 -> 1997 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2003 -> 2004 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2004 recorded against the tree before it: 1998. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1998 -> 2000, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2000 -> 2001, the one new module source.
    // No action and no route moved. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2002 -> 2003. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It declares no action, so nothing else
    // moves.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2004 -> 2044.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2046,
    // **Batch 13 (feature 091, Phase 4): +1**, `price_lists`' `open-price-lists`.
    // That module declared no palette action at all, so its hand-written
    // `PALETTE_ITEMS` row becomes a manifest one; `inventory`'s row was a
    // second copy of an action already declared and is simply deleted.
    // **Batch 14 (feature 091, Phase 4): 74 -> 76.** The two manifest actions
    // the batch declares — `organizations`' `open-organizations` and
    // `sales_channels`' `open-sales-channels` — each replacing a hand-written
    // `PALETTE_ITEMS` row the server was never asked about.
    // **Batch 15 (feature 091, Phase 4): 76 -> 79.** `catalog`'s three new
    // palette actions — `open-products`, `open-categories`, `open-attributes` —
    // which are the three hand-written `PALETTE_ITEMS` rows that batch deletes,
    // arriving as declarations the effective enabled-set filters.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 86 -> 88.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 88 -> 90.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 90,
    // `emitted-manifests` is this check saying which artefact its manifest half
    // came from: the manifests are imported rather than walked, and a packaged
    // module's resolves at its build output. It is the disclosure half of the
    // staleness refusal; see `scripts/lib/emitted-freshness.ts`.
    sources: ['manifest-index', 'emitted-manifests'],
  },
  'backend/scripts/check-channel-resolution.ts': {
    prefix: '[channel-resolution]',
    run: { kind: 'tsx', path: 'scripts/check-channel-resolution.ts', args: ['--enforce'] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It resolves no
    // channel and reads no channel-scoped setting.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new
    // `services/notification-context.ts`, which reads `SalesChannel` by id. That is not a
    // request-channel re-resolution and it sits in no storefront surface, so no signal
    // moved; the walk is one file wider.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`).
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-command-coverage.ts': {
    prefix: '[command-coverage]',
    run: { kind: 'tsx', path: 'scripts/check-command-coverage.ts', args: ['--strict'] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. Four port reads
    // and no persistence, so no command site with it.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1467 -> 1470.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1553 -> 1604.** 52 module
    // packages gain a `vitest.config.ts`, less the one module it excludes by argument.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1604 -> 1605.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1605 -> 1607 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 1607 -> 1608 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 1607 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **`specs/115-lifecycle-container-move/` Phase 5: 1607 -> 1613 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1613 -> 1672.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 1672
    // -> 1685 (+13).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files and `taxes`'
    // `vitest.config.ts`; it reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 1685 -> 1697.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1697
    // -> 1698. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It writes
    // nothing.
    // **D-223: files 1700 -> 1701 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1701 -> 1703, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 1703 -> 1704, the one new module source.
    // It writes nothing, so no site moves. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 1705 -> 1706. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It writes nothing.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1707 -> 1750.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 1751,
    sites: null,
    // 64, not 65: this check excludes modules by argument, and the expectation
    // is derived after the exclusion rather than despite it.
    sources: ['manifest-index'],
  },
  'backend/scripts/check-container-imports.ts': {
    prefix: '[container-imports]',
    run: { kind: 'tsx', path: 'scripts/check-container-imports.ts', args: [] },
    // **T118c, `mfaActorBridge`: +2 files** — `mfa`'s new module source and its co-located
    // test. Neither imports the container library.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1714 -> 1717.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1809 -> 2057.** +248 = 196
    // harness-free single-owner test files leave `backend/test/` and land inside the
    // module walk this check reads, plus the 52 new configurations.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2057 -> 2058.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2058 -> 2060 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2060 -> 2061 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2060 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2060 -> 2066 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2066 -> 2150.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+23 is
    // this branch's test move** — the 23 harness-free `pim_akeneo` tests entering the
    // module walk roots from `backend/test/`.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's sources, which this walk opens to refuse a module importing the container library.
    // **`fix/search-reindex-task-timeout`: files 2151 -> 2152.** The same one new co-located test file.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2152
    // -> 2169 (+17).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the sixteen module `.ts` files plus
    // `demo-relocated-reference.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2169 -> 2185.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2185
    // -> 2187 (+2). that module source and its co-located test.
    // **T119a: 2185 -> 2190.** +5, `_lifecycle`'s five co-located tests, for
    // `check-admin-zones`' reason.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2190 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +2 files** — the new module source and its co-located
    // test.
    // **D-223: files 2196 -> 2199 (+3).** `public-url-base.ts` plus the two co-located
    // tests beside it, `public-url-base.test.ts` and `services/assets-library-url.test.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2199 -> 2203, the four module-package files the branch adds
    // — the two sources (`cms-block-read-port.ts`, `cross-module-ports.ts`) and their two
    // co-located tests. This walk reads a module's `.ts` including the test spellings; the
    // backend integration test and the changeset are outside it.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2203 -> 2207, the one new module source
    // and the three co-located tests. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds
    // (`services/cross-module-context.ts`, `request-actor.ts`) plus their two
    // co-located tests, this walk reading a module package's `.test.ts` as well as its
    // sources.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2207 -> 2211. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +2 files** — `invoices`' new module source
    // (`services/cross-module-context.ts`) and its co-located test.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2213 -> 2270.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2273,
    sites: null,
    sources: ['manifest-index'],
    //
    // **2066 -> 2067.** D-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. This walk
    // reads a module package's sources and not `backend/test`, so the move is an
    // arrival rather than a transfer — measured, by taking the file back out.
  },
  'backend/scripts/check-diacritic-folds.ts': {
    prefix: '[diacritic-folds]',
    run: { kind: 'tsx', path: 'scripts/check-diacritic-folds.ts', args: [] },
    // **T118c, `mfaActorBridge`: +3 files** — the three new files; all three are `.ts`, so
    // unlike the `assets_library` census above this whole-tree walk takes every one of them.
    // **Batch 13 (feature 091, Phase 4): +1.** Whole-tree arithmetic: twenty-four
    // files move into the module packages, twenty-four leave `admin/src`, the
    // `FulfilmentStrategyPicker` shim there is deleted with its last reader, and
    // the batch adds two off-state test files.
    // **Batch 15: 4954 -> 4953.** The whole-tree walk: four re-export shims
    // deleted, and three files added (`catalog/src/admin/index.ts` and the
    // batch's two new test files).
    // **Feature 101, Phase 1: +17.** `endora check`'s frame and the five
    // relocated analyses: seven files under `packages/cli/src/check/`, five
    // under `src/rules/`, `src/checks.ts`, and four under `packages/cli/test/`.
    // The five `backend/scripts/check-*.ts` hosts stayed where they are —
    // `check-inventory.test.ts`'s `script` field must resolve to a file in this
    // tree — so the whole-tree walks gained the package's copy and lost nothing.
    // `sites` moves with it: the frame writes six `.replace()` calls whose
    // pattern the slug predicate can read — path and specifier normalisation,
    // every one of them cleared. **+1 more** from the merge requests this
    // branch rebased onto.
    // **Feature 101, Phase 2: -2.** The direction is the point. Ten more rule
    // files arrive under `packages/cli/src/rules/`, and that directory joins
    // `EXCLUDED_SUBTREES` in the same merge request for `backend/scripts`'s own
    // reason: a relocated analysis *is* the check, and this one spells `NFD`,
    // `NFKD` and the combining-mark range because refusing them is its job. So
    // the exclusion takes all fifteen rule files out — the five Phase 1 wrote
    // included, which were being scanned — and `sql-tables.ts`, `ui-layer.ts`
    // and `port-registrations.ts` arrive under `packages/cli/src/lib/`, which
    // is scanned, and `packages/cli/test`'s nine files leave with the second
    // exclusion. -15 + 13 - 9 + 1 (the red proofs) = -10, measured by parking
    // this branch's own files: the base reads 5179 and this branch 5169.
    // **The four fields feature 101 Phase 2 re-recorded carry the value the
    // check *reads*, not the old record plus this branch's delta.** The first
    // draft did the latter and it produced a number describing no tree at all:
    // 5160 - 10 = 5150 against a walk that reads 5169, a +19 residue left for
    // branches that had already merged and would never come back for it — and
    // 0.37% of a +50% ceiling, so the band cannot see it and it merges green.
    // That is precisely the staleness class feature 095's drift report exists
    // to name. Where recording the observed value absorbs drift another branch
    // left behind, the amount is stated below rather than left implicit.
    // Here that absorbs **+19** from the merge requests this branch rebased
    // onto, and the absorption is right rather than merely convenient: this
    // change moves the check's own *population predicate*, so 5160 describes a
    // walk that no longer exists and carrying it forward by a delta would
    // preserve a baseline whose predicate is gone.
    // **Feature 103 (overlay file shadowing retired): 5169 -> 5179.** This change's own
    // contribution is **-13** over the whole-tree walk. Recording the observed value
    // absorbs **+23** from earlier merges (base 36174efa1 observed 5192). The `sites`
    // field is left at 489 deliberately: this branch moves no fold site, and its +3 is
    // somebody else's to record.
    // **F7: +4.** The whole-tree walk gains `packages/cli/src/new-storefront/`'s
    // three sources and the command's test file. `backend/scripts` is outside this
    // check's population, so the acceptance criterion adds nothing.
    // **Feature 098 Phase 4 (the storefront conformance job): 5184 -> 5191.**
    // The nine files that job is made of — six under
    // `storefront/test/conformance/`, `storefront/playwright.conformance.config.ts`,
    // `backend/scripts/conformance/seed-storefront-fixtures.ts` and
    // `scripts/conformance-storefront.sh` — intersected with this walk's
    // population.
    // Seven of the nine: this walk is `admin`, `backend`, `storefront` and
    // `packages`, and it excludes `backend/scripts`, so the two files outside
    // `storefront/` do not reach it.
    // **Feature 105: 5191 -> 5187.** Four `.ts`/`.tsx` files leave the tree —
    // the storefront's `app/cms/[...slug]/{page.tsx,seo.ts}`, the orphan admin
    // screen `cms_pages/CmsPagesPage.tsx` and `packages/contracts/src/cms-pages.ts`.
    // This walk is the whole repository, so it sees all four; `sites` is unmoved,
    // none of them folding a diacritic or building a slug.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 5187 -> 5239.** 52 module
    // packages gain a `vitest.config.ts`; the 196 moves are net zero for a whole-tree
    // walk.
    // **Feature 104 §§ 1.5–1.6: files 5239 -> 5240, and only one of the three is
    // this branch's.** `packages/cli/src/new-storefront/npmrc.ts` is the file it
    // adds; the other two arrived on `master` between the last re-record and
    // this branch's base. Measured rather than reasoned: the two files this
    // branch adds were parked off disk and every drifted check re-run, which
    // reads 5241 without them. Parking is valid here because both are
    // **untracked** — the `--cached` caveat the two shell entries carry bites
    // only on a file that has already been committed. The observed value is
    // recorded rather than `recorded + 1`, for this row's own standing reason:
    // 5240 would describe no tree at all.
    // **Feature 110 Phase 1 (`specs/110-instance-repository/`): 5260 -> 5262.** Two of
    // the three TypeScript files this branch adds reach this walk —
    // `packages/cli/src/lib/instance-build-inputs.ts` and
    // `backend/test/unit/ci/instance-build-inputs.test.ts`. The third is under
    // `backend/test/unit/scripts/`, which this walk excludes, and the fixture package's
    // hand-written `.js` is outside its extensions.
    // **Feature 109, Phase 1c, follow-up: +1.** One file:
    // `packages/cli/src/lib/delegated-composer.ts`. The `backend/scripts/lib/` shim
    // is under this check's own `EXCLUDED_SUBTREES`.
    // `check-port-dependencies` follows a delegating root to its composer now,
    // so the derivation lives in `@endora-commerce/cli/lib/delegated-composer.ts`
    // with a re-export shim beside the other shared analyses.
    // **Stacked on 113 Phase 0: +12.** That branch adds thirteen files —
    // the demo-data declaration, its runner and their tests, twelve of them
    // TypeScript and one a changeset. This walk takes the twelve TypeScript sources.
    // **5275 -> 5276 (this branch, +1): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 1 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 5275.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 5276 -> 5279.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +4 files.** The platform package's
    // new `src/migrations/` plus the two-regime guard and its helper; the whole tree
    // is this check's population. `sites` does not move — none of the four writes a
    // `.replace()` the slug predicate can read.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/115-lifecycle-container-move/` Phase 2: 5283 -> 5284.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 5284 -> 5287 (+3).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`
    // — `manifest-registry.ts` and the relocated `services/module-id-claims.ts` —
    // plus `packages/platform/src/lifecycle/manifest-registry.test.ts`. `backend/src` does not
    // move: the binding and the claims re-export both keep their paths.
    // **The service-unavailable notice: 5284 -> 5288.** The four source files
    // the storefront's `503` answer adds — the notice's `page.tsx`, the
    // reachability classifier, the shared names module and the test. `sites` is
    // unmoved: none of them folds a diacritic or builds a slug.
    // **+3 for this branch.** The service-unavailable page, its reachability probe
    // and its shared constants; the test file is outside this walk.
    // **The storefront environment refusal: 5291 -> 5294 (+3).** `instrumentation.ts`
    // and the two new test files. The seam itself, `storefront/lib/env.mjs`, is
    // **not** among them — this walk reads `.ts`/`.tsx`/`.js` and `.mjs` is outside
    // it, which is why this moves by three where `check-nul-bytes` moves by four.
    // **`specs/115-lifecycle-container-move/` Phase 4: 5294 -> 5295 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 5294 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +8 files, +4 sites.** The files this feature adds under
    // this walk, which is the whole tree less `backend/scripts` and
    // `backend/test/unit/scripts` — the two directories whose job is to spell the
    // shapes the rule refuses. The sites are the `.replace` and `normalize` calls
    // inside them; none is a fold or a slug run, and `violations` stays 0.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +2 files.** The whole-tree walk, so
    // it sees the branch's net inventory: the platform derivation, its shim and
    // the FR-030 ratchet arrive, the `_i18n` source goes.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 5305 -> 5311 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` T120: 5305 -> 5307 (+2).** A whole-tree
    // walk, so the 106 files that moved from `admin/src` into
    // `packages/admin-shell/src` are a wash and the two are the new package's
    // own: its barrel and its `src/types/env.d.ts`. The two tsconfigs and the
    // manifest are not `.ts` sources and are outside this population.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **`specs/110-instance-repository/` Phase 3 (T123): 5313 -> 5314 (+1).** One
    // file: `test/unit/packages/tailwind-sources.test.ts`. `backend/scripts` is out
    // of this population by declaration, so `scripts/lib/tailwind-sources.ts` is
    // not counted, and the 60 generated stylesheets are `.css` — this walk reads
    // source, and a `@source` directive is not a diacritic fold.
    // **Feature 115 Phase 6: 5314 -> 5311, re-measured on the union.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 5311 -> 5449.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/110-instance-repository/` Phase 3 (T126/T127): 5314 -> 5315 (+1).**
    // One file, `admin/test/unit/shell-theme-override.test.ts`. The branch adds
    // two more, and neither is in this population: `packages/admin-shell/theme.css`
    // is `.css`, and `admin/test/helpers/compile-instance-stylesheet.mjs` is
    // `.mjs`, while `SOURCE_EXTENSIONS` here is `.ts` and `.tsx` alone.
    // **+1 for this branch, measured on the union after rebasing onto `8bf0da614`.** Four files
    // arrive: the shell's `theme.css`, its changeset, and the admin's override test with its
    // compile helper. The branch first recorded against `79a1befe6`, and Phase 6 has since
    // deleted three re-export shims, so the base moved under it — this value is a fresh census
    // of the combined tree rather than the sum of the two.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 5312 -> 5303.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`specs/110-instance-repository/` T132/T133: 5312 -> 5316 (+4).** `endora new
    // instance`'s four source files under `packages/cli/src/new-instance/`. The two
    // test files this branch adds are outside this walk — `packages/cli/test` joined
    // `EXCLUDED_SUBTREES` in feature 101 Phase 2 — which is why the delta is four and
    // not six, and it is the discrimination worth keeping: the other three whole-tree
    // entries below move by six or seven in the same merge request.
    // **+4, re-measured on the union after rebasing onto Phase 7.** This branch adds four
    // sources, two tests and a changeset; `specs/115-lifecycle-container-move/` Phase 7 has
    // since deleted nine lifecycle shims, so every base below is lower than this branch first
    // measured. The delta is unchanged; the total is a fresh census of the combined tree.
    // **`chore/094-retire-error-table` (over !1508): 5449 -> 5444.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-4** was already standing at
    // `094-akeneo-pim-sync`'s tip (5445), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 5312 -> 5319 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. This walk is the whole tree minus the check scripts, so it takes the package, the tests and the admin files.
    // **`specs/110-instance-repository/` T114a: +3 files** — the three `.ts` files the
    // task adds, this walk being the whole-workspace one for `.ts`.
    // **+1, re-measured on the chained union.** `packages/platform/src/overlay/deployment-roots.ts`, this branch's one new package source, which this whole-tree walk opens.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This walk is the whole tree minus the check scripts, so it takes the package, the tests and the admin files.
    // **`fix/search-reindex-task-timeout`: files 5455 -> 5456.** The same one new co-located test file; this walk is the whole tree's TypeScript.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+1, and it is not this branch's.** `fix/search-reindex-task-timeout` merged after this branch recorded, adding `search-indexer-task-wait.test.ts`, which this whole-tree walk opens. Re-measured on the union.
    // **D-221 (`feat/catalog-new-product-route`): 5456 -> 5457.** One file: the new
    // `admin/test/modules/catalog/ProductsList.create-affordance-gating.test.tsx`.
    // This walk is the whole tree's source, so the branch's other added file — a
    // changeset markdown — is not in the population; `check-nul-bytes` and
    // `check-naming.sh` take both and move by two.
    // **+6, one of it this branch's.** This walk takes the new `.tsx` test and not the changeset, which is not a source file.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // The platform's new `cli/index.ts` barrel and the re-export shim at
    // `backend/src/cli/module-commands.ts`; the moved file nets to nothing across
    // the roots this walk reads, and the changeset markdown is not in scope.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 5463 -> 5465.** four files
    // arrive — `src/seeds/demo-composition.ts`, `src/seeds/demo-host-residue.ts`,
    // `src/demo/composition-loader.ts` and `test/integration/demo/demo-parity.test.ts` —
    // against the two `src/seeds/` re-export shims T215 deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 5467
    // -> 5485 (+18).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the seventeen `.ts` files plus `taxes`' new
    // `vitest.config.ts`; the five changesets are markdown.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 5486 -> 5501.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +2 files.** The two sources the task adds —
    // `packages/platform/src/composition/compose-app.ts`, the assembly moved out of
    // `backend/src/composition.ts`, and
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, its contribution-split
    // ledger. The application file keeps its path, so the move nets to nothing.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 5501 here, so this branch's own contribution is +2. The new platform source and the new unit test; the changeset is markdown and this walk skips the check scripts, not the tree.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 5501 -> 5502 (+1).**
    // One file — `test/helpers/demo-data-budget-fixture.ts`. The check's other
    // three new files are outside its population by declaration:
    // `backend/scripts` and `backend/test/unit/scripts` are excluded, being the
    // trees whose job is to spell the shapes the rule refuses.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 5503 here — so this branch's own contribution is +1. Only the check's library: this walk excludes `backend/scripts` and `backend/test/unit/scripts`, which is where the check, its ledger and its companion test live.
    // **Feature 113's T226: files 5504 -> 5501 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 5501 -> 5502 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 5504 -> 5506 (+2).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 5506 -> 5504. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 5504 -> 5477 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`fix/admin-image-root-scripts`: files 5504 -> 5506.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files are in this whole-tree walk.
    // **Re-measured on the union after rebasing onto T119.** That task deleted the
    // twenty-seven re-export shims this walk was reading, so every entry here moves by the
    // same −27 and this one lands at 5479 rather than the 5506 recorded against a tree that
    // still held them. The two files this branch adds were already in the recorded value;
    // measured on the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 5479
    // -> 5482 (+3). The three `.ts` files. This walk reads `.ts`/`.tsx`/`.js` over the
    // whole repository and the changeset is `.md`, which is why it gains three where its
    // whole-tree neighbours gain four.
    // **T119a: 5479 -> 5472.** Three movements over the whole tree: -9 for the nine
    // re-export shims `specs/110-instance-repository/` T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`), then -50 and +50 as the moved test
    // files change address rather than existence, and +2 for
    // `packages/platform/vitest.config.ts` and `vitest.setup.ts`.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 5472 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 5479 -> 5481.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, its population is every source file under `admin`, `backend`, `storefront` and `packages`, minus `backend/scripts` and `backend/test/unit/scripts` — so it takes the two new test files and neither of the two new `backend/scripts` sources, and the two root `scripts/*.sh` are outside it entirely.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 5481 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +3 files** — this walk is the whole tree, so it opens the
    // new module source, its co-located test and the new integration test.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 5478 -> 5480. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 5477 -> 5466 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 5466 -> 5469. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 5472 rather than the
    // 5483 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 5472 -> 5466 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 5472 -> 5477 (+5).** The five `.ts` files it adds:
    // `public-url-base.ts`, its two co-located tests and the two integration tests.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 5477 recorded against the tree before it: 5471. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **T11A (`specs/110-instance-repository/`): files 5471 -> 5473, sites 541 -> 544.**
    // The two files T11A adds — `test/helpers/host-residue.ts` and
    // `test/unit/kernel/host-residue-partition.test.ts` — and the three `.replace()` chains
    // in them: the helper's trailing-punctuation strip on a path token in prose and its
    // `.js` -> source-extension rewrite, plus the same rewrite in the test's reading of
    // `node dist/…` scripts. None folds a diacritic and none builds a slug; measured by
    // parking both files, which reads the recorded pair exactly.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 5471 -> 5476, the five `.ts` files the branch adds across
    // `packages` and `backend`. The changeset is outside this walk, whose roots are the four
    // application and package trees.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 5476 recorded before it: 5478. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 5478 -> 5482, the one new module source
    // and the three co-located tests — this walk is the whole tree. Quality-job shape: the
    // ignored copies `composer:generate` places under `docs/docs/modules/` swept first,
    // because no job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's five new TypeScript files — two `pwa` module sources,
    // their two co-located tests, and
    // `backend/test/integration/pwa/cross-module-wiring.test.ts`. `sites` falls by one,
    // and the one is the whole of what this drain does to this check's population:
    // `payload.to.replace(/_/g, ' ')`, the order-status presentation, was written in
    // **both** composition roots and is now written once, in
    // `createOrderPushTargetResolver`.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 5483 -> 5487. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +3 files** — the two new `invoices` module files and
    // the backend integration test.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 5490 recorded against the tree before it: 5492. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 5487 -> 5489.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 5489 -> 5494.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 5492 -> 5589.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 5589 -> 5591.** Neither side's
    // recorded value describes this tree: this branch's 5589 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 5494 was measured
    // without feature 119's two module packages. The +2 is attributed by measurement and not
    // by subtraction: with the four files the master side adds parked, this walk reads 5589
    // exactly, so the whole delta is `backend/test/harness-tenant-scope.ts` and
    // `backend/test/unit/harness/setup-file-imports.test.ts`. The other two are outside this
    // population — `packages/cli/test` is one of this check's excluded subtrees, and a
    // changeset is not a `.ts`. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the
    // two sides' deltas.
    // **T140 (the instance acceptance criterion): files 5494 -> 5495.** One: the criterion's own unit test. This walk excludes `backend/scripts` and `backend/test/unit/scripts`, so neither of the two new script files is in its population, and it reads no JSON.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 5591 -> 5592.** Neither side's recorded value describes this tree: the
    // branch's 5591 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 5591 exactly, so the whole delta is
    // `backend/test/unit/acceptance/instance-assertions.test.ts`. Its walk excludes
    // `backend/scripts` and `backend/test/unit/scripts`, so neither acceptance script is in its
    // population, and it reads no JSON and no `specs/`. Quality-job shape — the ignored copies
    // under `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the
    // two sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +4 and sites +2.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // The two sites are `admin-artefacts.ts`' two `target.replace(/^\.\//, '')` calls, which
    // moved **into** this walk rather than being written: `backend/scripts` is out of its
    // population and `packages/cli/src` is in it. Neither is a fold; both are the ordinary
    // `.replace()` shape the site counter opens. The four files are the seven minus the two
    // shims under `backend/scripts` and minus the changeset, which this walk does not read.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 5603 -> 5605 (+2).** The two new files under `packages/cli/src/`; this walk is `.ts`/`.tsx`/`.js` over the whole tree minus `backend/scripts` and `backend/test/unit/scripts`, so the shim and the two new tests are outside it and the changeset is not source. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 5605,
    // It had none until issue #244, on the stated ground that "the unit is the
    // fold, and a file without one is exactly what #244 is about". True of the
    // two fold signals and no longer the whole check: the `slug-run` signal
    // judges every `.replace()` whose pattern it can read, cleared ones
    // included, so there is now a population here that does not move with the
    // findings.
    // **Batch 13 (feature 091, Phase 4): +3.** Not the moved screens, which fold
    // nothing and build no slug: the three `.replace()` call sites this walk
    // can read are in the batch's own admin off-state test, whose `codeOf`
    // helper strips comments before matching the two registries as text.
    // **Batch 14 (feature 091, Phase 4): 437 -> 440, files 4955 -> 4954.** The
    // three sites are this batch's own admin test helper, not the tree it
    // moves: `batch-fourteen-surfaces.module-owned-surface.test.tsx` writes
    // four `.replace()` calls — the comment stripper, the parametric-URL
    // rewriter and the label-key escaper take a regular expression and count,
    // the fourth takes a string literal and does not, because
    // `replacePatternSource` reads a pattern and not a call. Batch 13 chased
    // the identical `+3` and found the identical cause, which is the standard
    // this row is recorded to.
    // **Batch 15 (feature 091, Phase 4): 440 -> 444.** Four, and every one of
    // them is this batch's own admin off-state test: `codeOf`'s comment strip,
    // `concreteUrl`'s parameter substitution and two `labelKey`/`member` dot
    // escapes are `.replace()` calls whose pattern the slug predicate can read,
    // so they enter the population whether or not they fold anything. Batches
    // 13 and 14 each chased the same `+3` and each found the same answer, in
    // their own new test file — which is worth recording as a habit rather than
    // as a coincidence: this number moves with the *instruments* a batch adds,
    // not with the surface it moves.
    // **Measured on the merge result, not on either branch** — 488.
    //
    // Two branches recorded this field independently and **neither number was
    // right for the tree they were about to make**: feature 098's Phase 2 wrote
    // 480 (its own +2, measured by parking its files and re-running) and this
    // branch wrote 484. Both were correct about their own branch. The combined
    // tree reads 488, and it was measured here rather than chosen between,
    // after the rebase, with the packages rebuilt.
    //
    // This is the fourth instance of a record swept on a branch describing that
    // branch's tree — the entry in `specs/deferred-defects.md` carries the other
    // three. It is the first one caught **before** it merged, and only because
    // the merge result was built locally: no pipeline in this repository does
    // that, and both branches were individually green.
    // **Feature 101, Phase 2: +6.** `sql-tables.ts` moves out of
    // `backend/scripts/lib` — excluded — into `packages/cli/src/lib`, which is
    // scanned, and it writes six `.replace()` calls the slug predicate can read.
    // Every one is cleared. The fifteen rule files the same change excludes
    // wrote none, and `packages/cli/test` joins the exclusion for the same
    // reason `backend/test/unit/scripts` carries — not as a precaution: this
    // merge request's own red proof spells a fold and this check reported it.
    // **F7 (`endora new storefront`): 492 -> 497.** Five slug/fold sites in the
    // command's own sources — `reference.ts`' glob-prefix and specifier readers and
    // `rewrite.ts`' extension swap. Measured against a detached worktree of
    // `origin/master`, which reads 492 rather than the 489 recorded: three sites
    // arrived on `master` and are absorbed here, because a record must describe the
    // tree it is committed with and `recorded + my delta` is the arithmetic that
    // carries somebody else's staleness forward for ever.
    // **Feature 098 Phase 4: 499 -> 519.** The `.replace()` chains those seven
    // files carry — the served-HTML readers in `assertions.ts` are most of them.
    // None is a fold or a slug builder; `violations=0` is unchanged.
    // **Feature 104 § 1.5: 519 -> 520.** One site, and all of it this branch's —
    // `npmrc.ts` strips the scheme off the registry URL to key the auth line
    // (`.replace(/^https?:/, '')`), a `.replace()` whose pattern the slug
    // predicate can read and clears. The parked-file measurement reads 519
    // without it, so unlike this row's `files` field there is no inherited
    // drift here to absorb.
    // **CI gate reconciliation: 522 -> 525.** Three `.replace()` calls whose
    // pattern the slug predicate can read, none of them folding anything: the
    // `--filter` selector's quote strip and the regex escaper in
    // `ci-gate-coverage.ts`, and the trailing-slash strip in the test's
    // `readMembers`. Measured by parking the test file: the two helpers alone
    // read 524.
    // **The storefront-scaffold backend variables: 525 -> 526.** One
    // `.replace()`, in `envExampleDeclarations` — the quote strip that reads
    // `KEY="http://host:3001"` as it reads `KEY=http://host:3001`. This entry
    // named `backendAddressVariables`, which was that parser's one caller and
    // is gone: the backend-address question is now asked of a declaration's
    // `addressOf` rather than of a value's shape. The site is the parser's and
    // did not move with it. Its pattern
    // is anchored on a matching quote pair, so the slug predicate reads it and
    // clears it; the `files` field does not move, that function landing in
    // `packages/cli/src/new-storefront/reference.ts`, which this walk already
    // opened.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 530 -> 540.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/110-instance-repository/` T114a: sites 530 -> 529.** One `.replace()`
    // call, and it is the one the task deleted: `divergence-loader.ts`' extension
    // surgery, `path.replace(/\.ts$/, '.js')`, which was `RUNNING_FROM_DIST`' only use.
    // A resolution over the two candidates replaced it, so there is no string to rewrite.
    // **530 -> 531** with T129b: one more `.replace()` candidate, the comment strip in `definedClasses`. `files` moved with it — this walk is the whole tree.
    // **-1, re-measured on the chained union.** The site is the one D-217/D-218 removes on the base this branch is now chained behind; this branch adds no fold and removes none.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The slug and fold sites the module's sources contain.
    // **`fix/admin-image-root-scripts`: sites 540 -> 543.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Three of the `.replace()` calls the two files write are patterns the `slug-run` predicate can read — line and path normalisation — and it clears all three; the population moves with the candidates, not with the findings.
    // **`specs/110-instance-repository/` T119c: sites 543 -> 544 (+1).** One two-argument
    // `.replace()` in `backend/test/unit/kernel/boundary-check.test.ts`. That file's
    // rule-A fixture spelled the `sales-channel.entity.js` shim path this task deletes;
    // it now computes the specifier from the platform's own source root, and the
    // `.ts` -> `.js` rewrite in that derivation is a `replaceSite`. No fold and no slug
    // run, so `findings` is unchanged.
    // **D-223: sites 543 -> 540 (-3).** Four trailing/leading-slash `.replace()` calls gone
    // — one per storage adapter, plus the hand-written origin join in
    // `backend/src/composition.ts` — against one added, `withoutTrailingSlash` in
    // `public-url-base.ts`. That is the shape of the ruling in this walk's own terms: five
    // places that trimmed a base became one.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 540 recorded against the tree before it: 541. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **The nightly diagnostic repair: sites +1.** `junit-artifact.test.ts`'s
    // `.replace(/^\.\//, '')`, which strips a leading `./` from the `outputFile` path
    // `vitest.config.base.ts` declares. The slug predicate reads the pattern and clears
    // it; this field counts cleared sites too, which is what keeps it from moving with
    // the findings.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 543 -> 544.**
    // **+1 site**: the guard's single `.replace()`, which rewrites a `.js` specifier to its `.ts` source while walking the setup path's imports. It collapses no run of non-ASCII-alphanumerics and builds no slug, so it is a site this check walked and not a finding it withheld.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 544 -> 545.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 544 -> 546.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): sites 546 -> 547.** Neither side's recorded
    // value describes this tree: this branch's 546 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 545 was measured
    // without feature 119's two module packages. The +1 is the guard's single `.replace()`,
    // the one master's block above names: it rewrites a `.js` specifier to its `.ts` source
    // while walking the setup path's imports. Measured — with the master side's four files
    // parked this walk reads 546 exactly. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the
    // two sides' deltas.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): sites 547 -> 548.** Neither side's recorded value describes this tree: the
    // branch's 547 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 547 exactly, so the whole delta is the `.replace()` that strips
    // the scope off a package name, in the derivation of the `linked` group
    // `changeset-flow.test.ts` now reads out of `.changeset/config.json`. Quality-job shape — the
    // ignored copies under `docs/docs/modules/` swept first. Measured on the combined tree, never
    // summed from the two sides' deltas.
    // **T138: the file half of the move noted above the site count.**
    // The two sites are `admin-artefacts.ts`' two `target.replace(/^\.\//, '')` calls, which
    // moved **into** this walk rather than being written: `backend/scripts` is out of its
    // population and `packages/cli/src` is in it. Neither is a fold; both are the ordinary
    // `.replace()` shape the site counter opens. The four files are the seven minus the two
    // shims under `backend/scripts` and minus the changeset, which this walk does not read.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 556 -> 558 (+2).** Two more classified expressions in those two files. No new fold and no new slug builder: both ledgers are untouched. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    sites: 558,
    sources: [],
    //
    // **5314 -> 5315.** D-217 added `backend/test/helpers/interactive-run.ts`, the
    // launcher `uninstall-hard-needs-force.integration.test.ts` spawns to prove
    // `--hard` refuses at a terminal too. The D-218 move nets zero: both roots are
    // in this population.
  },
  'backend/scripts/check-divergence.ts': {
    prefix: '[divergence]',
    run: { kind: 'tsx', path: 'scripts/check-divergence.ts', args: [] },
    // **T118c, `mfaActorBridge`: +2 files** — `mfa`'s new module source and its co-located
    // test, both read for the owner map.
    // Every module source the owner map and the route table are built from, plus
    // the platform's own tree, plus the two composition roots, plus each
    // deployment's overlay sources. It is deliberately **not** the overlay files
    // alone: with two overlay modules in the tree that number is 2, and a walk
    // that lost the whole module tree would print `files=2` and look exactly
    // like a healthy run over a small deployment.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2163 -> 2169.**
    // Six, because this walk is the module-manifest generator's over the
    // workspace packages: it sees the platform's new six-file `src/demo/` layer
    // and neither of the two files the branch adds under `backend/src`.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2171 -> 2173.** The same one
    // file — `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel
    // (D115-4) — counted twice, this walk taking `layout.sourceRoots`, which lists
    // the platform both as `platformRoot` and as a workspace package root.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2173 -> 2177 (+4).** The same
    // two files the move adds under `packages/platform/src/lifecycle/`, counted
    // twice each because this check reads the platform's sources in two passes.
    // Measured rather than reasoned about: with both files taken out of the tree
    // and the check re-run it reads 2173.
    // **2177 -> 2158, and the fall is the correction rather than a regression.**
    // The walk stopped double-counting: the route population is a **union** of
    // several walks, two of which overlap — `packages/platform/src/lifecycle` is a
    // module walk root sitting *inside* the platform's source root, so each of its
    // 19 files entered once as `_lifecycle`'s and once as the platform's. `files`
    // was therefore the size of a multiset, and −19 is exactly that tree.
    // The two comments above it are kept and are **wrong about the mechanism**,
    // which is worth leaving visible: they say the platform is listed "both as
    // `platformRoot` and as a workspace package root", and it is not — measured,
    // `layout.sourceRoots` holds no duplicate and no nested pair, and this check
    // does not read `sourceRoots` at all. The overlap was one directory deep, in a
    // walk nobody had looked at.
    // Measured three ways rather than reasoned about. Before: a file added under
    // `packages/platform/src/lifecycle/` moved this number by **2**, one added
    // under `packages/platform/src/kernel/` or under a module package by **1**,
    // one added under `backend/src` by **0**. After: **1**, uniformly, for all
    // three of the first kind. And the report itself is byte-identical — same
    // deployments, entries, owners, rungs and `sites=4` — because
    // `routeIdentities` already resolved a route it saw twice the same way this
    // guard now resolves the file.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2158 -> 2159 (+1).** The
    // divergence split (D115-3) adds `packages/platform/src/lifecycle/divergence-declaration.ts`
    // — the parser and the empty default — and that directory is a module walk
    // root, so it moves this number by exactly one, which is what the block above
    // measured a platform-lifecycle file to be worth after the double-counting was
    // fixed. The other two files the split touches move it by **zero**, and that is
    // the same measurement read the other way: `backend/src/lifecycle/services/divergence.ts`
    // is deleted and `backend/src/overlay/divergence-loader.ts` is added, and
    // neither is in this walk — `_lifecycle` is **platform**-resident, so
    // `backend/src/lifecycle/` is not a module walk root and no path under
    // `backend/src` is in the owner map's population at all.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2160 -> 2166 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2166 -> 2250.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+23 is
    // this branch's test move** — the 23 harness-free `pim_akeneo` tests entering the
    // module walk roots from `backend/test/`.
    // **`specs/110-instance-repository/` T113 and T114: 2166 -> 2173 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The module's sources plus its package root, which this walk opens alongside the overlay tree.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **+1, re-measured on the chained union.** The same new platform source; this walk reads the overlay tree and the platform beside it.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's sources, which this walk opens alongside the overlay tree.
    // **`fix/search-reindex-task-timeout`: files 2259 -> 2260.** The same one new co-located test file, through the owner map's module-tree input.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +20 files.** This
    // walk's population is the platform's own tree and the module roots, not
    // `backend/src/db/`, so it sees only the arrival: eight `db/` sources and the
    // twelve core migrations, both now under `packages/platform/src/`.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+1, master's.** The same new search test file, from the merge that landed after this branch recorded.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2282
    // -> 2299 (+17).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the sixteen module `.ts` files plus
    // `demo-relocated-reference.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2300 -> 2316.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2316 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T235 (the escape hatch's runner half): files 2317 -> 2318 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2317 -> 2318 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** This entry carried no
    // conflict — the branch never touched it — so the recorded number was `master`'s alone,
    // and the one new platform source this branch adds moves it 2318 -> 2319 (+1). Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2319
    // -> 2321 (+2). that module source and its co-located test.
    // **T119a: 2319 -> 2369.** +50. Its owner map is built over `layout.sourceRoots`,
    // which includes `packages/platform/src`, so the fifty moved test files arrive in this
    // walk; nothing about the overlay population moved.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2369 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +2 files** — the module tree feeds this check's owner map,
    // and it gains the new module source and its co-located test. No deployment's
    // divergence moved.
    // **D-223: files 2375 -> 2378 (+3).** `public-url-base.ts` plus the two co-located
    // tests beside it, `public-url-base.test.ts` and `services/assets-library-url.test.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2378 -> 2382, the four module-package files the branch adds
    // — the two sources (`cms-block-read-port.ts`, `cross-module-ports.ts`) and their two
    // co-located tests. This walk reads a module's `.ts` including the test spellings; the
    // backend integration test and the changeset are outside it.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2382 -> 2386, the one new module source
    // and the three co-located tests. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds
    // (`services/cross-module-context.ts`, `request-actor.ts`) plus their two
    // co-located tests, this walk reading a module package's `.test.ts` as well as its
    // sources.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2386 -> 2390. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +2 files** — `invoices`' new module source
    // (`services/cross-module-context.ts`) and its co-located test.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2392 -> 2449.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2454,
    // Every seam call examined across every deployment, resolved or not. This is
    // the number that moves when a call shape stops resolving while the file
    // count stands still (#235/#237's shape), and here the file count cannot
    // move with the overlay tree at all — 2160 of the 2162 files are the owner
    // map's.
    sites: 4,
    // Three independent authors, none of them the check's own count.
    // `overlay-modules` is `resolveOverlay()`'s directory walk against the
    // modules the walk actually opened a source for, so a discovered overlay
    // module contributing no file is a short walk. `manifest-index` is issue
    // #215's shared floor over the owner map's module walk. `seam-kinds` is
    // `ModuleContext`'s own members, read from the platform's source: expected
    // and covered are the same number on purpose, because a member the rung
    // table does not classify is the `unclassified-seam` finding and never a
    // blind run, while a platform interface this run could not read at all is
    // `expected: 0`, which the shared reporter refuses.
    sources: ['overlay-modules', 'manifest-index', 'seam-kinds'],
    //
    // **2173 -> 2174.** D-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. This walk
    // reads a module package's sources and not `backend/test`, so the move is an
    // arrival rather than a transfer — measured, by taking the file back out.
  },
  'backend/scripts/check-doc-snippets.ts': {
    prefix: '[doc-snippets]',
    run: { kind: 'tsx', path: 'scripts/check-doc-snippets.ts', args: [] },
    // **Feature 100 Phase 3: 1102 -> 1186.** 71 of the 84 are this branch's one
    // generated reference page per module, which land under `docs/docs` and are
    // therefore in this walk's population though none of them cites a snippet; the
    // other 13 are `origin/master`'s own growth, inside the band and named here
    // rather than absorbed. `sites` moves by one for the same reason it always
    // does: a document grew a `verbatim-from` block, and not this branch's doing —
    // recorded at what this tree reads rather than left half-current, because an
    // entry that describes the tree in one number and not the other is an entry
    // the drift report has to keep naming.
    // **2026-09-04: 1186 -> 1209.** 26 markdown files were added under `specs/`
    // and `docs/docs/` since this was set -- the 104, 106, 107 and 108 spec
    // directories, chiefly. The walk is documents, not the module tree they cite.
    // **2026-09-05: +14, and no branch that moved it could have known.** A nine-way
    // merge landed `specs/109-backend-test-kit/` (5 files), `specs/110-instance-repository/`
    // (5) and `specs/111-shared-fixture-package-naming/` (4). All fourteen arrived in two
    // **documentation-only** merge requests, which re-recorded nothing -- correctly, from
    // their authors' point of view: a branch that adds only markdown has no reason to
    // suspect it moves a read size, and neither of them touched a check. But three walks
    // in this estate count markdown, so a docs-only merge request silently drifts them.
    // That is the gap the drift report exists to fill and the one case where nobody is at
    // fault for not filling it in advance; it is caught on the merged tree instead.
    // **`specs/114-release-shape-gate/` landed: +4.** The release-shape gate's
    // design added five files — four markdown and one `.mjs` contract. This walk
    // takes the four markdown documents; the `.mjs` contract is not a document.
    // **1243 -> 1247 (not this branch's, and recorded here because the drift
    // report named it).** Measured with this branch's three new files taken out
    // of the tree: the walk still reads 1247, so every one of these 4
    // arrived with the five merges this branch was rebased onto and the record
    // was already stale on `master`. Re-recorded rather than left drifting,
    // because a census that cannot reach `0 drifted` stops being read.
    // **`specs/115-lifecycle-container-move/`'s design landed on `master`: +4.**
    // !1450 added four markdown files — the plan, the research and the two
    // contracts. This walk takes all four, they being documents. Re-derived on this branch's own
    // tree rather than carried over; the guard this merge request adds creates no
    // file, so the whole of the +4 is that merge's.
    // **`specs/110-instance-repository/`'s two contracts landed on `master`: +2.**
    // !1456 added `contracts/instance-migration-order.md` and
    // `contracts/instance-tree.md`, and re-recorded nothing. Neither is this
    // branch's: it changes two existing test files and creates none, so the whole
    // of the +2 is that merge's, and the record was already stale on `master`
    // before this branch existed. Re-recorded here because this is the first run
    // of the census since, and a census that cannot reach `0 drifted` stops being
    // read.
    // **`specs/110-instance-repository/`'s two new contracts: +2.** They landed on
    // `master` with the instance-scaffold design and were not re-recorded there;
    // this branch is the next run of the census, which is who the report addresses.
    // **+6 from `master`, none of it this branch's.** `specs/116-zero-series-versioning/`
    // landed with six files — spec, plan, research, data model and two contracts —
    // and re-recorded nothing.
    // **+2, none of it this branch's.** `specs/110-instance-repository/`'s two
    // contracts landed on `master` without re-recording this walk; measured by
    // taking this branch's two files away and re-running, which left the +2.
    // **+6, none of it this branch's.** `specs/116-zero-series-versioning/`'s six
    // files landed on `master`; the two root licence files this branch adds are
    // under neither declared documentation root, so this walk does not see them.
    // **+6 from `master`.** `specs/117-instance-bring-up/` landed with six files —
    // spec, plan, research and three contracts — and re-recorded nothing. All six
    // are documents under a declared root, so this walk and the two
    // whole-repository ones move by the same amount.
    // **+4 for this branch.** `specs/118-instance-member-selection/` — spec, plan,
    // research and one contract. All four are documents under a declared root, so
    // the document walk and the two whole-repository walks move by the same four.
    // **The storefront environment refusal adds nothing here.** Its four new files
    // are storefront sources and this walk reads `docs/docs` and `specs`; measured
    // by parking them, which left this number where `master` had already put it.
    // **+4, none of it this branch's.** The four documents belong to the design this
    // branch is stacked on; the four files added here are source and a test, which
    // this walk does not read. The conflict resolution had reverted this entry to a
    // value measured before that stack; the number here is measured on the union.
    // **+1 on `master`, measured on the union of three merged branches.**
    // `specs/113-module-owned-demo-data/contracts/demo-opt-in.md` is the one *document*
    // the three merges added; the other two new files are changesets, which this walk
    // does not read. Re-recorded after the merge rather than in the branch that moved it,
    // because a spec-only branch moves this entry and its author has no reason to look.
    // **+1: `contracts/admin-stylesheet-composition.md`.** The one document this branch
    // adds; the other five files it changes already existed, and an edit moves no count
    // here. Measured with `backend/.env` absent and no untracked `docs/docs/modules/`
    // copies.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1267 -> 1282.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **+1 on `master`, not this branch's**:
    // `specs/110-instance-repository/contracts/application-root-supplier.md`, added by the
    // T114a design merge, which is spec-only and whose author had no reason to look here.
    // Re-recorded by the T115 branch, which reads the census and inherits the drift; every
    // file *this* branch changes under `specs/` already existed, and an edit moves no count.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 12 spec pages and 2 documentation pages the branch adds, which this walk opens as documents.
    // **+2, and only one of them is this branch's** (`specs/113-module-owned-demo-data/`
    // `tasks.md`). The other +1 was already standing on `master` when this branch forked at
    // `ad0fe0876`: a docs-only merge moved this walk and re-recorded nothing, measured by the
    // baseline census run before this file was written (`3 drifted, 39 agree, 0 not measured, of
    // 42 recorded`, +1 on exactly these three entries). !1512 carries the same repair; whichever
    // lands second is a no-op, because the recorded value here is the observed one either way.
    // **+1, and none of it this branch's.** Measured: with this branch's five new files
    // parked and its edits reverted, this walk still reads 1268, so the document that
    // moved it arrived on `master` and was not re-recorded there. T114a creates no
    // document. Re-recorded because a census that cannot reach `0 drifted` stops being
    // read.
    // **+1, and it is not this branch's.** The document is `specs/113-module-owned-demo-data/tasks.md`, which arrives on the chained base (`spec/113-demo-data-tasks`, merged before this one). This branch adds no page.
    // **+1, re-measured on the union after rebasing onto `ad0fe0876`.** This branch adds no
    // page; `master` gained `specs/110-instance-repository/contracts/application-root-supplier.md`
    // while the branch was open, and this walk's population is the documents.
    // **+1, and it is not this branch's.** The document is `specs/113-module-owned-demo-data/tasks.md`, from the chained base.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 12 spec pages and 2 documentation pages the branch adds, which this walk opens as documents.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1284 -> 1302.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 1302 -> 1303.** Neither side's recorded value describes this tree: the
    // branch's 1302 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 1302 exactly, so the whole delta is
    // `specs/114-release-shape-gate/tasks.md`. Its population is `docs/docs` plus `specs`, so none
    // of T140's four files is in it. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the two
    // sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +3, and none of them this branch's.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // **`master` moved this one and no branch re-recorded it.** The three files are
    // `specs/120-migration-closure-bridge-ownership/`'s spec, plan and tasks, which landed at
    // 15b866da3; measured on a pristine worktree of that commit, this entry drifts by exactly
    // the same +3 with none of this branch's files in the tree. It is re-recorded here
    // because the census reads the tree and not the diff, and an entry left stale is one the
    // next author meets with nothing wrong in their own change.

    files: 1318,
    sites: 13,
    sources: [],
    //
    // **1267 -> 1268, and none of it is this branch.** Measured by withdrawing
    // every file the branch adds or moves, the changeset included: the tree still
    // reads **1268**. Re-recorded here because the census asks the merge request
    // that observes a drift to record it, and saying "not mine" while leaving the
    // number wrong would hand the next author the same puzzle with one more merge
    // in front of it.
  },
  'backend/scripts/check-entity-tenant-classification.ts': {
    prefix: '[tenant-classification]',
    run: { kind: 'tsx', path: 'scripts/check-entity-tenant-classification.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It declares no
    // entity.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 251 -> 260.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The module's 9 persisted entity classes, each of which must carry exactly one tenant-scope decorator.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's 9 persisted entity classes, each owing exactly one tenant-scope decorator.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It declares no
    // entity.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // It declares no entity. Quality-job shape: the ignored copies `composer:generate`
    // places under `docs/docs/modules/` swept first, because no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It declares no entity.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 260 -> 265.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sites: 265,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-presence.ts': {
    prefix: '[entry-presence]',
    run: { kind: 'tsx', path: 'scripts/check-entry-presence.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It starts no
    // timer and registers no boot hook.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It starts no
    // timer and registers no boot hook.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // It starts no timer and declares no boot hook. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It starts no timer and registers no boot
    // hook.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-scope.ts': {
    prefix: '[entry-scope]',
    run: { kind: 'tsx', path: 'scripts/check-entry-scope.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It is no entry
    // point: every function it exports is called from a request handler.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It is no entry
    // point.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // It is no entry point of any of the six classes. Quality-job shape: the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It is no entry point: every function in it
    // is called from a registration.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
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
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 43 -> 45.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/113-module-owned-demo-data/` Phase 1: sites 45 -> 44.** T214 deletes the
    // `seed:dev` script, so `src/seeds/dev-catalog-seed.ts` is no longer a **declared
    // program** and leaves the population: `program` falls 5 -> 4 and `package-scripts` 10
    // -> 9. A downward move, recorded in the merge request that shrank the population and
    // nowhere else.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 44 -> 45.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 45,
    sources: ['manifest-index', 'package-scripts'],
  },
  'backend/scripts/check-env-inputs.ts': {
    prefix: '[env-inputs]',
    run: { kind: 'tsx', path: 'scripts/check-env-inputs.ts', args: [] },
    // **`specs/117-instance-bring-up/` Phase 1, recorded on the tree that
    // landed it.** `files` is the runtime sources of the three trees a running
    // Endora is made of: `backend/src` plus the platform's, the storefront's
    // `app`, `components`, `lib` and its own root, and `admin/src`. `sites` is
    // the `process.env` and `import.meta.env` member accesses inside them —
    // #237's finer population, and the one that moves when the syntax walk
    // narrows while the file count holds steady.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4: 682 -> 683.**
    // That branch adds `packages/platform/src/lifecycle/divergence-declaration.ts`,
    // and the platform's own sources are part of the backend tree this walk reads —
    // so an entry that is new in this merge request still had to be re-measured
    // after the rebase rather than carried across it.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 685 -> 691 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` T122: 685 -> 687 (+2).** The admin tree's
    // walk became the layout's **host roots** — the admin project's and
    // `@endora-commerce/admin-shell`'s — because T120 moved all three of the
    // admin's `import.meta.env` reads into the shell and this check exits 2 on
    // a consumer that contributed none. The 106 files are read at their new
    // paths, so the +2 is the shell's barrel and its `src/types/env.d.ts`.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **Feature 115 Phase 6: 693 -> 690.** Re-measured on the union after rebasing
    // onto `79a1befe6`: `specs/110-instance-repository/` T123 moved this entry not at all,
    // so the value below is a census of the combined tree and not an arithmetic. 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 690 -> 691.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 690 -> 681.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 691 -> 681.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (682), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 690 -> 697 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files, `sites`
    // unmoved.** The backend tree's roots already include the platform's own, so
    // the eight new `db/` sources arrive and the two that left `backend/src/db/`
    // go. `sites` stayed at 67 deliberately: `mikro-orm.config.ts` reads
    // `DATABASE_URL`, `NODE_ENV` and `DB_DEBUG` off `process.env` directly rather
    // than off an injected environment, because a value reached through a
    // parameter is a declared input this check cannot see — measured, as two
    // `unread-input` findings, before that was put back.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 695 -> 696.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. Both of those two are in this walk's population.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 698
    // -> 699 (+1).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads `backend/src/seeds/demo-relocated-reference.ts`,
    // and nothing else.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 700 -> 699.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **`specs/110-instance-repository/` T118: sites 67 -> 68 (+1).** The environment reads
    // moved from `backend/src/composition.ts` into the platform file, which this walk covers,
    // and one is genuinely new: `compose-app.ts` reads `SETTINGS_SECRET_ENCRYPTION_KEY` at the
    // settings-kernel call **and** at the warning beside it, where the application file read it
    // once into a local. **The first draft of that file bound `const env = process.env` and
    // this number fell to 58**, with `REDIS_URL` and `REVALIDATE_SECRET` reported as
    // `unread-input` — an alias hides every read behind it, so each is spelled at its own site.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 699 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 700 -> 697 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 697 -> 698 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 700 -> 701 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 701 -> 699. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 699 -> 672 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **T119a: 672 -> 663.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **`specs/110-instance-repository/` T119b: files 663 -> 652 (-11).** the eleven re-export
    // shims `specs/110-instance-repository/` T119b deleted from `backend/src` (`demo/index.ts`,
    // `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely. This walk's
    // population is the trees that declare environment inputs, so all eleven were in it.
    // **`specs/110-instance-repository/` T119c: files 652 -> 646 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    files: 649,
    sites: 68,
    // `declared-consumers` is `ENVIRONMENT_CONSUMERS`, the contract package's
    // own enum: an author written nowhere near this check and unmoved by
    // anything a declaration does. A consumer counts as covered only when it
    // both declares an input and contributed a read, so losing either half is
    // a short walk rather than a quiet one.
    sources: ['declared-consumers'],
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
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 128 -> 130.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 130 -> 134.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 134,
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 867 -> 883.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`chore/094-retire-error-table` (over !1508): 883 -> 888.** The tip of `094-akeneo-pim-sync` read 883, so
    // the whole move is this branch's. The five bundle keys the walk gains: seven
    // `errors.PIM_AKENEO_*` pairs now route to a declaring module and two duplicate
    // `errors.PIM_CONNECTOR_ALREADY_ACTIVE` copies leave `pim_akeneo`'s bundles. The
    // `sources` token moves with it, `manifest-index:39/39` -> `40/40`: `pim_akeneo` joins
    // the modules that declare an error code, which is this walk's floor.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 888 -> 905.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 905,
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
    // **T118c, `mfaActorBridge`: +1 file** — `test/integration/mfa/account-identity-wiring.test.ts`.
    // It defaults no fixture read.
    // Re-recorded for issue #275, which widened the read detection to
    // destructuring bindings and `getKnex()` builder chains. Measured rather
    // than inferred: on this tree the unwidened check read 427 and the widened
    // one 443, so **17 files** are ones it had been opening and reporting clean
    // because it recognised no read in them (one net, after the two repaired
    // sites stopped reading at all). The other 22 of the 405 → 443 move is the
    // tree growing since 2026-08-19, which `files` shows at 1237 → 1302. Both
    // numbers were inside the band; this is the MR that changed the population,
    // so this is where they get re-recorded.
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 2: +1 file.**
    // the one new backend test file,
    // `test/unit/scripts/check-storefront-indexability.test.ts`; `sites` is
    // unmoved, because it holds no read with a fabricating fallback.
    // Measured rather than reasoned about: this branch's added files were
    // moved aside and each check re-run, so the figure below is this merge
    // request's own contribution and nobody else's. The entries this branch
    // moved *jointly* with `master` are left for their owners.
    // **Feature 103 (overlay file shadowing retired): 1750 -> 1748.** Fifteen test
    // and fixture files go — four `test/overlay` suites whose subject is gone and
    // five fixture trees — and three arrive with the id-collision red proof.
    // Recording the observed value absorbs **+10** left by earlier merges (this
    // branch's base, 36174efa1, observed 1760 against a recorded 1750).
    // **F7: +1**, `test/unit/acceptance/storefront-scaffold-assertions.test.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): sites 569 -> 555, files 1752 ->
    // 1556.** 196 harness-free single-owner test files leave `backend/test/`. `sites`
    // falls by 14, the reads those files carried.
    // **Feature 110 Phase 1: 1559 -> 1561.** The two test files this branch adds under
    // `backend/test/`. `sites` moves with them — see below.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 1561 -> 1565.**
    // Four test files — the demo plan, the demo runner, the host command and
    // the manifest declaration.
    // **1565 -> 1566 (this branch, +1): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 1 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 1565.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 1566 -> 1569.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The two-regime guard
    // and its analysis helper, `test/unit/db/instance-migration-order.test.ts` and
    // `test/helpers/instance-migration-order.ts`.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1571 -> 1572 (+1).** One file,
    // `packages/platform/src/lifecycle/manifest-registry.test.ts`: the moved derivation's proof,
    // driven over three suppliers it builds, at the package specifier an instance
    // would write.
    // **`specs/117-instance-bring-up/` Phases 1-2: +2 files.** The two tests this feature adds under
    // `backend/test` — `unit/scripts/check-env-inputs.test.ts`, the new check's
    // companion, and `unit/packages/platform-env-subpath.test.ts`, which is what
    // holds the platform's `./env` subpath open now that the check reads the
    // declaration's source text rather than its build output.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file.** The ratchet the phase
    // leaves behind, `test/unit/kernel/composition-module-value-imports.test.ts`:
    // the production composition root names no module package as a value import.
    // The two `_i18n` error-code tests moved to `test/unit/kernel/` in the same
    // merge request and cancel, being a move rather than an addition.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/110-instance-repository/` Phase 3 (T123): 1575 -> 1576 (+1).** The
    // population is `backend/test`, and the one file is
    // `test/unit/packages/tailwind-sources.test.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1576 -> 1617.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **-23 is
    // this branch's test move** — this walk's population is `backend/test/**`, which those
    // 23 files left.
    // **`specs/110-instance-repository/` T114a: +2 files.** The two `.ts` files
    // under `backend/test/` the task adds — `unit/overlay/deployment-root-supplier.test.ts`
    // and the `divergence.ts` of the source-tree deployment fixture. Its other two
    // fixtures are committed JavaScript, deliberately (issue #130: what is under test
    // is the file name the loader resolves), and this walk reads `.ts`.
    // **1 576 -> 1 577** with T129b's companion test, which is one more file under `backend/test/`.
    // **+2, re-measured on the chained union.** This walk opens `backend/test/**`: it gains T114a's `deployment-root-supplier.test.ts` from the base and this branch adds none there, the admin test being under `admin/test/`.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This walk opens `backend/test/**` and takes the module's 42 new test files, less those outside its shape.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 1620 -> 1621.** one file:
    // `test/integration/demo/demo-parity.test.ts`, the demo parity comparison.
    // **`specs/110-instance-repository/` T118: +1 file.**
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, which holds the two
    // sides of the contribution split disjoint and their union at 61. It is the only
    // file this task adds under a test root.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 1621 -> 1623 (+2).**
    // The two `backend/test/**` files this phase adds: the companion test and its
    // fixture builder.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 1622 here — so this branch's own contribution is +2. This walk opens `backend/test/**`, so it takes the companion test and its fixture helper.
    // **`fix/admin-image-root-scripts`: files 1624 -> 1626.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files are under `backend/test/`.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1626
    // -> 1627. One file,
    // `backend/test/contract/cms/storefront-asset-embed.contract.test.ts`; this walk's
    // population is `backend/test/**`.
    // **`specs/110-instance-repository/` T119a: 1626 -> 1576.** the fifty unit test files
    // T119a moved out of `backend/test/unit/` and into `packages/platform/src`, beside the
    // sources they cover.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 1576 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 1626 -> 1628.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, this walk opens `backend/test/**`, so it takes the two new test files under `backend/test/unit/ci/` and nothing else the branch adds.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 1628 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: 578 -> 579 sites, +1 file.** The file is the new
    // integration test. The site count rises by one while the harness *loses* a defaulted
    // read: `returnsBridge.resolveChannelLanguage`'s channel lookup and its `?? 'en-US'`
    // went out of `test-server.ts` with the bridge, and the `DEFAULTED_FIXTURE_READS`
    // entry describing it is retired on the condition the entry itself wrote down. The new
    // test file's own reads are the other two.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 1578 -> 1580. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **D-223: files 1581 -> 1583 (+2).** The two integration tests it adds,
    // `backend/test/integration/invoices/logo-asset-bytes.test.ts` and
    // `.../product_feeds/image-urls-are-absolute.test.ts`.
    // **T11A (`specs/110-instance-repository/`): files 1583 -> 1585, sites 580 -> 581.**
    // T11A's two files, and one read site — `files.get(path) ?? ''` in
    // `test/helpers/host-residue.ts`, a read of the injected file map rather than of a
    // database, so it is counted and is not a finding. Attributed by parking each file
    // separately: the helper carries the site, the test carries none.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1583 -> 1584, the one file the branch adds under
    // `backend/test`, `test/integration/megamenu/cross-module-targets.test.ts` — the composed
    // proof for the three bridge members no test in the tree read before it.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 1584 recorded before it: 1586. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the one file the branch adds under `backend/test/` —
    // `integration/pwa/cross-module-wiring.test.ts`, the half of the proof that can see
    // the wiring. Its one new `sites` entry is the `push_messages` read the
    // order-status case polls, bound to a name and branched on rather than defaulted.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +1 file** — `backend/test/integration/invoices/cross-
    // module-wiring.test.ts`.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 1588 recorded against the tree before it: 1590. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 1587 -> 1589.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 1589 -> 1592.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1590 -> 1620.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 1620 -> 1622.** Neither side's
    // recorded value describes this tree: this branch's 1620 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 1592 was measured
    // without feature 119's two module packages. The +2 is the two files the master side adds
    // under `backend/test/`, which is this walk's whole population; measured by parking all
    // four of that side's additions, which reads 1620 exactly. Quality-job shape — the ignored
    // copies under `docs/docs/modules/` swept first. Measured on the combined tree, never
    // summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 1592 -> 1593.** One: `backend/test/unit/acceptance/instance-assertions.test.ts`. Its population is `backend/test/**` and the criterion's own sources are not tests.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 1622 -> 1623.** Neither side's recorded value describes this tree: the
    // branch's 1622 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 1622 exactly, so the whole delta is
    // `backend/test/unit/acceptance/instance-assertions.test.ts`; its population is
    // `backend/test/**` and the criterion's own sources are not tests. Quality-job shape — the
    // ignored copies under `docs/docs/modules/` swept first. Measured on the combined tree, never
    // summed from the two sides' deltas.
    files: 1625,
    // **Batch 13 (feature 091, Phase 4): +1**, a fixture read in the batch's own
    // backend off-state test.
    // **Batch 14 (feature 091, Phase 4): +1 file and +1 site.** The batch's own
    // backend test,
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // which boots the server and therefore reads the database — so it joins
    // both the walk and the finer population in the same merge request.
    // **Batch 15: 532 -> 533.** One read site in the batch's own backend
    // integration test.
    // **Feature 110 Phase 1: 555 -> 556.** One, and it is
    // `test/unit/ci/instance-build-inputs.test.ts` — measured by parking each of the
    // branch's two new test files in turn and re-running, because this population is
    // *files carrying a read this check recognises* and which of the two carried one
    // is not something to reason about. It reads no database: its `.find(…)` over the
    // declared input list is in the check's read vocabulary, and it defaults nothing,
    // so `violations` and the ledger are unmoved.
    // **CI gate reconciliation: 556 -> 557.** One site, in the test file and not
    // in the two helpers: a manifest read with a `?? {}` fallback in
    // `readMembers`. Measured by parking the test file, which reads 556.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 557 -> 577.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/113-module-owned-demo-data/` Phase 1: sites 577 -> 578.** the same file: it
    // reads the database, which is this walk's finer population.
    // **`specs/110-instance-repository/` T118a: sites 578 -> 579.** One site, and it is
    // not a database read: `packageNameOf` in `test/unit/kernel/boundary-check.test.ts`
    // looks a module package's npm name up with `[...map].find(…)`, and `find` is in this
    // check's `DB_READS` vocabulary. It is a site and not a finding — the fallback is a
    // `throw`, which keeps the absence visible, and this walk's population is reads bound
    // to a name rather than reads it has decided are the ORM's. Measured on
    // `origin/master` (578) and on this branch (579), never by subtracting a delta.
    // **`fix/admin-image-root-scripts`: sites 579 -> 580.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. One more read-with-a-fallback site, in the two new files; it is not a fixture substitution and the check clears it.
    // **T119a: sites 580 -> 578.** Two read-with-a-fallback sites travelled with those
    // fifty files; the site count falling while this walk's file count falls with it is
    // the same population leaving, not the #235/#237 shape.
    // **D-223: sites 579 -> 580 (+1).** One more entity read in the two integration tests
    // this branch adds, neither of them defaulted.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 582 -> 586.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): sites 586 -> 587.** Neither side's recorded value describes this tree: the
    // branch's 586 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 586 exactly, so the whole delta is the `manifests.find(...)` that
    // derivation uses — `find` is in this check's read vocabulary, and the site is correctly
    // **not** a violation because its fallback is a `throw` rather than a fabricated value.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 587 -> 588 (+1).** One more classified read in the two new files under `packages/cli/test/new-instance/`. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    sites: 588,
    sources: [],
  },
  'backend/scripts/check-harness-teardown.ts': {
    prefix: '[harness-teardown]',
    run: { kind: 'tsx', path: 'scripts/check-harness-teardown.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — the new `mfa` integration test, which calls
    // `teardownBackendServer` and releases nothing itself.
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 14 (feature 091, Phase 4): +1 file.** The backend test tree gains
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // the server half of the batch's off-state proof.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 2: +1 file.**
    // the one new backend test file this phase adds.
    // Measured rather than reasoned about: this branch's added files were
    // moved aside and each check re-run, so the figure below is this merge
    // request's own contribution and nobody else's. The entries this branch
    // moved *jointly* with `master` are left for their owners.
    // **Feature 103 (overlay file shadowing retired): 1750 -> 1748.** Fifteen test
    // and fixture files go — four `test/overlay` suites whose subject is gone and
    // five fixture trees — and three arrive with the id-collision red proof.
    // Recording the observed value absorbs **+10** left by earlier merges (this
    // branch's base, 36174efa1, observed 1760 against a recorded 1750).
    // **F7: +1**, `test/unit/acceptance/storefront-scaffold-assertions.test.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1752 -> 1556.** 196
    // harness-free single-owner test files leave `backend/test/`.
    // **Feature 110 Phase 1: 1559 -> 1561.** The two test files this branch adds under
    // `backend/test/`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 1561 -> 1565.**
    // Four test files — the demo plan, the demo runner, the host command and
    // the manifest declaration.
    // **1565 -> 1566 (this branch, +1): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 1 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 1565.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 1566 -> 1569.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The two-regime guard
    // and its analysis helper, `test/unit/db/instance-migration-order.test.ts` and
    // `test/helpers/instance-migration-order.ts`.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1571 -> 1572 (+1).** One file,
    // `packages/platform/src/lifecycle/manifest-registry.test.ts`: the moved derivation's proof,
    // driven over three suppliers it builds, at the package specifier an instance
    // would write.
    // **`specs/117-instance-bring-up/` Phases 1-2: +2 files.** The two tests this feature adds under
    // `backend/test` — `unit/scripts/check-env-inputs.test.ts`, the new check's
    // companion, and `unit/packages/platform-env-subpath.test.ts`, which is what
    // holds the platform's `./env` subpath open now that the check reads the
    // declaration's source text rather than its build output.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file.** The ratchet the phase
    // leaves behind, `test/unit/kernel/composition-module-value-imports.test.ts`:
    // the production composition root names no module package as a value import.
    // The two `_i18n` error-code tests moved to `test/unit/kernel/` in the same
    // merge request and cancel, being a move rather than an addition.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/110-instance-repository/` Phase 3 (T123): 1575 -> 1576 (+1).** Same
    // population and the same one file as `check-fixture-substitution` above:
    // `test/unit/packages/tailwind-sources.test.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1576 -> 1617.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **-23 is
    // this branch's test move** — this walk's population is `backend/test/**`, which those
    // 23 files left.
    // **`specs/110-instance-repository/` T114a: +2 files.** The two `.ts` files
    // under `backend/test/` the task adds — `unit/overlay/deployment-root-supplier.test.ts`
    // and the `divergence.ts` of the source-tree deployment fixture. Its other two
    // fixtures are committed JavaScript, deliberately (issue #130: what is under test
    // is the file name the loader resolves), and this walk reads `.ts`.
    // **1 576 -> 1 577** with T129b's companion test, which is one more file under `backend/test/`.
    // **+2, re-measured on the chained union.** The same `backend/test/**` population as `check-fixture-substitution.ts` above, and the same two files.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The same `backend/test/**` population as `check-fixture-substitution.ts` above.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 1620 -> 1621.** one file:
    // `test/integration/demo/demo-parity.test.ts`, the demo parity comparison.
    // **`specs/110-instance-repository/` T118: +1 file.**
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, which holds the two
    // sides of the contribution split disjoint and their union at 61. It is the only
    // file this task adds under a test root.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 1621 -> 1623 (+2).**
    // The two `backend/test/**` files this phase adds: the companion test and its
    // fixture builder.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 1622 here — so this branch's own contribution is +2. The same `backend/test/**` population as `check-fixture-substitution.ts` above.
    // **`fix/admin-image-root-scripts`: files 1624 -> 1626.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files are under `backend/test/`; neither touches the harness.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1626
    // -> 1627. One file, the new contract test; this walk's population is
    // `backend/test/**`.
    // **T119a: 1626 -> 1576.** the fifty unit test files T119a moved out of
    // `backend/test/unit/` and into `packages/platform/src`, beside the sources they
    // cover.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 1576 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 1626 -> 1628.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, this walk opens `backend/test/**`, so it takes the two new test files under `backend/test/unit/ci/` and nothing else the branch adds.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 1628 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — the new integration test, which releases
    // through `teardownBackendServer`.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 1578 -> 1580. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **D-223: files 1581 -> 1583 (+2).** The two integration tests it adds,
    // `backend/test/integration/invoices/logo-asset-bytes.test.ts` and
    // `.../product_feeds/image-urls-are-absolute.test.ts`.
    // **T11A (`specs/110-instance-repository/`): files 1583 -> 1585.** T11A's two files.
    // Neither stands a harness up, so the site count does not move.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1583 -> 1584, the one file the branch adds under
    // `backend/test`, `test/integration/megamenu/cross-module-targets.test.ts` — the composed
    // proof for the three bridge members no test in the tree read before it.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 1584 recorded before it: 1586. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the one file the branch adds under `backend/test/` —
    // `integration/pwa/cross-module-wiring.test.ts`, the half of the proof that can see
    // the wiring.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +1 file** — `backend/test/integration/invoices/cross-
    // module-wiring.test.ts`.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 1588 recorded against the tree before it: 1590. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 1587 -> 1589.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 1589 -> 1592.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1590 -> 1620.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 1620 -> 1622.** Neither side's
    // recorded value describes this tree: this branch's 1620 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 1592 was measured
    // without feature 119's two module packages. The +2 is the two files the master side adds
    // under `backend/test/`, which is this walk's whole population; measured by parking all
    // four of that side's additions, which reads 1620 exactly. Quality-job shape — the ignored
    // copies under `docs/docs/modules/` swept first. Measured on the combined tree, never
    // summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 1592 -> 1593.** The same one test file, on the same `backend/test/**` population.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 1622 -> 1623.** Neither side's recorded value describes this tree: the
    // branch's 1622 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 1622 exactly, so the whole delta is the same one test file, on the
    // same `backend/test/**` population. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the two
    // sides' deltas.
    files: 1625,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-kernel-boundary.ts': {
    prefix: '[kernel-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-kernel-boundary.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It relates into
    // nothing and names no module.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **`specs/110-instance-repository/` T118a: sites 31 -> 103 (+72).** `files` does not
    // move at all — it is rule A's population, the whole of the source roots — and this
    // is the #235/#237 shape from the other side: the file count stands still while the
    // finer population trebles. Rule B's roots stopped being the four-element literal
    // `['kernel', 'http', 'events', 'tenancy']` and became the platform's own
    // directories, all fourteen, so its walk went 74 -> 146 files and its outward
    // imports 26 -> 98. The 72 sites are those 72 imports: every one of them was
    // already on disk and outside the rule. Measured on `origin/master` before the
    // change and on this branch after it, never by subtracting a delta.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **A duplicate `files` key stood here.** The re-record that landed with T118 added a
    // second one rather than editing this, and in an object literal the last wins — so the
    // new value was dead and the census went on reading the old one. One key, measured on a
    // pristine `origin/master` worktree at 2174, plus this branch's one new platform source.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`. Its `sites` does
    // not move: the new file's outward imports are `@endora-commerce/contracts` and the
    // platform, and this walk's third population is the platform's outward imports, not a
    // module's.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It relates into
    // nothing.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`).
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The site is that file's own contracts import.
    // **`specs/110-instance-repository/` T118: sites 103 -> 137 (+34).** Rule B's population is
    // the platform's outward imports, and T118a had just widened it to every platform
    // directory — so the assembly arriving in `packages/platform/src/composition/` brings its
    // own imports into that walk: platform files 146 -> 147 and outward imports 98 -> 132,
    // measured on `origin/master` before and on this branch after, never by subtracting a
    // delta. `into-modules` stays 0, which is the whole of what T118's "Done when" asks.
    // **`specs/110-instance-repository/` T119b: sites 137 -> 141 (+4).** Four export
    // declarations added to `packages/platform/src/composition/index.ts`, which rule B counts
    // as outward imports out of a platform root: `registerErrorEnvelope` from
    // `http/error-envelope.js`, `parseTrustedProxy`/`TrustedProxy` from
    // `http/trusted-proxy.js`, `AdminActorPromotion` from `kernel/ports/require-admin.js` and
    // `absolutizePublicUrl` from `kernel/public-api-base-url.js`. The other twelve names this
    // task publishes joined export declarations that already existed, so they add no site.
    // `into-modules` stays 0, which is what the rule is about, and `platform-subpaths` moves 13
    // -> 14 with `./demo` — a derived reconciliation and not a band.
    // **T118c, `mfaActorBridge`: sites −1.** Resolving this branch against T119b took
    // `AdminActorPromotion` off the `./composition` barrel — the drain removed the
    // application's last consumer of the type, and the barrel is held to its consumers both
    // ways — so the re-export line itself, which this walk counts as an outward import, is
    // gone: 141 -> 140.
    // **`specs/110-instance-repository/` T119c: sites 140 -> 141 (+1).**
    // `packages/platform/src/composition/index.ts` gains one outward re-export —
    // `ModuleRegistration` off `../kernel/lifecycle/module-registration.entity.js`, the
    // address T119c gives the one platform entity class no published barrel carries.
    // Rule B's population is the specifiers a platform root names, so it counts; the
    // target is platform-internal, so `into-modules` stays 0.
    // **D-223: sites 140 -> 139 (-1).** One export declaration off
    // `packages/platform/src/composition/index.ts` — `absolutizePublicUrl`, whose last
    // consumer went with the two composition-root sites that rebased an asset URL. Rule B
    // counts a platform file's outward imports and a re-export is one, so the barrel losing
    // a name moves this by exactly one.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 139 recorded against the tree before it: 140. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    sites: 148,
    // `platform-subpaths` is T118a's second author over rule B's population: the
    // platform's `exports` map is a different program's answer to "which directories
    // does this package have", and a published subpath naming no walked directory is a
    // short walk rather than a clean one. It reconciles 13/13 and cannot reconcile 14 —
    // `src/demo/` is a directory with no subpath of its own, which is exactly why the
    // map is the corroboration and the directory listing is the derivation.
    sources: ['manifest-index', 'platform-subpaths'],
  },
  'backend/scripts/check-lock-claims.ts': {
    prefix: '[lock-claims]',
    run: { kind: 'tsx', path: 'scripts/check-lock-claims.ts', args: [] },
    // Re-recorded for issue #279, which added `packages/contracts/src` to the
    // population: 113 → 192 files and 6 → 9 named-subject claims on the tree
    // the widening landed against. The second source is the contracts barrel,
    // `index.ts`, which is what the package says it publishes — the same
    // derived floor the manifest index provides for the module half.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 2: +1 file.**
    // the new check script, which carries reason strings and so joins this
    // walk. Its `sites` figure moved on `master` alone and is left for its
    // owner.
    // Measured rather than reasoned about: this branch's added files were
    // moved aside and each check re-run, so the figure below is this merge
    // request's own contribution and nobody else's. The entries this branch
    // moved *jointly* with `master` are left for their owners.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 3: +3 files.**
    // `scripts/check-rsc-discipline.ts` and its two ledger shards under
    // `scripts/ledgers/client-fetches-on-first-paint/`. `sites` is unmoved: none
    // of the three makes a claim about a module's switchability.
    // Measured by parking this branch's added files and re-running, so the
    // figure is this merge request's own contribution and nobody else's; the
    // entries this branch moved *jointly* with `master` are left for their
    // owners.
    // **2026-09-04: 226 -> 240, and this one is a correction rather than growth.**
    // Counted at the commit that set 226 and at this one, the four population
    // components are flat -- ledger shards 45 -> 45, module manifests 70 -> 70,
    // `packages/contracts/src` 89 -> 88, `check-*` scripts 35 -> 35. So the tree
    // did not grow into 240; 226 was already below what the walk read when it was
    // recorded, and stayed inside the +50% band for a day. Worth stating rather
    // than quietly bumping: a re-record can under-record, and the band cannot see
    // it in that direction either.
    // **`specs/117-instance-bring-up/` Phases 1-2: +2 files.** Both halves of this walk's population grow by
    // one: `backend/scripts/check-env-inputs.ts` is a new `check-*` script, and
    // `packages/contracts/src/environment-inputs.ts` is a new contract file the
    // barrel re-exports — which is why `contracts-barrel` moves with it.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 300 -> 303.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is this branch's
    // test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`, the shard it
    // opens for the two files that stay.
    // **300 -> 303** with T129b: two new ledger files (`undefined-class-renders.ts`, `unrendered-class-definitions.ts`) and the analysis that declares their type, all of them artefacts whose job is to carry a reason.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's manifest and the ledger shards that carry a reason naming it.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 306 -> 307 (+1).**
    // One file — `backend/scripts/check-demo-data-budget.ts`, which carries a
    // ledger of its own (`DEMO_ASSETS_OVER_BUDGET`) and so joins the population of
    // artefacts whose job is to carry a reason.
    // **`specs/110-instance-repository/` T118b: files 307 -> 308 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 308 -> 312.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 312,
    // **2026-09-04: 14 -> 15.** One further named-subject lock claim.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge` retired):**
    // sites 15 -> 17, files unchanged. `pwa`'s manifest gains `orders` in its
    // `dependencies`, and the comment above the array says why the bind costs no operator
    // a control — which is a named-subject lock claim, so this check reads it. Two of the
    // three ids that sentence names land as claims (`orders`, `sales_channels`); the third,
    // `assets_library`, shares its assertion with a nearer subject and is out of the window
    // by construction. `files` does not move because the manifest was already in the walk.
    sites: 17,
    sources: ['manifest-index', 'contracts-barrel'],
  },
  'backend/scripts/check-admin-zones.ts': {
    prefix: '[admin-zones]',
    run: { kind: 'tsx', path: 'scripts/check-admin-zones.ts', args: [] },
    // **T118c, `mfaActorBridge`: +2 files** — `mfa`'s new module source and its co-located
    // test; this walk opens a package's tests as well.
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
    // **Batch 13 (feature 091, Phase 4): -1**, the deleted
    // `FulfilmentStrategyPicker` shim. Neither `sites` nor `zone-enum` moves:
    // the batch moves registrations and declares no zone member, no render and
    // no contribution — which is the row's own claim that its four modules were
    // contributors before a screen moved.
    // **Batch 14 (feature 091, Phase 4): -3 files.** The same net movement the
    // sibling rows record: eighteen screens move from the admin application
    // into three packages, five residue files go, three contribution entries
    // and two `tsconfig.ui.json`s arrive. `renders` and `contributions` are
    // unchanged at 25 and 24, which is the batch's own claim: the three hosts
    // still mount their zones from inside their packages.
    // **Batch 15: 2246 -> 2243.** The same net three as the sibling entries —
    // four deleted shims, one new `admin/index.ts`. `sites` does not move:
    // `renders=25 contributions=24 foreign-ids=1` on both sides of the move,
    // which is the batch's zone assertion read from this check's side.
    //
    // **Batch 16 + Phase 5: 2243 -> 2325, and 50 -> 53.** Two movements, and
    // only the first is this branch's: `pim_unopim` merged from
    // `specs/089-unopim-pim-sync/` with a whole module package and an admin
    // layer, which is +2 contributions and the bulk of the files. This branch
    // itself moves `cms`' and `blog`' screens into their packages — a wash for
    // a walk that reads both roots — and then **T4 restores 107 files**: the
    // `admin/src` walk had silently gone to zero on the merge of batches 15
    // and 16, because `adminFiles = admin === null ? [] : walk(…)` and the
    // layout refused for a reason having nothing to do with this check
    // (`admin-kit-surface.md` §7.5). The fall was 2243 -> 2127, a 5.2% drop
    // comfortably inside this band; what caught it was the `sources` set
    // beside it, which lost `module-admin` over 54 layers. **The number is
    // therefore not comparable to 2243 as a like-for-like** — 2243 was a walk
    // that included `admin/src` and 2325 is the same walk on a tree that has
    // since gained a module package.
    //
    // **D-168 repair: 2325 -> 2324.** One file, and it is the whole of this
    // branch: `pim_connector`'s `services/field-path.ts` is deleted. It was a
    // four-line re-export of two `@endora-commerce/contracts` functions that
    // nothing imported, and its only reader was the module's own `./backend`
    // barrel, which republished them — the bare specifier the D-168 analysis
    // reports as `unresolvable-reexport`. `sites` does not move: the file
    // rendered no zone, contributed to none and named no module id.
    // **Feature 105: 2330 -> 2329.** `admin/src/modules/cms_pages/CmsPagesPage.tsx`,
    // in the `admin/src` population. `sites` is unmoved and the four `sources`
    // tokens with it — the deleted screen rendered no zone, contributed to none,
    // and named no module id.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2329 -> 2577.** +248 = 196
    // harness-free single-owner test files leave `backend/test/` into the module walk
    // roots this check reads, plus the 52 new configurations.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2577 -> 2578.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2578 -> 2580 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2580 -> 2581 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2580 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2580 -> 2586 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` T120: 2580 -> 2582 (+2).** The admin
    // shell became `@endora-commerce/admin-shell` and this walk's admin
    // population became the layout's **host roots** — the admin project's and
    // the shell's — so the 106 files that moved are read at their new paths and
    // the count is a wash. The two are the package's own new files: its barrel
    // (`src/index.ts`) and its `src/types/env.d.ts`. `sites` does not move at
    // all, which is the property T122 exists to produce: the same renders, the
    // same contributions and the same one foreign id, read at different
    // addresses.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2588 -> 2680.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+23 is
    // this branch's test move** — the 23 harness-free `pim_akeneo` tests entering the
    // module walk roots from `backend/test/`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 53 -> 56.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's admin layer and the tests beside it, both inside this walk.
    // **`fix/search-reindex-task-timeout`: files 2681 -> 2682.** One file: `packages/modules/search/src/backend/services/search-indexer-task-wait.test.ts`, the co-located unit test for the indexer's task wait. This walk reads a module package's sources, so a new file under one lands here.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2682
    // -> 2699 (+17).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the sixteen module `.ts` files plus
    // `demo-relocated-reference.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2699 -> 2715.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2715
    // -> 2717 (+2). that module source and its co-located test.
    // **T119a: 2715 -> 2720.** +5, `_lifecycle`'s own co-located tests: five of the fifty
    // moved files landed in `packages/platform/src/lifecycle`, which this check walks as a
    // module root.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2720 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +2 files** — the new module source and its co-located
    // test, which this walk opens as module sources. No zone and no namespace moved.
    // **D-223: files 2726 -> 2729 (+3).** `public-url-base.ts` plus the two co-located
    // tests beside it, `public-url-base.test.ts` and `services/assets-library-url.test.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2729 -> 2733, the four module-package files the branch adds
    // — the two sources (`cms-block-read-port.ts`, `cross-module-ports.ts`) and their two
    // co-located tests. This walk reads a module's `.ts` including the test spellings; the
    // backend integration test and the changeset are outside it.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2733 -> 2737, the one new module source
    // and the three co-located tests — this walk opens a package's tests as well.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds
    // (`services/cross-module-context.ts`, `request-actor.ts`) plus their two
    // co-located tests, this walk reading a module package's `.test.ts` as well as its
    // sources.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2737 -> 2741. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +2 files** — `invoices`' new module source
    // (`services/cross-module-context.ts`) and its co-located test.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2743 -> 2807.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    files: 2811,
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's three admin render or contribution sites.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 56 -> 66.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 66,
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
    //
    // **2588 -> 2589.** D-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. This walk
    // reads a module package's sources and not `backend/test`, so the move is an
    // arrival rather than a transfer — measured, by taking the file back out.
  },
  'backend/scripts/check-block-names.ts': {
    prefix: '[block-names]',
    run: { kind: 'tsx', path: 'scripts/check-block-names.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It names no
    // block.
    // Source files opened, and the population is two trees that overlap: every
    // module's own sources (`layout.moduleWalkRoots`) plus every page-builder
    // family member's `src`. `migrations/` and `*.test.ts` are out by decision,
    // so the number moves with ordinary module code and not with a migration or
    // a test.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1937 -> 1989.** 52 module
    // packages gain a `vitest.config.ts`.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1989 -> 1990.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1990 -> 1992 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 1992 -> 1993 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 1992 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **`specs/115-lifecycle-container-move/` Phase 5: 1992 -> 1998 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1998 -> 2065.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2065
    // -> 2078 (+13).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files and `taxes`'
    // `vitest.config.ts`; it reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2078 -> 2090.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2090
    // -> 2091. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source.
    // **D-223: files 2093 -> 2094 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2094 -> 2096, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2096 -> 2097, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2098 -> 2099. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It declares no block.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2100 -> 2150.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2151,
    // The finer population, and it is the one that moves when nothing else does
    // (issues #235/#237): tree sites, unreadable sites, renderer-map sites, the
    // block declarations and the declared `(key, context)` sections. A block
    // declared and rendered adds to `sites` and leaves `files` where it was,
    // which is exactly what a widening of this check looks like.
    sites: 266,
    // Four authors, none of them `self-reported`, and each counts a
    // **population** rather than a name set — the check's own header says why
    // §5's two name-set spellings would have made findings 5 and 6 unreachable
    // in production. `manifest-index` is issue #215's shared floor over the
    // module walk. `renderer-maps` is the workspace's page-builder family
    // against the members that produced a site, so a member whose map stops
    // resolving is short rather than silently empty. `block-declarations` is
    // the modules the manifests say declare a block, against those the walk
    // produced a source for. `block-categories` is the declarations' own second
    // author: rule 2 of `block-definition.md` §1 says every declared block
    // names a declared section, so a shortfall is either that rule broken or a
    // manifest read that came back partial.
    sources: ['manifest-index', 'renderer-maps', 'block-declarations', 'block-categories'],
  },
  'backend/scripts/check-class-vocabulary.ts': {
    prefix: '[class-vocabulary]',
    run: { kind: 'tsx', path: 'scripts/check-class-vocabulary.ts', args: [] },
    // **T118c, `mfaActorBridge`: +2 files** — `mfa`'s new module source and its co-located
    // test.
    // Source files opened plus the design system stylesheets read. It moves with
    // the module tree and with the admin-ui family, and it is deliberately *not*
    // the class-attribute positions — that is `sites`, and the two answer
    // different questions: a changed attribute or helper spelling leaves `files`
    // exactly where it was and takes `sites` to zero, which is the #235/#237
    // shape and the state this check's fourth refusal exists for.
    // **+1, re-measured on the chained union.** The check this branch adds walks `packages/` and `admin/src`, and gains the one new platform source that arrives with T114a on the base beneath it.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's admin sources, which this walk opens with the rest of `packages/`.
    // **`fix/search-reindex-task-timeout`: files 2779 -> 2780.** The same one new co-located test file under `packages/modules/search/src/backend/services/`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2780
    // -> 2797 (+17).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the sixteen module `.ts` files plus
    // `demo-relocated-reference.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2797 -> 2813.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2813
    // -> 2815 (+2). that module source and its co-located test.
    // **T119a: 2813 -> 2818.** +5, `_lifecycle`'s five co-located tests, for
    // `check-admin-zones`' reason.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2818 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +2 files** — the new module source and its co-located
    // test.
    // **D-223: files 2824 -> 2827 (+3).** `public-url-base.ts` plus the two co-located
    // tests beside it, `public-url-base.test.ts` and `services/assets-library-url.test.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2827 -> 2831, the four module-package files the branch adds
    // — the two sources (`cms-block-read-port.ts`, `cross-module-ports.ts`) and their two
    // co-located tests. This walk reads a module's `.ts` including the test spellings; the
    // backend integration test and the changeset are outside it.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2831 -> 2835, the one new module source
    // and the three co-located tests. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds
    // (`services/cross-module-context.ts`, `request-actor.ts`) plus their two
    // co-located tests, this walk reading a module package's `.test.ts` as well as its
    // sources.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2835 -> 2839. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +2 files** — `invoices`' new module source
    // (`services/cross-module-context.ts`) and its co-located test.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2841 -> 2905.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    files: 2909,
    // Class-attribute positions classified — `className=`, `class=`, and an
    // argument of `cn(`/`clsx(`/`classNames(`/`twMerge(` outside one. It moves
    // with every screen written, and a run whose `sites` fell while `files` held
    // is the syntax walk going blind rather than the tree shrinking.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The class-attribute sites in the module's admin layer.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 5397 -> 5433.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 5433,
    // `manifest-index` is issue #215's shared floor over the module half of the
    // render walk. `design-system` is the `exports` maps' own answer to *"which
    // packages publish `./theme.css`"* against the stylesheets this run opened,
    // which is the one way the defining half goes silently empty while every
    // other number stays healthy. `module-admin` is the generated admin
    // contribution registry's answer to *"which packages ship admin code"* — a
    // second program's — so a walk that stopped reaching a module's admin layer
    // disagrees with it in the same run.
    sources: ['manifest-index', 'design-system', 'module-admin'],
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
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 128 -> 130.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 130 -> 134.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 134,
    // Every registered module, shipping or not. It moves only with the module
    // set, so a run whose `sites` fell while `files` held is a module that left
    // the index rather than a translation that left a package.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 71 -> 72.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 72 -> 74.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 74,
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
  'backend/scripts/check-module-docs.ts': {
    prefix: '[module-docs]',
    run: { kind: 'tsx', path: 'scripts/check-module-docs.ts', args: [] },
    // The markdown this run opened: every page under the modules category plus
    // the generated module map. 77 pages and the map when it landed, and it
    // moves by one whenever anybody writes or deletes a page — which is the
    // number that has to move, because the whole defect this check exists for
    // was a page nobody's list mentioned.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 104 -> 106.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 106 -> 108.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 108,
    // The finer population, and it answers a different question: the navigation
    // entries the committed sidebar names, the rows the committed map carries,
    // and the relative links a module-owned page writes (R3.7). A page added and
    // not regenerated moves `files` and leaves the first two where they were,
    // which is exactly the drift the check refuses; 78 entries (65 module
    // entries, the map's own, and 12 sub-pages), 71 rows and 45 links.
    //
    // **149 -> 194, and the file count did not move at all** — which is the
    // #235/#237 shape and the reason both numbers are recorded. Phase 2 moved 76
    // of the 78 pages out of the site's tree and into the packages that own
    // them; the same pages are read, out of 64 roots instead of one, and the
    // widening is a *third* population classified for the first time. A run that
    // moved neither number would have said the move changed nothing, and a run
    // that moved only `files` would have said pages were written.
    //
    // **Phase 3: files 78 -> 103, sites 194 -> 264.** `derived-fact-in-prose`'s
    // population is the **site**, not the modules category — § 0.3 measured the
    // sentences across all of `docs/docs`, and an architecture guide names a
    // module's address as readily as the module's own page does — so the walk
    // now opens the 25 pages outside the category as well, and every page it
    // already opened is counted once. The 70 sites are the module addresses it
    // classified, over 69 sentences; one sentence names two. Both numbers had to
    // move and they move for different reasons, which is the #235/#237 shape
    // again: a page written outside the category moves `files` alone, and a
    // sentence added to a page already read moves `sites` alone.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 264 -> 266.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 266 -> 270.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 270,
    // Three authors, each seeing something the others cannot. `manifest-index`
    // is issue #215's shared floor over the module walk, whose unit is the
    // module's own directory. `sidebar-entries` is the **committed artefact's**
    // own entry count, which is what sees the artefact rendering to nothing:
    // `manifest-index` is satisfied by a module contributing any file at all, so
    // an empty sidebar leaves it at full coverage while every page reads as an
    // orphan. Its expected and covered are deliberately the same number — a
    // sidebar missing *one* entry is `orphan-page`, the finding, and reconciling
    // per module would report it as exit 2 instead. `emitted-manifests` is
    // D-164's — a module package's manifest resolves at its build output, so
    // `docs: false` edited in a package's source and not rebuilt reads as absent.
    sources: ['manifest-index', 'sidebar-entries', 'emitted-manifests'],
  },
  'backend/scripts/check-demo-data-budget.ts': {
    prefix: '[demo-data-budget]',
    run: { kind: 'tsx', path: 'scripts/check-demo-data-budget.ts', args: [] },
    // Every file the demo-layer walk enumerated — 32 when this landed: four
    // files (`seed.ts`, `reset.ts`, `rows.ts`, `demo.test.ts`) in each of the
    // eight modules that declare demo data, and nothing under the 64 that do
    // not, because the probe finds no directory there. It moves by four when a
    // module declares or withdraws a demo layer, and by one for every file
    // written into one — including the `.ts` bodies, which is deliberate: this
    // is what the walk *opened*, never what it budgeted.
    files: 32,
    // The shipped non-`.ts` demo assets, and **zero is the invariant rather
    // than a blind run** — the whole of §7.5 is that this number is 0 today and
    // the check locks it there. It is `files` that carries the floor: a walk
    // that went blind while eight manifests still declare a layer is `files=0`,
    // which `read-size.ts` refuses as `read-nothing`, and the check's own
    // `demo-declarations` token refuses the case where one layer of the eight
    // has moved.
    sites: 0,
    // `manifest-index` is issue #215's shared floor over the module walk, whose
    // unit is the module's own directory. `demo-declarations` is the second
    // author and the one this check needed: the expectation is the modules
    // whose **manifest artefact** declares demo data without delegating it to a
    // package, and the coverage is the layers the **filesystem** produced — two
    // different readers of one question, so a demo layer that moved is a short
    // walk rather than a clean line. `emitted-manifests` is
    // `emitted-freshness`', omitted rather than printed `0/0` on a tree where
    // every manifest came from source.
    sources: ['manifest-index', 'demo-declarations', 'emitted-manifests'],
  },
  'backend/scripts/check-default-language-prose.ts': {
    prefix: '[default-language-prose]',
    run: { kind: 'tsx', path: 'scripts/check-default-language-prose.ts', args: [] },
    // **T118c, `mfaActorBridge`: +7 sites, +1 file** — `mfa`'s new module source, whose
    // literals are the two refusal sentences and the strings around them. All English.
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
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 15 (feature 091, Phase 4): 1478 -> 1481.** The three `.ts` files
    // `catalog`' and `orders`' admin layers add to the module walk — this check
    // reads module sources and shipped bundles, and the twenty-four `.tsx`
    // screens are outside its extension set.
    // **Feature 106 (`specs/106-module-owned-tests/`): sites 32288 -> 32496, files 1564
    // -> 1616.** 52 module packages gain a `vitest.config.ts`; `sites` is the literals
    // in them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1616 -> 1617.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1617 -> 1619 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: files 1619 -> 1620, sites 32643 ->
    // 32653.** One file and the ten literals in it:
    // `packages/platform/src/lifecycle/divergence-declaration.ts`, the divergence split's
    // platform half (D115-3), whose two refusal sentences are each built from a run of
    // concatenated fragments — which is what makes a one-file move worth ten sites here
    // and one everywhere else. The two `backend/src` files the split moves are outside
    // this walk, whose population is the module tree. Measured rather than reasoned
    // about: with that one file taken out of the tree it reads 1619 and 32643 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): files -1, sites -6.** The routing
    // derivation moved out of `packages/modules/_i18n/` into the platform, and
    // this walk's population is a module's own sources. The six sites are that
    // one file's classified literals, which left with it — the file is not gone,
    // it is outside this rule's subject, which is prose a **module** ships.
    // **`specs/115-lifecycle-container-move/` Phase 5: files 1619 -> 1625, sites 32647 ->
    // 32854.** The six files D115-1 moves into `packages/platform/src/lifecycle/commands/`, and
    // with them every sentence the five `module:*` commands print. `sites` moves by two hundred
    // where `files` moves by six because this walk's population is a **module's** own sources:
    // `backend/src/lifecycle/scripts/` is host code and was never in it, so the operator text
    // entered this walk by moving into `_lifecycle`'s.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1625 -> 1684.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): sites
    // 34198 -> 34256 (+58), files 1684 -> 1697 (+13).** The branch adds 23 files and
    // removes none: four modules' `src/backend/demo/` (`rows`, `seed`, `reset` and a
    // co-located test each), `taxes`' `vitest.config.ts`,
    // `backend/src/seeds/demo-relocated-reference.ts` — the frozen copy of the moved
    // blocks that keeps the demo parity comparison a comparison — and five changesets.
    // This walk reads the twelve non-test module files and `taxes`' `vitest.config.ts`; it
    // reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 1697 -> 1709, sites 34256 -> 34428.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1709
    // -> 1710 and sites 34428 -> 34429. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`, offering one
    // more literal to the classifier.
    // **T118c, `returnsBridge`: 34429 -> 34470 sites, +1 file.** The site count is per
    // literal, and this drain writes three `refuses-without` manifest entries whose
    // `whenAbsent` and `reason` prose an operator reads, plus the new module source's own
    // doc block. All English; no finding and no ledger entry moved.
    // **D-223: files 1712 -> 1713 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1713 -> 1715, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 1715 -> 1716, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own. `sites` moves by the nine literals those two files
    // put on the classifier's path, every one of them English and therefore not a
    // finding under this check's asymmetry.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 1717 -> 1718. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). The five `sites` are the literals the new
    // file writes; all of them are English, which is what this check has nothing to say
    // about.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1719 -> 1762.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 1763,
    // Every string and template literal the walk offered the classifier. It is
    // deliberately not the findings — a number that moves with the tree's
    // health cannot answer "did you read the tree" — and it is two orders
    // larger than `files`, which is what makes it the number that moves first
    // when a position filter or the parser narrows.
    // **Batch 13 (feature 091, Phase 4): +129.** Prose sites inside the four `.ts`
    // files the batch moves under the module walk roots — `pim_ergonode`'s
    // admin client carries most of them, its doc blocks being the longest of
    // the four.
    // **Batch 14 (feature 091, Phase 4): sites 29468 -> 29549, files 1475 ->
    // 1478.** The three module packages' new `src/admin/` sources enter the
    // walk with the Polish keyword lists the two new manifest actions carry
    // (`organizacja`, `klient`, `kanał`, `sprzedaży`) and the six i18n keys the
    // batch moves out of `_i18n` into the modules' own bundles.
    // **Batch 15: 29549 -> 29646.** The prose sites those three files carry
    // plus the fifteen bundle entries `catalog` and `orders` gain in both
    // shipped languages — the nav labels and `catalog`'s three palette actions,
    // moved out of `_i18n` and therefore counted in each module's bundle now.
    // **Feature 103 (overlay file shadowing retired): 31619 -> 32288.** This change's
    // own contribution is **-2** literals, from the two deleted overlay error classes.
    // The rest is growth from merges this branch rebased onto, and recording the
    // observed value absorbs **+671** of it (this branch's base, 36174efa1, observed
    // 32290). Stated rather than left implicit: the number is re-recorded here because
    // this branch moved it, not because this branch grew it.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 32604 -> 32605.**
    // One literal, and the file count does not move because the file already
    // existed: `packages/platform/src/lifecycle/services/dep-graph.ts` is inside
    // `_lifecycle`'s module walk root, and the module-level topological sort that
    // moved into it from `backend/src/db/migration-order.ts` carries one `''`.
    // **`specs/115-lifecycle-container-move/` Phase 3: 32605 -> 32643 (+38).** The
    // literals in the two files the move adds under
    // `packages/platform/src/lifecycle/` — the id-collision refusal's operator text,
    // which relocated with the rule, and the manifest registry's own refusal. Every
    // one of them is English and none is a finding; the population grew, the debt
    // did not.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 32854 -> 34152.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`chore/094-retire-error-table` (over !1508): 34152 -> 34159.** The tip of `094-akeneo-pim-sync` read 34152, so
    // the whole move is this branch's. The seven `{ code: … }` literals
    // `pim_akeneo`'s manifest gains: this walk classifies literals in a module's own
    // sources, and seven more are classified (all English, so `violations` is unmoved).
    // **`specs/089-unopim-pim-sync/` withdrawal repair: 32854 -> 32851 (-3).** The
    // three literals in the reactivation block this branch deletes from
    // `pim_unopim`'s product phase — one `'inactive'` read and the two `'active'`
    // writes. `files` does not move: the file is still there, three lines shorter.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The module's own literals, which this walk classifies one by one — much the largest population in the estate, so the largest absolute move.
    // **`specs/089-unopim-pim-sync/` re-import repair: 32854 -> 32855 (+1).** The SQL
    // literal in `pim_unopim`'s new `categoryMappingsPostdateProductWalk`, which asks
    // whether a category mapping postdates the last product walk. One literal, English,
    // and not a finding — `files` does not move because the file already existed.
    // **-3 against this branch's own earlier record, re-measured on the union.** The record above
    // was taken before `fix/089-unopim-withdrawal-stays` merged; that branch deleted the
    // reactivation block and the three status literals in it, so the base fell by three. This
    // branch still contributes the one SQL literal its repair adds. Measured on the combined tree,
    // not derived from the two deltas.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's own literals, classified one by one — the estate's largest population, so the largest absolute move.
    // **`fix/search-reindex-task-timeout`: sites 34157 -> 34192.** Thirty-five literals, not files: the new test file's fixture strings and assertion messages, plus the two new error classes' composed sentences in `search-indexer.ts` and the setting's description in `search/src/manifest.ts`. All English, so the finding count does not move.
    // **D-221 (`feat/catalog-new-product-route`): 34198 (+6).** Attributed by
    // measurement, one module source at a time — reverting each file to `master`
    // and re-running: `packages/modules/catalog/src/manifest.ts` **+3** (the
    // `permissions` entry's three string literals, `catalog:write`, its label and
    // `catalog:read`) and `packages/modules/catalog/src/admin/index.ts` **+3** (the
    // `WRITE_PERMISSION` constant and the new route entry's two literals).
    // `ProductsList.tsx` moves it by **zero**, measured, which is why the total is
    // six and not more: its added strings are a permission code inside a call and a
    // translation key, neither of which this classifier counts as a site.
    // **D-223: sites 34477 -> 34486 (+9).** The literals `public-url-base.ts` classifies.
    // All English or empty, so none is a finding; the number moves because the walk counts
    // what it classified.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** sites 34486 -> 34495, nine string literals classified in those
    // two new module sources. None is a finding: the detector is Polish-only and every literal
    // here is English or a path fragment.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** sites 34495 -> 34501, the six literals it
    // classifies in that file, all English. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 34504 -> 34510. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 34515 -> 35188.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    sites: 35206,
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
    // **Batch 13: -1**, the `FulfilmentStrategyPicker` shim, whose last reader
    // (`admin/test/kit/admin-kit-identity.test.ts`) went with `inventory`'s
    // directory.
    // **Batch 15: 385 -> 382.** Net of the move: twenty-seven files leave
    // `admin/src` and arrive under two module packages, which this walk counts
    // either way; what changes the total is the four deleted shims and the one
    // new `catalog/src/admin/index.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 392 -> 403.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 403 -> 417.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 417,
    // **Batch 13 (feature 091, Phase 4): 2361 -> 2305, and the cause is the move's
    // spelling rather than its size.** A published-symbol reach is counted per
    // import statement, and the twenty-four moved screens rewrote thirty `@/…`
    // paths as four consolidated kit subpaths each — same symbols, fewer
    // statements. Four more go with the deleted `FulfilmentStrategyPicker`
    // shim.
    // **Batch 14 (feature 091, Phase 4): 2305 -> 2228, files 388 -> 385.** The
    // batch moves eighteen screens out of `admin/src/modules/` into three
    // packages and deletes five residue files, and each moved screen's `@/`
    // imports collapse into one specifier per kit subpath — sixteen
    // `@/components/ui/*` lines become one `@endora-commerce/admin-kit/ui`
    // line in `OrganizationDetail` alone. `sites` counts published reaches, so
    // it falls with the merge and not with the move.
    // **Batch 15 (feature 091, Phase 4): 2228 -> 2121.** `catalog`' and
    // `orders`' twenty-seven admin files moved into their packages and their
    // `@/`-alias imports became kit-subpath ones, which this check counts as
    // published symbol reaches — fewer of them, because the move consolidated
    // fourteen single-symbol `@/components/ui/*` lines per screen into one
    // `@endora-commerce/admin-kit/ui` import each, and because four re-export
    // shims were deleted with the directories (`catalog`'s `ProductPicker`,
    // `orders`' `Section`, `StatusTransitionGraph` and `orderStatusColor`),
    // each of which was two or three re-export sites of its own.
    //
    // **Batch 16 + Phase 5: 382 -> 392 files, 2121 -> 2158 sites.** The
    // application half is now **zero directories** — the terminal state SC-007
    // reaches — so both numbers are the package half alone, which is what
    // outlives the drain and what grows with every module package (R18). The
    // rise rather than the fall the previous six batches recorded is two things
    // arriving together: `pim_unopim` merged from
    // `specs/089-unopim-pim-sync/` with an admin layer of its own, and this
    // branch moves `cms`' and `blog`' screens out of `admin/src` and into their
    // packages, where this walk reads `.tsx` as well as `.ts` and so counts
    // every screen it used to count under the other root.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 2159 -> 2238.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **D-221 (`feat/catalog-new-product-route`): 2238 -> 2239 (+1).** The new
    // `/catalog/products/new` route entry in `packages/modules/catalog/src/admin/index.ts`.
    // Measured rather than reasoned: removing the `useAuth` import this branch also adds
    // to `ProductsList.tsx` leaves the number at 2239, and removing the route entry alone
    // returns it to 2238. `files` does not move — the branch adds no file this walk opens.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 2239 -> 2296.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 2296,
    // **Three** derivations since Phase 5's T3, none of them the walk counting
    // itself: the generated manifest index for the modules a walked file is
    // attributed to; the kit's own `exports` map against the barrels on disk —
    // a subpath declared and not built, or built and not declared, is what
    // makes a reach unjudgeable; and `admin-registry`, the generated admin
    // contribution registry, which is the floor the package half needed once
    // the application half emptied (R18(4)). `manifest-index` cannot answer for
    // it: that token is satisfied by any owner the walk produced a file for,
    // which a module package does plentifully from its backend sources.
    sources: ['manifest-index', 'admin-kit-exports', 'admin-registry'],
  },
  'backend/scripts/check-module-boundary.ts': {
    prefix: '[module-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-module-boundary.ts', args: [] },
    // **T118c, `mfaActorBridge`: +6 sites, +4 files.** Four for two files, as the
    // `assets_library` census records: this walk reaches a module package's sources under
    // more than one root, and the backend integration test is outside its population. The
    // sites are the specifiers the two new module files write.
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
    // **Batch 13 (feature 091, Phase 4): +3.** Its module half gains all
    // twenty-four moved files and its admin half loses twenty-five (the
    // twenty-four plus the `FulfilmentStrategyPicker` shim); the rest of the
    // walk gains the four `.ts` files. `module files` reads 1882 -> 1906 and
    // `admin files` 136 -> 111 on the same run, and `cross-module reaches`
    // stays 7 — the batch's drain is zero, every reach its four modules
    // carried having been incoming and repaired by P4b, P7a, P7b, P7c and P4d.
    //
    // **Batch 16 + Phase 5: 3976 -> 4147.** Two movements, and the second is
    // the interesting one. `pim_unopim` merged from
    // `specs/089-unopim-pim-sync/` with a whole module package, which is most
    // of it. The rest is **107 admin host files coming back**: on the merge of
    // batches 15 and 16 the layout answered `null` — `admin/src/modules/` held
    // no registered module id — so `collectAdminHostFiles` returned `[]` and
    // this check read `admin host files=0` while exiting 0
    // (`admin-kit-surface.md` §7.5). T1 makes the layout resolve with
    // `moduleRoot: null`, so the host walk is all of `admin/src` again and the
    // unconditional *"the layout resolved and the host walk opened nothing"*
    // refusal is reachable once more. `admin files` is now **0**, which is
    // SC-007 and is a measurement rather than a shortfall.
    // **`files` moves for one reason and not the other, and both are recorded
    // because the two branches that produced them are being merged.**
    //
    // Feature 097 moved **nothing** here: its migration rules judge sources the
    // walk was already opening — a module's `migrations/` directory is inside
    // `layout.moduleWalkRoots` and always has been — so what changed is the rule
    // applied to 225 files already in the count, not the count.
    //
    // The D-168 repair moved it **4147 -> 4145**: `pim_connector`'s
    // `services/field-path.ts` goes, and so does the emitted
    // `dist/backend/services/field-path.js` this walk reads for D-171's
    // contract-surface designation. Two files for one deletion. Every other
    // recorded entry in this file drifted upwards against a baseline already
    // stale before either branch; these matched the tree exactly, measured,
    // which is why they are the only ones re-recorded.
    // **Feature 103 (overlay file shadowing retired): 4157 -> 4156.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 105: 4156 -> 4155.** One file, and it is the admin half of this
    // walk: `admin/src/modules/cms_pages/CmsPagesPage.tsx`, which the layout
    // attributes to the host (no nav entry claims that directory) and which is
    // deleted with the contract it was typed against. The module walk is unmoved.
    // **Feature 106 (`specs/106-module-owned-tests/`): sites 11137 -> 11887, files 4155
    // -> 4651.** 196 harness-free single-owner test files leave `backend/test/` and
    // arrive in the module walk, and 52 module packages gain a `vitest.config.ts` —
    // both roots this check reads, so each file counts on both sides of its union.
    // `sites` is the specifiers and table references they carry.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 4652 -> 4659.**
    // Seven of the branch's eight new source files. The one this walk does not
    // count is `backend/src/demo/index.ts`, measured: the number was already
    // 4659 before that shim existed and did not move when it landed.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 4661 -> 4663.** The same one
    // file — `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel
    // (D115-4) — counted twice, this walk taking `layout.sourceRoots`, which lists
    // the platform both as `platformRoot` and as a workspace package root.
    // **`specs/115-lifecycle-container-move/` Phase 3: 4663 -> 4667 (+4).** The same
    // two files the move adds under `packages/platform/src/lifecycle/`, counted
    // twice each because this check reads the platform's sources in two passes.
    // Measured rather than reasoned about: with both files taken out of the tree
    // and the check re-run it reads 4663.
    // **Both of those two are right about the arithmetic and wrong about the
    // reason, and the number stands.** They read as though the platform were a
    // duplicated root and this a double count to be repaired. It is not, measured
    // three ways: `layout.sourceRoots` holds no duplicate and no nested pair; and
    // a file added under `packages/platform/src/lifecycle/` moves this number by
    // **2** — but so does one added under `packages/modules/blog/src/backend/`,
    // while one added under `backend/src` outside a module moves it by **1**. The
    // +2 is uniform for *any* module file and has nothing to do with the platform.
    // It is what the `files` comment below already says this number is: the sum of
    // two deliberately separate populations, `sources` (the module surface walk,
    // over `moduleWalkRoots`) and `schema` (the owner map, over `sourceRoots`),
    // which overlap on every module file by construction and are summed rather
    // than unioned because their floors are separable. So there is nothing here to
    // deduplicate, and the entry is corrected rather than re-recorded.
    // **`specs/115-lifecycle-container-move/` Phase 4: 4667 -> 4669 (+2).** One file,
    // counted twice — this check's `files` is a **sum** over populations that overlap
    // (the import scan's and the owner map's), so the divergence split's platform half
    // (D115-3), `packages/platform/src/lifecycle/divergence-declaration.ts`, enters each
    // of them once. The two `backend/src` files the split moves are in neither: this
    // walk's population is the module tree, and `_lifecycle` is platform-resident.
    // Measured rather than reasoned about: with that one file taken out of the tree and
    // the check re-run it reads 4667, `sites` unmoved at 11889.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file, -1 site.** The routing
    // derivation left the module tree for the platform. The site is that file's
    // one specifier, counted here as an import position rather than as a reach —
    // it named nothing outside `_i18n` and is in no shard.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 4669 -> 4681 (+12 files).** The six
    // files D115-1 adds under `packages/platform/src/lifecycle/commands/` — the five `module:*`
    // command bodies and their `OperatorRuntime` seam — counted once by the specifier walk and
    // once by the schema walk, this check's `files` being the sum of the two.
    // **`specs/110-instance-repository/` T122: 4669 -> 4670 (+1).** The admin host
    // walk became the layout's host roots, so `admin/src`'s 106 files are read
    // at `packages/admin-shell/src` instead and cancel. The one is the shell's
    // barrel; its `src/types/env.d.ts` is not counted, this walk taking `.ts`
    // and `.tsx` and excluding declaration files.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 4682 -> 4859.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+46 is
    // this branch's test move**: the 23 tests entering the module walk roots, opened once
    // by the import pass and once by the SQL pass.
    // **`chore/094-retire-error-table` (over !1508): 4859 -> 4858.** The tip of `094-akeneo-pim-sync` read 4859, so
    // the whole move is this branch's.
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **+2, re-measured on the chained union.** The new platform source and the new unit test under `backend/test/`, both inside this walk's populations.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module package and the backend tests beside it.
    // **`fix/search-reindex-task-timeout`: files 4861 -> 4863.** Two, and both are the one new co-located test file: it sits in a module package's sources and under a source root, and this walk's `files` counts both populations. Measured by taking that file alone out of the tree, which returns 4861.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +1 file.** This
    // number is the sum of four populations and they move in both directions:
    // the twelve core migrations and the two deleted `db/` sources leave
    // `backend/src`, and eight `db/` sources plus the same twelve arrive under
    // `packages/platform/src`. Measured net, never subtracted.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+2, of which one is this branch's and one is not.** Measured on `master` itself this walk reads 4863, so the search fix that merged after this branch recorded contributes one and this branch's platform sources contribute the other. Attributed by measuring the base rather than by subtracting deltas.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +1 file**,
    // and the file is measured rather than reasoned about, because +1 is not the
    // arithmetic the other walks give. Holding each of the branch's three new
    // files out in turn: without `packages/platform/src/cli/index.ts` this reads
    // 4864, and without either the moved `cli/module-commands.ts` or the shim at
    // its old path it still reads 4865. The barrel is the whole of the move.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 4864 -> 4865.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. Only the barrel lands in this walk's population, which is why it moves by one where its neighbours move by two.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): sites
    // 12360 -> 12448 (+88), files 4866 -> 4901 (+35).** The branch adds 23 files and
    // removes none: four modules' `src/backend/demo/` (`rows`, `seed`, `reset` and a
    // co-located test each), `taxes`' `vitest.config.ts`,
    // `backend/src/seeds/demo-relocated-reference.ts` — the frozen copy of the moved
    // blocks that keeps the demo parity comparison a comparison — and five changesets.
    // This walk reads the seventeen `.ts` files, counted once per walk that reaches them,
    // plus `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 4902 -> 4933, sites 12448 -> 12552.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 4933 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 4934 -> 4931 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 4931 -> 4932 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 4934 -> 4935 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 4935 -> 4933. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 4933
    // -> 4937 (+4) and sites 12551 -> 12560 (+9), and the four are **two** files: that
    // module source and its co-located test. Measured by parking them and re-running, which
    // reads 4933 exactly; this walk reaches a module package's sources under more than one
    // root, so a file added there moves the count twice. The nine sites are those two
    // files' own import specifiers.
    // **T119a: 4933 -> 4988.** +55, and it is two populations rather than one: the schema
    // walk over `layout.sourceRoots` gains the fifty moved test files, and the module walk
    // gains the five of them that landed in `packages/platform/src/lifecycle`, which is
    // `_lifecycle`'s own module directory.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 4988 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: 12560 -> 12569 sites, 4992 -> 4996 files.** The files are
    // the new module source, its co-located test, the new integration test and the merge
    // request's changeset, which this walk opens. The sites are the import specifiers and
    // table references those files add; no cross-module reach moved and the ledger stands
    // at 8.
    // **D-223: files 5000 -> 5006 (+6).** The five `.ts` files it adds and one markdown
    // file, the changeset.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 5006 -> 5014, four new module-package files at two openings
    // each, which is the whole of the +8: this check walks the module tree **and** every
    // source root, so a module package's file is opened under both. The backend integration
    // test is in neither population.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 5014 -> 5022, the four new `.ts` files,
    // each counted in both the module walk and the whole-tree SQL walk. Quality-job shape:
    // the ignored copies `composer:generate` places under `docs/docs/modules/` swept
    // first, because no job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources plus their two co-located tests, counted
    // **twice** because this check's `files` is a sum over its passes and both the
    // import walk and the SQL walk open a module's sources. The module-walk half moves
    // 2490 -> 2494 in place. `sites` is the sum of import specifiers and table
    // references examined.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 5022 -> 5030. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +4 files** — two module files, and this walk reaches a
    // module package's sources under more than one root, which is the reason the `mfa`
    // census gives. The nine `sites` are the import specifiers and table references
    // those two files write; the backend integration test is outside this population.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 5034 -> 5155.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1 and sites +5.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // The file is `AdminRoot.tsx`, which the shell's source root contributes to the admin host
    // walk; the five sites are its own import specifiers and the `mod-settings` reach that
    // became a dynamic import, which this check counts exactly as it counted the static one.

    files: 5164,
    // **First recorded here** (feature 097). This entry read `null`, with a
    // reason in `READ_SIZE_WITHOUT_A_SITE_POPULATION` that named two obstacles:
    // the cleared specifiers and table references were not collected, and there
    // are two populations rather than one. FR-012 asks for `sites=`, so both are
    // answered rather than restated. The first is collection — a mutable tally
    // passed into the two analyses, so nothing is re-parsed to count what they
    // cleared. The second is the objection `check:subscribe-seam` answers by
    // refusing, and it is answered the same way here: the number is a **sum**,
    // and each addend has its own exit-2 floor in `vacuousReason`
    // (`importSites`, `tableSites`), so a sum cannot hide an addend that went to
    // zero because zero is refused before the sum is printed.
    //
    // The figure below was measured on the **merge result** of the two branches
    // rather than composed from either. 097 recorded 11127 over a 4147-file
    // tree; the deletion above takes two specifiers with it, so the combined
    // tree reads 11125. Composing the two recorded numbers would have written
    // 11127 beside `files: 4145` — internally consistent, and wrong by two.
    // **Feature 105: 11152 -> 11137.** The fifteen import specifiers of that one
    // deleted file. The pair is what says which of the two happened: a file left
    // the walk and took its specifiers with it, rather than a specifier shape the
    // reader stopped recognising, which would have moved `sites` alone.
    // **`specs/110-instance-repository/` T120: 11888 -> 11893 (+5).** Import
    // specifiers, and the extraction is where they come from: the shell's own
    // files lost their `@/` aliases and gained relative ones one-for-one, while
    // the new barrel writes five (`App`, `registerSw`, `lib/auth` twice for the
    // value and the types, `lib/module-registry`). The cross-module half does
    // not move at all — `reaches=8`, `ledger-size=8`, `stale=0` before and
    // after — which is T122's own criterion.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 11893 -> 12351.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+61 is
    // this branch's test move** — the specifiers in the 23 files, now read as a module's
    // own sources.
    // **`specs/089-unopim-pim-sync/` re-import repair: 11893 -> 11895 (+2).** Two table
    // references, both `pim_unopim`'s own: the SQL that asks whether a category mapping
    // postdates the last product walk names `unopim_category_mappings` and
    // `unopim_sync_bookmarks`. The cross-module half does not move — `reaches=8`,
    // `ledger-size=8`, `stale=0` before and after — a module reading its own tables
    // being no reach at all.
    // **Re-measured on the union after rebasing onto `spec/113-demo-data-tasks`.** This branch
    // still contributes the two `pim_unopim` tables its SQL literal names; the remainder is the
    // base moving under it in the eight merges of 2026-09-08. A fresh census of the combined tree.
    // **11 893 -> 11 891, and `files` did not move**, which is the #235/#237 shape read the other way: feature 110's T129 deleted two `import './styles/*.css'` lines from `admin/src/main.tsx`, so two specifier sites went and no file did.
    // **Re-measured on the chained union.** This branch still removes the two stylesheet imports from `admin/src/main.tsx` that its own entry above records; the remainder arrives with the four branches it is chained behind. A fresh census of the combined tree, never a sum of deltas.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's import specifiers and SQL table references, both of which this walk counts.
    // **`fix/search-reindex-task-timeout`: sites 12356 -> 12359.** Three. Two are that file's own import specifiers; the third is the new manifest import in `search-indexer.ts`. Measured: with the test file removed and the source edits kept, this reads 12357.
    // **D-221 (`feat/catalog-new-product-route`): 12359 -> 12360 (+1).** The same
    // route entry as `check-admin-surface` one entry over, seen through this walk's
    // import-specifier half: the new declaration carries its own
    // `import('./pages/ProductEditor.js')` factory, so the module's second entry point
    // to one screen is a second specifier. Measured by removing the entry and
    // re-running, which returns both checks to their recorded values together.
    // **`specs/110-instance-repository/` T118b: sites 12552 -> 12551 (-1).** One
    // import specifier, and it is a *merge* rather than a removal:
    // `packages/modules/auth/src/backend/plugin.ts` had a value import and a
    // type-only import of `@endora-commerce/contracts` side by side once the
    // actor types moved there, and they are one statement now. The two files this
    // merge request adds are in neither module walk root, so `files` moves by the
    // one this walk does see and `sites` moves the other way — which is the
    // #235/#237 shape, and the reason both numbers are recorded.
    // **D-223: sites 12575 -> 12589 (+14).** Import specifiers and SQL table references
    // across the six files the branch adds — the two integration tests name `assets`,
    // `gallery_items` and the price-list tables between them, and the rest are imports.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** sites 12589 -> 12604, the import specifiers and table references
    // those four files add. No cross-module reach among them: every outward name the drain
    // introduces is a `@endora-commerce/contracts` type or a container name, and the ledger is
    // unchanged at 8 keys.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** sites 12604 -> 12626, the import specifiers
    // and table references those four files carry. No reach crosses a module boundary:
    // every one of them names `@endora-commerce/contracts` or its own module. Quality-job
    // shape: the ignored copies `composer:generate` places under `docs/docs/modules/`
    // swept first, because no job has placed them when these checks run.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 12620 -> 12642. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 12651 -> 12915.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T138: the file half of the move noted above the site count.**
    // The file is `AdminRoot.tsx`, which the shell's source root contributes to the admin host
    // walk; the five sites are its own import specifiers and the `mod-settings` reach that
    // became a dynamic import, which this check counts exactly as it counted the static one.

    sites: 12920,
    // `module-packages` joined when a bare specifier became able to reach a
    // module (feature 080): the names the walk read off each module package's
    // manifest, reconciled against the package roots the layout found by
    // walking directories. It is printed only while there is at least one such
    // package — `expected=0` is a refusal in this grammar, and no module package
    // was the whole tree until !910.
    //
    // `admin-surfaces` joined with feature 091's FR-017 and moved `files` by
    // the 327 `.ts`/`.tsx` files under the admin module root. Its expectation
    // was the surface directories the route table and the nav attribute to a
    // module — an independent derivation, and not the walk counting itself.
    // **That population is now empty** (SC-007), so the token goes exactly as
    // `admin-host` went below and on the same stated terms: `expected=0` is a
    // refusal in this grammar, and it is removed in the merge request that
    // drained it rather than left for the next one to find. The walk itself is
    // unchanged and still refuses a blind run over it — `adminPopulationLost`
    // anchors on the **ledger** rather than on the walk, and a resolved layout
    // whose host walk opened nothing is exit 2 unconditionally.
    // `admin-host` joined with P1 and was the host population's short-walk
    // floor. **That day came** (feature 091, P6): `IdleLogout.tsx` was the last
    // host reach, it took the client exit, `host.ts` was deleted, and the token
    // went with it — printed only while there is host debt, because
    // `expected=0` is a refusal in this grammar. Its own entry said that
    // staleness is the two-way property rather than a defect, so the entry is
    // removed here in the merge request that drained it rather than left for
    // the next one to find.
    //
    // `migration-registry` joined with feature 097 and is the migration
    // population's floor. `manifest-index` cannot be it: that token is satisfied
    // by **any** file a registered module contributes, and a module's backend
    // sources are plentiful, so a `migrations/` walk that stopped resolving
    // leaves it at 71/71 while R1 and R2 judge nothing. Its expectation is the
    // module-owned migration classes `backend/src/db/migrations-registry.generated.ts`
    // registers — a second program's answer, since the generator finds
    // migrations by walking directories and this check finds them by path — and
    // its coverage is how many of those a walked migration source declares.
    // Core's twelve are outside the expectation and that is the population
    // rather than an exemption: they belong to no module and sit under no module
    // walk root.
    sources: ['manifest-index', 'migration-registry', 'module-packages'],
    //
    // **11893 -> 11898 sites, 4682 -> 4684 files.** D-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. Measured
    // directly by taking the file back out: `module files` moves 2345 -> 2346 and
    // the total moves by two, the file being read once by each of the two
    // predicates' roots; the five sites are its own import specifiers.
  },
  'backend/scripts/check-nul-bytes.ts': {
    prefix: '[nul-bytes]',
    run: { kind: 'tsx', path: 'scripts/check-nul-bytes.ts', args: [] },
    // **T118c, `mfaActorBridge`: +4 files** — the three new source files and the merge
    // request's own changeset, this walk being the whole repository. The changeset is the
    // fourth file and the one a drain is apt to record before writing it, which is what
    // the `assets_library` census above says about the two shell entries.
    // Both bounds are asserted again (issue #248). The number now agrees
    // between a clean checkout and a tree that had built the docs site and
    // served uploads — 8288 against 5163 before, 5165 against 5165 after —
    // because the two generated trees that made them differ, `.docusaurus` and
    // `backend/var/assets`, are declared exclusions. Re-recorded here on this
    // branch, which is the tree the exclusions were measured on.
    // **Batch 13 (feature 091, Phase 4): +2.** Whole-tree arithmetic: twenty-four
    // files move into the module packages, twenty-four leave `admin/src`, the
    // `FulfilmentStrategyPicker` shim there is deleted with its last reader, the
    // batch adds two off-state test files, and it adds its changeset — which
    // this walk opens like any other file, and which is the one number a batch
    // is apt to record before writing it.
    // **Batch 14 (feature 091, Phase 4): +2 files.** The whole-tree walk gains
    // the batch's two new test files, its two new `tsconfig.ui.json`s and its
    // changeset, and loses the five residue files
    // `admin/src/modules/sales_channels/` held — four `export {}` barrels and
    // the `DefaultChannelBadge` copy P7a could not delete. Net two.
    // **Batch 15 (feature 091, Phase 4): 6990 -> 6991.** One, and it is this
    // batch's changeset: the whole-tree walk counts `.md`, and the four deleted
    // shims, the four new source files and the twenty-seven moves net to zero
    // here because a moved file is walked at either address.
    // **Feature 101, Phase 1: +17.** `endora check`'s frame and the five
    // relocated analyses: seven files under `packages/cli/src/check/`, five
    // under `src/rules/`, `src/checks.ts`, and four under `packages/cli/test/`.
    // The five `backend/scripts/check-*.ts` hosts stayed where they are —
    // `check-inventory.test.ts`'s `script` field must resolve to a file in this
    // tree — so the whole-tree walks gained the package's copy and lost nothing.
    // **+1 more** for the merge request's own changeset file: `check:naming` and
    // this check walk `.changeset/`, `check:language` does not.
    // **+4 more** from the ten merge requests this branch rebased onto; the
    // arithmetic checks out — master's record 7278, its tree 7282, plus this
    // branch's 18.
    // **Feature 101, Phase 2: +13.** Ten more analyses relocate into
    // `packages/cli/src/rules/`, `port-registrations.ts` is extracted from
    // `check-port-dependencies.ts` into `packages/cli/src/lib/`, and
    // `sql-tables.ts` and `ui-layer.ts` move there too — each leaving a
    // re-export shim at its old path, which is the +2. Measured by parking this
    // branch's own files and re-running: this branch's base reads 7329, so 29
    // **Feature 101, Phase 2: +15**, which is every file the commit adds —
    // ten relocated analyses, `port-registrations.ts`, the two re-export shims
    // left at the old `backend/scripts/lib/` paths, the red proofs and the
    // changeset. Cross-checked two ways: `git diff --name-status origin/master`
    // counts 15 added files, and parking this branch's own files puts the base
    // at 7335 against this branch's 7350. Recording the observed value absorbs
    // **+35** from merge requests that have already landed.
    // **Feature 103 (overlay file shadowing retired): 7350 -> 7388.** This change's
    // own contribution is **-13** over the whole-tree walk: two `src/overlay`
    // files and fifteen overlay test and fixture files go, four arrive. Recording
    // the observed value absorbs **+51** from earlier merges (this branch's base,
    // 36174efa1, observed 7401).
    // Measured with the generated module-documentation copies under
    // `docs/docs/modules/` in the same state on both trees: this is the one check
    // whose population is the whole repository rather than tracked source, and a tree
    // that has run the docs build carries ~77 more.
    // **F7: +8.** The whole-repository walk gains the command's three sources and
    // its test, the acceptance criterion's two sources and its test, and the
    // recorded expectation.
    // **Feature 098 Phase 4 (the storefront conformance job): 7470 -> 7484.**
    // The nine files that job is made of — six under
    // `storefront/test/conformance/`, `storefront/playwright.conformance.config.ts`,
    // `backend/scripts/conformance/seed-storefront-fixtures.ts` and
    // `scripts/conformance-storefront.sh` — intersected with this walk's
    // population.
    // This walk is the whole repository, so the fourteen are the nine plus
    // five `master` gained while this branch was open.
    // **Rebased onto feature 104: 7484 -> 7486.** Not this branch's nine — the two
    // `.changeset/*.md` files `feat/104-publication` brought with it, which this
    // whole-tree walk sees and the source-comment walks do not. Re-measured on
    // the rebased tree rather than added to the number above it.
    // **Feature 098 Phase 5 (the storefront performance budget): 7486 -> 7491.**
    // Two are this branch's — `scripts/perf-storefront.sh` and
    // `scripts/lib/storefront-stack.sh`, measured by moving both out of the tree
    // and re-running, which read 7489. The other three `master` gained while
    // this branch was open. The recorded number is what this tree reads.
    // **Rebased onto `master` at a9deb1cfd: 7491 -> 7495.** Not this branch's
    // two — the four `specs/106-module-owned-tests/*.md` files that merge
    // brought with it, which this whole-tree walk sees. Re-measured on the
    // rebased tree rather than added to the number above it.
    // **Feature 105 (a CMS page has one address): 7495 -> 7499.** Net **-3**
    // from this branch — four source files deleted and one changeset `.md`
    // added — over a **+7** this entry already owed `master`, which reads 7502
    // at bf869a18a. Both figures are measurements: a second worktree at this
    // branch's own base commit, each check run in both trees. Subtracting the
    // delta from the number above it would have recorded 7492 and left this
    // entry wrong in the direction that hides a walk going short. A local
    // `conformance:storefront` run adds one — `storefront/test-results/` is
    // git-ignored and this deny-list walk opens it — so what is recorded is
    // what a clean checkout reads.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 7499 -> 7557.** 52 module
    // packages gain a `vitest.config.ts`; the 196 moves are net zero for a
    // whole-repository walk. The remaining +6 is inherited drift — the four
    // `specs/108-storefront-response-status/` pages among it — recorded here rather
    // than left to go stale in an entry this branch rewrites anyway.
    // **Measure this entry in a clean checkout, never in the main one.** On
    // 2026-09-04 a drift report run in the *main* checkout reported this walk
    // eight files above its record, and re-recording that would have pinned a
    // number only that machine produces: the check walks the whole repository
    // root, and the main checkout of this project carries eleven nested `git
    // worktree`s under `.claude/worktrees/`. A clean checkout of the same
    // commit -- byte-identical tracked files, nothing untracked -- read exactly
    // the recorded value, so there was nothing to re-record.
    //
    // The rule generalises past that day and is why this note is here rather
    // than the number it was about: for a whole-repository walk, *where* you
    // measure is part of the measurement, and the main checkout is the one
    // place in this project that is not representative of CI. A branch that
    // genuinely adds or removes files still re-records normally -- park them
    // and re-run to tell your own delta from the tree's.
    // **Feature 104 §§ 1.5–1.6: files 7557 -> 7559.** Two of the four are this
    // branch's — `packages/cli/src/new-storefront/npmrc.ts` and its changeset —
    // and this deny-list walk is the whole repository, so it opens both. The
    // other two arrived on `master`. Measured by parking this branch's two off
    // disk, which reads 7559; both are untracked, so the `--cached` caveat does
    // not apply.
    // **2026-09-05: +14, and no branch that moved it could have known.** A nine-way
    // merge landed `specs/109-backend-test-kit/` (5 files), `specs/110-instance-repository/`
    // (5) and `specs/111-shared-fixture-package-naming/` (4). All fourteen arrived in two
    // **documentation-only** merge requests, which re-recorded nothing -- correctly, from
    // their authors' point of view: a branch that adds only markdown has no reason to
    // suspect it moves a read size, and neither of them touched a check. But three walks
    // in this estate count markdown, so a docs-only merge request silently drifts them.
    // That is the gap the drift report exists to fill and the one case where nobody is at
    // fault for not filling it in advance; it is caught on the merged tree instead.
    // **2026-09-05, feature 104 (the CLI published): +1.** One changeset file.
    // The count therefore falls again when a release consumes it, which is the
    // oscillation `check-release-intent`'s own entry stopped tracking by taking
    // the changesets out of its population — these two walks cannot do that,
    // being whole-tree walks whose subject is every file in the repository.
    // **Feature 110 Phase 1: +9.** This is the walk that sees all nine files the
    // branch adds: three TypeScript sources, the five of the
    // `mod-instance-surfaces` fixture package (its manifest, three `.js` and its
    // documentation page) and its changeset markdown. Re-measured after rebasing
    // onto the fifteen commits that landed while the branch was open, not carried
    // over from the pre-rebase measurement.
    // **Feature 109, Phase 1c: +1.** One file, and it is the whole delta: the
    // branch's changeset, `.changeset/test-kit-scoped-plugins-and-decoration-order.md`.
    // Both walks count markdown, so a merge request that adds one adds a file to
    // each of them; the three source files it edits were already in the walk.
    // Re-measured after rebasing onto the merges that landed while the branch was
    // open, not carried over from the pre-rebase figure.
    // **Feature 109, Phase 1c, follow-up: +3.** Two sources and one changeset:
    // `packages/cli/src/lib/delegated-composer.ts`, its `backend/scripts/lib/` shim
    // and `.changeset/cli-follows-a-delegated-composition.md` — this walk counts
    // markdown as well as source.
    // `check-port-dependencies` follows a delegating root to its composer now,
    // so the derivation lives in `@endora-commerce/cli/lib/delegated-composer.ts`
    // with a re-export shim beside the other shared analyses.
    // **Stacked on 113 Phase 0: +13.** That branch adds thirteen files —
    // the demo-data declaration, its runner and their tests, twelve of them
    // TypeScript and one a changeset. This walk takes all thirteen.
    // **`specs/114-release-shape-gate/` landed: +5.** The release-shape gate's
    // design added five files — four markdown and one `.mjs` contract. This walk
    // takes all five, this walk being the whole tree.
    // **7715 -> 7722 (this branch, +7): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 3 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 7719.
    // **7722 -> 7723 (+1): this branch's own changeset file.** Both of these are
    // whole-repository walks, and `.changeset/*.md` is in the repository. It is
    // the ordinary per-changeset move this file already warns about one entry
    // over, arriving in the two walks that count every file rather than in the
    // one whose population is the changesets.
    // **`specs/115-lifecycle-container-move/`'s design landed on `master`: +4.**
    // !1450 added four markdown files — the plan, the research and the two
    // contracts. This walk takes all four, its subject
    // being the whole tree. Re-derived on this branch's own
    // tree rather than carried over; the guard this merge request adds creates no
    // file, so the whole of the +4 is that merge's.
    // **And +1 for this merge request's own changeset**, which the guard it lands
    // does not create but the release gate does: a change to a package under
    // `packages/` carries one, and this walk's subject is the whole tree.
    // **Stacked on the publication branch: +4.** That branch adds the pack gate,
    // its judgement library, its test and its changeset. This walk is the whole
    // repository, so it takes all four.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 7724 -> 7727.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: 7724 -> 7729.** Four are this
    // branch's — the platform package's new `src/migrations/` plus the two-regime
    // guard and its helper — and the fifth is `origin/master`'s own growth between the
    // last recording and this run, measured with the branch's own files held back and
    // named here rather than absorbed. The sixth is the branch's own changeset: this
    // walk's population is the whole repository minus its declared exclusions, and
    // `.changeset/*.md` is in it.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/110-instance-repository/`'s two contracts landed on `master`: +2.**
    // !1456 added `contracts/instance-migration-order.md` and
    // `contracts/instance-tree.md` and re-recorded nothing; this walk is the whole
    // tree, so it takes both. None of it is this branch's — it edits three existing
    // files and creates none — so the record was already stale on `master` before
    // this branch existed, and this is the first run of the census since.
    // **A worktree needs its own `backend/.env`, and this walk counts it.** The
    // observed number in such a tree is 7736, one above what is recorded here:
    // `.env` is git-ignored and is not in `SKIPPED_DIRECTORIES`, so a checkout that
    // has one reads one more file than a CI job's does. Measured both ways in the
    // same tree by moving the file aside — 7736 with it, 7735 without — and the
    // recorded value is the clean-checkout one, because that is what the pipeline
    // reads and baking a local file into the record would drift it for everybody
    // else.
    // **And +1 for this merge request's own changeset**, which it carries because
    // it edits a file under `packages/`: this walk's population is the whole
    // repository and `.changeset/*.md` is in it. That is the ordinary per-changeset
    // move, arriving in the two walks that count every file.
    // **7724 -> 7725 (+1): the licence-and-peers branch's own changeset file.**
    // Its two subjects are a generator and a check, so it creates one file and
    // edits the rest — and this walk is the whole tree, so the changeset the
    // release gate requires is the whole of the move. Measured **without**
    // `backend/.env`: a fresh worktree has none and CI has none, but a developer
    // who copies one in from the main checkout is scanned for it — `.env` is a
    // scannable path — and reading 7726 off such a run would record a local file
    // into a shared band. Taking it out and re-running is what produced 7725.
    // **Nine files from `master` plus this branch's changeset: +10.** The
    // instance-scaffold contracts, the CI-gate reconciliation and the migration
    // baseline landed without re-recording the two whole-repository walks.
    // **+7 from `master`.** The six zero-series specification files plus the
    // public-flip fix's changeset. This walk is the whole repository, so it takes
    // the changeset the document walk does not.
    // **+3: two files from this branch, one already on `master`.** The branch adds
    // `LICENSE` and `LICENSE-COMMERCIAL.md` at the repository root. Separated by
    // measuring twice, with and without them.
    // **+8: six specification files and two changesets from beneath, plus this
    // branch's own two.** The recorded value predates two merges and the stacking
    // on the licence-and-peers branch; measured on the combined tree, not resolved
    // from either side.
    // **`specs/104-package-publication/`'s registry auth repair: +1.** This branch
    // adds one file, `packages/cli/test/npmrc-auth-effect.test.ts` — the install
    // that measures the generated `.npmrc`'s effect rather than its text.
    // Measured **without** `backend/.env`, which this walk counts and neither CI
    // nor a fresh worktree has: 7746 with it, 7745 without, in the same tree.
    // **`specs/115-lifecycle-container-move/` Phase 2: 7744 -> 7745.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **+2 for this branch.** The `./lifecycle` barrel and this branch's changeset;
    // this walk is the whole repository and takes both.
    // **+1 for this branch** — its changeset, the only file it adds. This walk is
    // the whole repository; `check:language` does not move, a changeset being
    // neither a source file nor a `docs/docs` page.
    // **`specs/115-lifecycle-container-move/` Phase 3: 7748 -> 7752 (+4).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`
    // — `manifest-registry.ts` and the relocated `services/module-id-claims.ts` —
    // plus `packages/platform/src/lifecycle/manifest-registry.test.ts` and this branch's own
    // changeset, which this walk takes because its population is the whole
    // repository. `backend/src` does not move: the binding and the claims
    // re-export both keep their paths.
    // **The service-unavailable notice: 7748 -> 7752.** The same four source
    // files. This walk is the whole repository and carries no changeset for
    // them, because the notice lives in `storefront`, which `.changeset`
    // ignores as an application.
    // **+4 for this branch** — the three storefront sources and their test. This
    // walk is the whole repository and takes all four.
    // **The licence-tier deletion: 7756 -> 7757 (+1).** The branch's own changeset
    // and nothing else — it deletes lines from six existing files and adds no
    // source file. This walk is the whole repository, so `.changeset/` is in it.
    // **+6 from `master`.** `specs/117-instance-bring-up/` landed with six files —
    // spec, plan, research and three contracts — and re-recorded nothing. All six
    // are documents under a declared root, so this walk and the two
    // whole-repository ones move by the same amount.
    // **+4 for this branch.** `specs/118-instance-member-selection/` — spec, plan,
    // research and one contract. All four are documents under a declared root, so
    // the document walk and the two whole-repository walks move by the same four.
    // **The storefront environment refusal: 7763 -> 7767 (+4).**
    // `storefront/lib/env.mjs`, `storefront/instrumentation.ts` and two test files.
    // Measured by parking the four and re-running, which is also how the `master`
    // half above was told apart from this branch's before that half landed. This
    // walk is the whole repository, so unlike its `check-diacritic-folds` neighbour
    // it takes the `.mjs` too — which is why one moves by four and the other three.
    // **+4 for this branch** — `instrumentation.ts`, the `env.mjs` seam and its two
    // tests. This walk is the whole repository and takes all four.
    // **`specs/115-lifecycle-container-move/` Phase 4: 7771 -> 7772 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 7771 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +15 files.** Every file this feature adds, this
    // walk's population being the whole checkout: the contract shape and its test,
    // the platform's declaration, the storefront's and the admin's, the
    // reconciliation rule with its repository host and its companion, the
    // `./env` subpath test, the four input-resolution modules, and the two tests
    // that prove the resolution and the non-interactive guarantee.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): 7772 -> 7777, of which +2 is this
    // branch and +3 was already stale.** This branch is net two files: the platform
    // derivation and its shim arrive, the `_i18n` source goes, and the FR-030
    // ratchet is new. The other three are `docs/docs/modules/README.md`,
    // `lifecycle.md` and `module-map.generated.md` — **tracked** files that a
    // previous recording measured with the whole directory parked, along with the
    // 76 gitignored copies `composer:generate` places beside them. Re-recorded
    // over the tracked tree with those copies absent, which is what a fresh
    // checkout holds; the census names the entry and this is the run that read it.
    // The branch's two are three files in and one out, and the third of the three
    // is `.changeset/composition-root-module-value-imports.md` — this walk's
    // population is the repository, so a changeset is a file it reads.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **The `addressOf` fixture repair: 7794 -> 7795 (+1), and the whole of it is this
    // merge request's own changeset.** The branch edits one existing test file and
    // creates one file — `.changeset/environment-input-fixtures-answer-address-of.md` —
    // which this walk opens like any other, its subject being the whole repository.
    // Measured both ways in this tree rather than inferred: with that file off disk this
    // check reads 7794, which is what was recorded, so its base carried no inherited
    // staleness. Measured with `backend/.env` parked, that being a worktree's file and
    // not CI's.
    // **Rebased onto the `addressOf` fixture repair, and the storefront-scaffold criterion
    // stops inheriting its own environment: 7795 -> 7796 (+1).** Both branches moved this
    // entry and each wrote the same intermediate 7795, so the value below is the sum of the
    // two contributions rather than either one's — re-measured after the rebase rather than
    // carried across it, which is the state the drift census exists to surface. This
    // branch's one file is `.changeset/storefront-declared-variables.md`: its population is
    // the whole repository, so a changeset is a file it reads. Every other edit it makes is
    // to a file that already existed — the criterion, its assertions module, their test,
    // `packages/cli`'s reference derivation and its barrel, the expectation record and one
    // comment block in `.gitlab-ci.yml` — and an edit moves no count here. Measured with
    // `backend/.env` parked, which is what a fresh checkout and this check's CI job hold;
    // unlike `check-naming.sh` one entry over, this walk *does* move by one when that file
    // is present, its population being the directory tree rather than git's list. Measured
    // both ways at this head: 7797 with it, 7796 without.
    // **+2 on `master`, on the union of three merged branches: 7796 -> 7798.** The
    // population is the whole repository, so it counts every file the merges added —
    // `demo-opt-in.md` and two changesets — of which `.changeset/storefront-declared-
    // variables.md` is already inside the 7796 above, leaving +2. Each of the three
    // branches read 0 drift on its own base and the union drifted: the merge-pair blind
    // spot, not an author's oversight. Measured with `backend/.env` absent, as above.
    // **`specs/115-lifecycle-container-move/` Phase 5, rebased: 7798 -> 7805 (+7 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // Both sides of a rebase conflict moved this entry, so the value below is a fresh
    // measurement of the combined tree rather than either side's arithmetic. The seventh
    // file is `.changeset/lifecycle-operator-commands.md`: this walk's population is the
    // whole repository, so a changeset is a file it opens, and the arithmetic that stopped
    // at +6 was the one the census caught. Measured with `backend/.env` absent, as the
    // block above.
    // **`specs/110-instance-repository/` T120: 7798 -> 7805 (+7).** The whole
    // repository, so the 106 moved files cancel and the seven are what the
    // extraction *adds*: `packages/admin-shell`'s manifest, its two tsconfigs,
    // its own `eslint.config.js`, its barrel, its `src/types/env.d.ts` and this
    // merge request's changeset. Measured with `backend/.env` absent, as above.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **+1: `contracts/admin-stylesheet-composition.md`.** The one document this branch
    // adds; the other five files it changes already existed, and an edit moves no count
    // here. Measured with `backend/.env` absent and no untracked `docs/docs/modules/`
    // copies.
    // **`specs/110-instance-repository/` Phase 3 (T123/T124/T125): 7813 -> 7877
    // (+64).** The population is the whole repository, so it counts every file
    // this branch adds and nothing it edits: 60 packages each gain their own
    // `tailwind.css` (`admin-stylesheet-composition.md` R1 — 55 module admin
    // layers, the shell and the four kit-family packages), plus
    // `admin/src/tailwind.generated.css`, plus the installed-package fixture's,
    // plus `scripts/lib/tailwind-sources.ts` and its test. The two `.gitignore`
    // lines the branch deletes move nothing here — this walk is the directory
    // tree, not git's list. Measured with `backend/.env` absent, no untracked
    // `docs/docs/modules/` copies, and no `docs/.module-docs-copies.json`: that
    // last one is `composer:generate`'s own record of the copies it placed, it is
    // git-ignored, and a run that has generated locally counts it while a fresh
    // checkout does not.
    //
    // **+1: the branch's changeset.** This walk's population is the whole
    // repository, so `.changeset/package-owned-tailwind-sources.md` is a file it
    // opens; 64 files plus one changeset is 65.
    // **Feature 115 Phase 6: 7878 -> 7876, re-measured on the union.** 2 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`. The walk is repository-wide, so the changeset
    // this phase adds offsets one of the three.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 7876 -> 8042.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is
    // this branch's test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`,
    // the shard it opens for the two files that stay.
    //
    // **`specs/110-instance-repository/` Phase 3 (T126/T127): 7878 -> 7882 (+4).**
    // All four files the branch adds, because this walk's population is the whole
    // repository and its filter is a deny-list: `packages/admin-shell/theme.css`,
    // `admin/test/unit/shell-theme-override.test.ts`,
    // `admin/test/helpers/compile-instance-stylesheet.mjs` and the changeset.
    // Nothing is deleted — T126 moves 207 lines *within* `admin/src/index.css`
    // into the new file and T127 rewrites a line of `storefront/app/globals.css`,
    // so both files stay. Measured with `backend/.env` absent, no untracked
    // `docs/docs/modules/` copies and no `docs/.module-docs-copies.json`.
    // **+4 for this branch, measured on the union after rebasing onto `8bf0da614`.** Four files
    // arrive: the shell's `theme.css`, its changeset, and the admin's override test with its
    // compile helper. The branch first recorded against `79a1befe6`, and Phase 6 has since
    // deleted three re-export shims, so the base moved under it — this value is a fresh census
    // of the combined tree rather than the sum of the two.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 7880 -> 7871.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files. This walk is the whole repository, so it
    // also gains the phase's own changeset file: -9 +1.
    // **`specs/110-instance-repository/` T132/T133: 7880 -> 7887 (+7).** The whole-repository
    // byte scan, so it counts everything the merge request adds: four sources, two test
    // files and the changeset. Nothing was excluded and nothing was renamed.
    // **+7, re-measured on the union after rebasing onto Phase 7.** This branch adds four
    // sources, two tests and a changeset; `specs/115-lifecycle-container-move/` Phase 7 has
    // since deleted nine lifecycle shims, so every base below is lower than this branch first
    // measured. The delta is unchanged; the total is a fresh census of the combined tree.
    // **`chore/094-retire-error-table` (over !1508): 8042 -> 8044.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **+3** was already standing at
    // `094-akeneo-pim-sync`'s tip (8045), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 7880 -> 7887 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **The same merge request: +2 more.** Its two changeset files, which this
    // walk's population includes.
    // **+9, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **+2 on the T115 branch, and only one of them is its own.** `master` gained
    // `specs/110-instance-repository/contracts/application-root-supplier.md` from the T114a
    // design merge, which is spec-only; T115 adds one empty changeset, this branch's whole
    // contribution to any whole-repository walk. Every other file it touches already existed,
    // and no file moved into or out of `backend/src/lifecycle/` — the measurement T115 is
    // about is that the movable population there is already 0.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. This walk opens the whole repository, so it sees all but the two the merge does not add as files.
    // **+2, re-measured on the union after rebasing onto `b32f37b7d`.** This branch adds
    // two files — its changeset and `backend/test/helpers/interactive-run.ts` — and renames two
    // (`hmac-canonical-vectors.{json,test.ts}` into the package), which is net zero. A whole-tree
    // walk therefore moves by exactly the two additions. The value is a fresh census of the
    // combined tree, not a sum.
    // **+2, and only one of them is this branch's** (`specs/113-module-owned-demo-data/`
    // `tasks.md`). The other +1 was already standing on `master` when this branch forked at
    // `ad0fe0876`: a docs-only merge moved this walk and re-recorded nothing, measured by the
    // baseline census run before this file was written (`3 drifted, 39 agree, 0 not measured, of
    // 42 recorded`, +1 on exactly these three entries). !1512 carries the same repair; whichever
    // lands second is a no-op, because the recorded value here is the observed one either way.
    // **+4, re-measured on the union after rebasing onto `chore/d217-d218-impl`.** Only one of
    // the four belongs to this branch: `specs/113-module-owned-demo-data/tasks.md`. The other three
    // come from the base it now sits on — `master` moved +1 in the eight merges of 2026-09-08, and
    // D-217/D-218 adds two. This branch is merged after that one, so the value is a fresh census of
    // the combined tree rather than a sum.
    // **+1 on the chained base, re-measured.** This branch adds one file, its changeset. The base
    // is `spec/113-demo-data-tasks`, which this branch is merged after.
    // **+6: five this branch's and one `master`'s.** Measured on the reverted tree,
    // which reads 7889 — so one file arrived on `master` unrecorded. The other five are
    // `specs/110-instance-repository/` T114a's: `deployment-roots.ts`, the unit test and
    // the three deployment fixtures, two of which are committed JavaScript. This walk is
    // the whole repository and reads every one of them.
    // **+1: this row's own changeset.** The file that records the platform's new
    // `./overlay` surface is itself in this walk, which is the whole repository.
    // **+6, re-measured on the chained union.** All six are this branch's: the changeset, three overlay fixture deployments (`divergence.{js,js,ts}`), `backend/test/unit/overlay/deployment-root-supplier.test.ts` and `packages/platform/src/overlay/deployment-roots.ts`. This walk opens the whole repository, so it sees every one.
    // **7 879 -> 7 884** with feature 110's D-219 batch, and the arithmetic is the whole-tree walk's: five new `.ts` files and two changesets arrive, two stylesheets go (`design-tokens.css` and the shell's `theme.css`; `components.css` is a rename).
    // **+10, re-measured on the union after rebasing onto `ad0fe0876`.** The branch's own delta
    // is unchanged and already recorded above; `master` added ten files while it was open —
    // T113/T114's seven platform sources under `packages/platform/src/{overlay,packages}/`, two
    // changesets and one contract page — and this walk opens the whole repository.
    // **+12 against this branch's own earlier record, of which +5 are its own.** It adds eight files, deletes three and renames one, which is net five for a whole-tree walk. The other seven arrive on the chained base — D-217/D-218, 113's `tasks.md`, the UnoPim re-import changeset and T114a's six. Measured on the combined tree.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This walk opens the whole repository, so it sees every file the merge adds.
    // **`fix/search-reindex-task-timeout`: files 8071 -> 8073.** Two, and this walk is the whole repository, so it is the only entry that sees both: the new co-located test file, and `.changeset/search-indexer-task-wait.md`. Measured one at a time - 8071, 8072 with the test file, 8073 with the changeset as well.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +8 files.** The
    // six net new sources plus the changeset and this feature's own spec edits;
    // this walk is the whole repository and counts every extension.
    // **Measured on a tree with no generated documentation copies.** The first
    // measurement read 7990 because `composer:generate` had placed the 66
    // git-ignored module pages under `docs/docs/modules/`, which this walk counts
    // and the recorded value never held; `git clean -fX docs/docs/modules` before
    // re-measuring, or the number recorded is one no fresh checkout reproduces.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+2, both master's.** The search fix added its changeset and its test file; this walk opens the whole repository and sees both.
    // **D-221 (`feat/catalog-new-product-route`): 8073 -> 8075 (+2).** The branch's two
    // added files, one each, measured: the new
    // `ProductsList.create-affordance-gating.test.tsx` and
    // `.changeset/catalog-create-route-takes-the-write-code.md`. This walk is the whole
    // repository, so it takes both where `check-language.sh` takes only the source file.
    // **+7 against this branch's own earlier record, of which 2 are its own.** It adds a changeset and `ProductsList.create-affordance-gating.test.tsx`; the other five arrive on the base, T116 having moved the ORM and the twelve core migrations into the platform since this branch recorded. Measured on the combined tree.
    // **`fix/ordering-guard-follows-the-platform`: 8082 -> 8083 (+1).** One added file,
    // `.changeset/ordering-guard-follows-the-derivation.md`. Attributed by measurement —
    // the same walk over the same tree with that one file moved aside reads 8082. The
    // branch's other three files are edits to files this walk already opened.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +3 files.**
    // The listing is `git ls-files --cached --others`, so the move is net zero and
    // the three additions are the platform's `cli/index.ts` barrel, the re-export
    // shim at `backend/src/cli/module-commands.ts`, and this row's changeset.
    // Measured against a pristine `origin/master` worktree, which read exactly the
    // recorded value.
    // **+1, and it is not this branch's.** `fix/ordering-guard-follows-the-platform` merged after this branch recorded, adding `.changeset/ordering-guard-follows-the-derivation.md`; this walk opens the whole repository. Re-measured on the union.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 8082 -> 8084.** four files
    // arrive — `src/seeds/demo-composition.ts`, `src/seeds/demo-host-residue.ts`,
    // `src/demo/composition-loader.ts` and `test/integration/demo/demo-parity.test.ts` —
    // against the two `src/seeds/` re-export shims T215 deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. Decomposed by measuring the base rather than by arithmetic: `feat/110-t117-cli-to-platform` itself reads 8086 here, so +2 of the move against this branch's earlier record is the base's and the remaining +3 is this branch's own net — eight files added, five deleted.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 8089
    // -> 8112 (+23).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads every one of them — this walk is the whole
    // repository.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. Repo-wide, so it takes the source and the changeset both.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 8114 -> 8136.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +3 files.** The two sources above plus the
    // changeset, because this walk's population is the whole repository rather than a
    // source root.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 8136 here, so this branch's own contribution is +3. All three files this branch adds: the platform source, the unit test and the changeset. This walk opens the whole repository, which is why it is the entry that shows the branch's full net.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 8136 -> 8142 (+6).**
    // Six files: the check, its injected filesystem, the fixture builder, the
    // companion test and the phase's two changesets. This walk is the whole
    // repository, so it is the one that counts the `.md` as well.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 8139 here — so this branch's own contribution is +6. This branch adds six files: the check, its library, its ledger, its companion test, and two changesets. This walk opens the whole repository, so it is the entry that shows the full net.
    // **Feature 113's T226: files 8145 -> 8142 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 8142 -> 8145 (+3).**
    // This walk is the whole repository, so it reads the one platform source
    // (`packages/platform/src/demo/packages.ts`) and the two changesets this merge
    // request carries.
    // **`specs/110-instance-repository/` T118b: files 8145 -> 8148 (+3).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. This walk reads the whole tree, so it takes a third file: the merge
    // request's own changeset, which is written last, after the numbers have been
    // read, and is the one that is easy to forget. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 8148 -> 8121 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`fix/admin-image-root-scripts`: files 8145 -> 8147.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. The whole tree, and there is no changeset to make it three.
    // **Re-measured on the union after rebasing onto `7b70edf22`.** Feature 110's T118b
    // landed on `master` between this branch's base and the rebase, adding two sources
    // this walk reads, so the recorded value describes neither tree on its own: 8147 -> 8150.
    // Measured on the combined tree — a read size is a measurement of what the run walks,
    // never a sum of the two sides' deltas.
    // **Re-measured on the union after rebasing onto T119.** That task deleted the
    // twenty-seven re-export shims this walk was reading, so every entry here moves by the
    // same −27 and this one lands at 8123 rather than the 8150 recorded against a tree that
    // still held them. The two files this branch adds were already in the recorded value;
    // measured on the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 8123
    // -> 8127 (+4). All four files this branch adds, the changeset included — this walk
    // reads every file in the repository.
    // **T119a: 8123 -> 8117.** The whole repository: -9 shims, -50 and +50 for the moved
    // test files, +2 for `packages/platform/vitest.config.ts` and `vitest.setup.ts`, and
    // +1 for `tsconfig.test.json`, which this walk opens because its population is a
    // deny-list rather than an extension allow-list.
    // **T119a's changeset: 8117 -> 8118.** One markdown file under `.changeset/`, which
    // this walk opens because its population is a deny-list rather than an extension
    // allow-list.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 8118 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 8123 -> 8129.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, the whole repository minus two declared exclusions, so it takes all six.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 8129 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: 8122 -> 8126.** The whole repository: three new source
    // files and the merge request's changeset. Measured on a **fresh-checkout shape** —
    // `docs/docs/modules/` holding only its three tracked files, not the 77 pages
    // `composer:generate` collects there. Those are git-ignored and the `quality` job
    // produces none of them before this check runs; with the generator run first the
    // identical tree reads 8201, and the recorded number would then describe a working
    // copy rather than CI's.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 8126 -> 8132. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 8128 -> 8115.** the eleven re-export
    // shims `specs/110-instance-repository/` T119b deleted from `backend/src` (`demo/index.ts`,
    // `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely. Measured with
    // `docs/docs/modules/` **absent**, which is the tree every `quality` job walks: this is the
    // one recorded walk that reads git-ignored files, so a developer who has run
    // `composer:generate` sees the 80 module pages it places there and the census prints `8195`
    // — measured, by moving the directory aside and re-running. The two files beyond this
    // task's eleven predate it and are re-recorded here because this is the merge request whose
    // census measured them, and the +1 over that first reading is the changeset this merge
    // request carries — this walk reads `.changeset/*.md` too, so the file that declares the
    // release lands in the census that measures it.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 8116 -> 8122. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 8126 rather than the
    // 8136 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 8126 -> 8120 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **+1 more for the changeset**, which this whole-repository walk reads and the
    // narrower ones do not.
    // **D-223: files 8126 -> 8132 (+6).** The five `.ts` files it adds and one markdown
    // file, the changeset.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 8132 recorded against the tree before it: 8127. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **T11A (`specs/110-instance-repository/`): files 8127 -> 8129.** T11A's two files, over
    // the whole-repository walk. Quality-job shape — this worktree has never run
    // `composer:generate`, so the ignored copies under `docs/docs/modules/` are not placed;
    // parking both files reads 8127 exactly.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 8127 -> 8133, every file the branch adds — the five `.ts`
    // files and the changeset. This is the whole-tree walk, so the changeset counts here and
    // not in the module ones; it is the file that is easy to forget, being written after the
    // numbers are first read.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 8133 recorded before it: 8135. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 8135 -> 8140, the four new `.ts` files
    // and this merge request's changeset — this walk reads every extension. Quality-job
    // shape: the ignored copies `composer:generate` places under `docs/docs/modules/`
    // swept first, because no job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's five new TypeScript files — two `pwa` module sources,
    // their two co-located tests and one backend integration test — plus the changeset,
    // this walk reading markdown too.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 8141 -> 8146. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // Measured on a tree carrying no `backend/test-results.junit.xml`. This walk is a
    // deny-list over the whole repository, so it counts that report when a `CI=1` run has
    // left one behind — 8149 rather than 8148, measured both ways. The clean-checkout
    // number is the one to record: it is what the `quality` job reads, and the artefact is
    // a run's output rather than a file of this tree (it is in `.gitignore` as of this
    // merge request).
    // **T118c, `invoicesBridge`: +5 files** — the three new `.ts` files and this merge
    // request's two changesets, which this walk opens like any other file.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 8151 recorded against the tree before it: 8153. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 8146 -> 8148.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 8148 -> 8155.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/110-instance-template-symbols` (the scaffolded backend compiles): files 8155 -> 8157.**
    // The two files this branch adds —
    // `packages/cli/test/new-instance/template-reconciliation.test.ts` and its changeset — which
    // this walk opens like any other file. Attributed by measurement rather than by subtraction:
    // both were moved aside and the three drifting checks re-run, and the tree underneath read
    // 8155 exactly, so the whole delta is this branch's.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 8153 -> 8285.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 8285 -> 8289.** Neither side's
    // recorded value describes this tree: this branch's 8285 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 8157 was measured
    // without feature 119's two module packages. The +4 is every file the master side adds —
    // the two under `backend/test/`,
    // `packages/cli/test/new-instance/template-reconciliation.test.ts` and this side's
    // changeset — because this walk reads the whole repository and every extension. Measured
    // twice: parking all four reads 8285, and parking the `packages/cli` test alone reads
    // 8288. Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // Measured on the combined tree, never summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 8157 -> 8161.** Four, which is every file this merge request adds: the criterion, its judgement, its recorded expectation and its unit test. The whole-tree walk counts the JSON; there is no changeset, because `backend` is in the changesets `ignore` list.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 8289 -> 8294.** Neither side's recorded value describes this tree: the
    // branch's 8289 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 8289 exactly, so the whole delta is every file the master side
    // adds: the criterion, its judgement, its recorded expectation, its unit test and
    // `specs/114-release-shape-gate/tasks.md`. This walk is the whole tree, JSON included.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 114, Phase 1: 8294 -> 8295.** One file, and it is the whole move —
    // `.changeset/release-shape-classification.md`, the empty changeset this branch
    // carries. Its four subjects are a check, two tests and a CI job, all of which
    // already existed; this walk is the whole repository and `.changeset/*.md` is in
    // it. Attributed by parking the file and re-running: 8294 without it, 8295 with,
    // in the same tree and in the quality job's shape.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **Merged with `origin/master` at f788f9af5, and re-measured rather than reconciled.** Feature 114's Phase 1 moved this walk by one — its own empty changeset — and this branch moved it by six, so each side's number describes a tree without the other's files and no arithmetic over the two produces the union. The number below is a fresh measurement on the merged tree, taken in a worktree created from the merge commit and reporting an empty `git status`.
    // **Feature 114, Phase 2 (the history landing): 8295 -> 8165.** The largest single
    // move this record has taken, and it is the operation itself rather than anything
    // that grew: D-213 consumes 214 changesets into `0.7.0`'s changelogs, so the branch
    // deletes 214 `.changeset/*.md`, adds 83 `CHANGELOG.md` and adds the landing's
    // verifier — net −130, which is the whole gap. Park-and-re-measure is not available
    // for a deletion of 214 files, so it is cross-checked instead: the branch's own
    // added and deleted lists account for −130 exactly, so the recorded 8295 does
    // describe `master` and none of the move is anything else's. **Measured**, in a
    // fresh worktree in the quality job's shape (`git clean -fX docs/docs/modules`, the
    // copies file removed, `build:packages` first) — never computed from the delta; the
    // arithmetic above is the attribution, not the number.
    // **Merged with `origin/master` at f93a38ed6 (!1592, the instance bring-up repairs),
    // and re-measured rather than reconciled: 8171.** That branch added six files and so
    // moved this walk +6 to 8301; this one deletes 214 changesets and adds 84 files and so
    // moved it −130 to 8165. Each number describes a tree without the other's files and
    // there is no arithmetic over the two that produces the union — the number below is a
    // fresh measurement on the merged tree, in a worktree created from the merge commit,
    // in the quality job's shape, reporting an empty `git status`.
    // **Feature 114 Phase 3 (D-225): +1 -> 8172.** This merge request adds exactly one
    // tracked file — the empty changeset that records that neither half of it has any
    // release meaning — and its other fifteen changeset edits are modifications. Measured
    // on both sides in one worktree created from the branch, `quality`-job tree shape, with
    // nothing rebuilt between the two runs: `origin/master` reads 8171, the recorded value
    // exactly, and the branch reads 8172.
    // **`specs/110-instance-repository/` T138 (the admin member): files +7, plus 3 of `master`'s own.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // Three of the ten are `specs/120-…`'s, which arrived on `master` at 15b866da3 without a
    // re-record; the pristine-worktree measurement of that commit reads 8104 against a
    // recorded 8101. This walk reads the whole repository, so it is the one that sees the
    // changeset and the two `backend/scripts` shims as well.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 8111 -> 8117 (+6).** The five new files — `packages/cli/src/lib/docs-artefacts.ts`, `packages/cli/src/new-instance/docs-toolchain.ts`, `backend/scripts/lib/docs-artefacts.ts` and the two new tests under `packages/cli/test/new-instance/` — plus this branch's changeset, which this whole-repository walk reads and the narrower ones do not. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 8117,
    sites: null,
    sources: [],
    //
    // **7888 -> 7891, of which +2 is this branch.** D-217 added
    // `backend/test/helpers/interactive-run.ts`, the launcher
    // `uninstall-hard-needs-force.integration.test.ts` spawns to prove `--hard`
    // refuses at a terminal too. Plus the changeset markdown file. The population
    // is the whole repository, so the D-218 move is a transfer and nets zero here.
    // With both withdrawn the tree reads **7889**; the remaining +1 was already in
    // it.
  },
  'backend/scripts/check-off-state-coverage.ts': {
    prefix: '[off-state-coverage]',
    run: { kind: 'tsx', path: 'scripts/check-off-state-coverage.ts', args: [] },
    // Every `.ts` file under `backend/test` whose text mentions either harness
    // name, minus `test/helpers/off-state.ts` itself — the file that *declares*
    // the two names is not a caller of them. It is deliberately not "files with
    // a finding": the whole population of the caller walk, so a test root that
    // moved falls to zero and is refused rather than reported clean.
    //
    // Three of the 109 are this check's own: the companion test, the inventory
    // entry's fixtures and this comment all *mention* the two names, so the
    // walk opens them. None of the three adds a **site**, because a call is
    // read as an AST node and a harness call inside a string literal is not
    // one — which is the discrimination that keeps three files in the tree,
    // whose doc blocks say why they do *not* call `expectModuleAbsent`, from
    // being credited with a proof they explicitly declined to write.
    // **Feature 096, Phase 6: +1.** This feature’s block-owner off-state test.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 110 -> 111.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 111 -> 114.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 114,
    // The finer population, and the one that moves when a **resolver shape** is
    // added or lost: every `expectModuleAbsent` and `withModuleOff` call the
    // walk read, both helpers, one per call however many modules the call
    // names. Nine of them are table-driven `it.each` sites, and the file count
    // does not move when that shape stops resolving — which is exactly why a
    // check that answers per call has to print both numbers (#235/#237).
    // **Feature 096, Phase 6: +3.** Three `withModuleOff` subjects in this
    // feature’s block-owner off-state test — `ksef` on each axis, and the
    // synthetic `test_ext` the same file seeds into the registry cache as a
    // literal, which is what the exemption is derived from.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 201 -> 202.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 202 -> 205.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 205,
    // Two independent authors, so the check computes no module list and no
    // call-name list of its own. `manifest-index` is every entry the generated
    // index carries against every entry whose manifest this run could classify
    // — 71/71 — and the 46 of them with an activation control are printed on
    // the summary line rather than in this token, because
    // `manifest-index:46/71` is what `read-size.ts` refuses as a `short-walk`.
    // `harness-exports` is the callable helpers `test/helpers/off-state.ts`
    // exports against the two the predicate keys on: a third assertion helper
    // makes it 2/3, which is the sixth vacuous refusal in the shared grammar.
    sources: ['manifest-index', 'harness-exports'],
  },
  'backend/scripts/check-overlay-determinism.ts': {
    prefix: '[overlay:check]',
    run: { kind: 'tsx', path: 'scripts/check-overlay-determinism.ts', args: [] },
    // Every entry in the rendered artefacts, which is the
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
    // **Batch 14 (feature 091, Phase 4): 508 -> 510.** The two import lines
    // `admin/src/modules.generated.ts` gains for `@endora-commerce/mod-customers/admin`
    // and `@endora-commerce/mod-organizations/admin`; `sales_channels` was
    // already in that registry, P7a having given it an `./admin` layer three
    // merge requests early.
    // **Batch 15: 510 -> 511.** One: `admin/src/modules.generated.ts` gains the
    // `@endora-commerce/mod-catalog/admin` entry. `orders` was already in that
    // registry, its `order.entry.tabs` contribution having arrived in P4d.
    // **511 -> 524** on `origin/master` between this branch's fork point and its
    // rebase: further `./admin` entries in the admin contribution registry.
    //
    // **Feature 100 Phase 1: files 8 -> 10, sites 524 -> 667**, and this is
    // the first move of either number that is not an import line. 143 of the 156
    // are this branch's — 78 navigation entries (65 module entries, the map's
    // own, and 12 sub-pages) and 65 map links, one per documented module — and
    // the remaining 13 are `origin/master`'s own growth between the fork point
    // and the rebase, inside the band on that side and named here rather than
    // absorbed. Measured on the rebased tree, not apportioned. The two files
    // are the documentation artefacts — `docs/sidebars.modules.generated.js` and
    // `docs/docs/modules/module-map.generated.md` — which is the first time the
    // artefact set has grown since the admin registry. Their entries are **not**
    // import specifiers: a sidebar entry is a doc id and a map row is a relative
    // page link, so `foreign` is re-derived for them over the same real-path
    // discriminator (`contracts/docs-registry.md` R2.3). One navigation entry per
    // page plus the map's own, and one map link per documented module. It moves
    // with the pages, which is what it is for: a module gaining a page moves it
    // by one or two, and a module *losing* its page moves it down, which is the
    // direction `check:module-docs`' own `orphan-page` and `undocumented-module`
    // answer for.
    //
    // **Feature 100 Phase 3: files 10 -> 81, sites 672 -> 814.** The 71 are one
    // committed reference page per module (FR-022), which is the largest single
    // move the artefact set has ever made and the reason `files` is the number
    // that has to move: `overlay:check` holds each of them to `stale`, so a
    // module whose manifest changes and whose page does not is a build failure.
    // 142 of the 143 sites are this branch's, exactly two per page — the
    // navigation entry the sidebar fragment gains for it, and the one relative
    // link the page itself writes (its module's prose page, or the module map
    // for a module nobody has written about). The remaining 1 is `origin/master`'s
    // own growth between the fork point and the run, inside the band on that
    // side and named here rather than absorbed. Measured on this tree, not
    // apportioned. A module added or removed now moves `files` by one, which is
    // the property that makes the number worth recording.
    //
    // **`specs/110-instance-repository/` Phase 4a: files 84 -> 85, sites
    // unchanged.** The eighth artefact — the published baseline list, the frozen
    // historical prefix as a list of migration class names, which is the first
    // artefact to land inside a *package* rather than in an application's tree
    // (R1.5: it is data about this platform's history and a client receives it
    // by installing the platform). `sites` does not move because its entries are
    // migration **classes**, not files: it declares `entryKind: 'none'`, the
    // state D-155.6 added so that an artefact with no containment population by
    // construction is not read as a walk that came back short. That the list and
    // the registry agree is asserted where it can be, over both committed
    // artefacts, in `test/unit/db/instance-migration-order.test.ts`.
    //
    // **`specs/110-instance-repository/` Phase 3 (T124): files 85 -> 86, sites
    // 814 -> 874.** The one file is `admin/src/tailwind.generated.css`, the
    // ninth artefact and the first this generator renders that is not
    // TypeScript, JavaScript or markdown — so it is also the first to declare
    // `entryKind: 'css-specifier'`, CSS's own `@import` grammar over the same
    // containment question and the same classifier. The 60 sites are one import
    // per package that declares `./tailwind.css`: 55 module admin layers, plus
    // the shell and the four kit-family packages, which contribute UI and
    // contribute no admin-registry entry (R2.2's superset). It moves by one when
    // a module gains or drops a UI layer, which is what makes it worth
    // recording — that is the same event that moves the admin registry, and the
    // two are rendered from one layer inventory so they cannot move apart.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 874 -> 885.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 885 -> 905.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 905,
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 86 -> 87.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 87 -> 89.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 89,
    sources: [],
  },
  'backend/scripts/check-port-catches.ts': {
    prefix: '[port-catches]',
    run: { kind: 'tsx', path: 'scripts/check-port-catches.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file, and `sites` deliberately unmoved.** `mfa`'s new
    // module source reaches four ports and wraps none of them in a `catch` — which is the
    // point of the file rather than an omission: on an authentication path, reading a
    // `ModuleDisabledError` as "the password does not match" is the fail-open item 7
    // refuses. A `sites` that moved here would mean a `catch` had been written.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    //
    // **The promise form (issue #84's blind spot): sites 162 -> 168, files
    // unchanged.** The check gained a second site class — `.catch(handler)` and
    // `.then(onOk, onErr)` — so `sites` is now guarded-port sites in **both**
    // spellings. It opens no new file, which is why only one of the two numbers
    // moves.
    //
    // Six is the net of two movements measured separately on the branch's own
    // base, and both belong to this change: **+14** promise-form sites the
    // widening adds, and **-8** sites that leave the population because three
    // bindings were renamed — `pim_pimcore`'s file-scoped `worker`, and
    // `product_feeds`' `open` and `body` — each of which was carrying an alias
    // into calls on a BullMQ handle, an artefact store and a web
    // `ReadableStream`. Six of those eight were the promise sites those
    // renames cleared; two were `try` sites over the same aliases.
    //
    // **The inherited drift is deliberately left standing.** This row read 162
    // while the tree read 190 before a line of this branch was written: the
    // `089-unopim-pim-sync` merge of 2026-09-02 moved it and nothing
    // re-recorded it, and the same merge is the whole of `files` 1916 -> 2003.
    // Re-recording either would file `master`'s growth under this change, so
    // 168 keeps the +28 sites and +87 files of drift visible to whoever owns
    // it.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 196 -> 213.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. This walk gains the module's 61 backend sources and the 17 port-call sites in them.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 17 port-call sites in the module's backend.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **`specs/113-module-owned-demo-data/` Phase 1: sites 213 -> 214.** one site,
    // measured with `PORT_CATCH_WHY=1`: `runSteps` in `src/seeds/demo-composition.ts`, a
    // local the analysis reads as a port-bearing alias. It is a site and not a violation.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **`specs/110-instance-repository/` T118: sites 214 -> 212 (-2).** Two port-shaped
    // names left `backend/src/composition.ts` with the assembly — `settingsManifestCollectionPort`,
    // whose one reader is the boot settings reconcile, and the envelope's `adminUserReadPort`
    // accessor. Both are in `compose-app.ts` now and both are still judged: this walk's
    // population is the source roots, the platform's among them, so the sites moved rather
    // than went. `files` moves +1 in the same breath, which is what says so.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148 and sites 212 -> 213, and the two are the same file: the module source this
    // task extracts, `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`
    // holds the `catch` around the port call. The drained closure's `try/catch -> null`
    // moved out of `backend/src/composition.ts`, which this walk does not read, into the
    // module that owns the seam — the same code counted for the first time rather than a
    // new site. It is a site and not a violation: `rethrowIfModuleDisabled` is its first
    // line.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 212 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file.** The module walk gains
    // `services/notification-context.ts`. The **site** count is unmoved at 213, and that is
    // arithmetic rather than coincidence: the drain made `returns`' e-mail notifier read as
    // port-bearing, which put a module-wide `notifier` alias on it and turned
    // `return-comment-service.ts`' bare `catch` into a violation — a collision with an
    // identically-named optional dependency no composition ever supplied. That dead seam is
    // deleted, so one site leaves as one arrives.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** sites 213 -> 221, the four byte-store
    // `catch`es in `product_feeds` become visible as guarded-port catches — the artefact
    // writer, the public route, the retention sweep and the reaper reached
    // `assetsLibrary.handle.adapters` through a root before and reach `objectStoragePort`
    // now — plus four more the same conversion makes readable. All eight are `OWNER
    // LOCKED`, derived from `assets_library` declaring `nonDeactivatable`, so `ledgered`
    // does not move. Quality-job shape: the ignored copies `composer:generate` places
    // under `docs/docs/modules/` swept first, because no job has placed them when these
    // checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own. `sites` moves by the three `lazyPort` resolutions
    // the module gains — `assetsLibraryPort`, `salesChannelResolutionPort` and
    // `orderReadPort` — which is this walk's population rather than the `catch` count.
    // **One** `catch` arrives with them, in `createAssetUrlResolver`, and it is
    // compliant: `rethrowIfModuleDisabled` is its first line, so a deleted asset still
    // answers 404 on one icon size while an owner's refusal is not absorbed.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 216 -> 224. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`).
    // **And `sites` 224 -> 227, which is the number worth reading here.** One is the
    // owner's: `assets_library`' `openAssetBytes` keeps a narrow `catch` around the
    // store open and the drain — the degrade the two roots' closures used to carry —
    // with `rethrowIfModuleDisabled` as its first line. The other **two** are pre-
    // existing `catch`es inside `invoices` that this drain makes *visible*: the module
    // now has `getTransactionalEmailSender`, `resolveRecipientEmail` and
    // `loadAssetImage` as port-bearing aliases, so `catch`es the analysis could not see
    // as port-adjacent are in the population. Both were already compliant — `ledgered`
    // and `owner-locked` are unchanged at 5 and 11 and `violations` is 0, so the two
    // new sites re-throw. **Measured rather than reasoned about**: with the module
    // files at their new state and the two roots at their old one this walk reads 227
    // all the same, and with the owner's file alone reverted it reads 226 — the roots'
    // two deleted `catch`es were never in this population, because a root reaches
    // `assetReadPort` through a local accessor rather than an alias.
    sites: 227,
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the branch's one new
    // module source, `assets_library`' `services/storage/object-storage-port.ts`.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-port-dependencies.ts': {
    prefix: '[port-deps]',
    run: { kind: 'tsx', path: 'scripts/check-port-dependencies.ts', args: [] },
    // **T118c, `mfaActorBridge`: +6 sites, +1 file.** The file is `mfa`'s new module source.
    // The sites are net: **seven** new resolutions in `mfa`'s registration — the four
    // `lazyPort` reads of `customerAccountReadPort`, `adminUserReadPort`,
    // `customerPasswordVerificationPort` and `adminPasswordVerificationPort`, plus the two
    // `customerActorResolver` reads and the one `adminContextResolver` read — against the
    // single `mfaActorBridge` cradle read the drain deletes.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1699 -> 1702.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1794 -> 1846.** 52 module
    // packages gain a `vitest.config.ts`.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1846 -> 1847.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1847 -> 1849 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 1849 -> 1850 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 1849 again.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **`specs/115-lifecycle-container-move/` Phase 5: 1849 -> 1855 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1855 -> 1916.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): sites 1535
    // -> 1543 (+8), files 1916 -> 1929 (+13).** The branch adds 23 files and removes none:
    // four modules' `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test
    // each), `taxes`' `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts`
    // — the frozen copy of the moved blocks that keeps the demo parity comparison a
    // comparison — and five changesets. This walk reads the twelve non-test module files
    // and `taxes`' `vitest.config.ts`; it reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 1929 -> 1941, sites 1543 -> 1551.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1941
    // -> 1942 and sites 1551 -> 1552. The file is the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`; the site is
    // `cms`' `lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort')`, which stays in
    // `backend/index.ts`. The edge was already declared in that module's manifest, so the
    // count moves and no verdict does.
    // **T118c, `returnsBridge`: 1552 -> 1558 sites, 1942 -> 1943 files.** Five of the six
    // sites are the module resolving what a composition root used to forward —
    // `orderReturnContextPort`, `paymentRefundPort`, `correctiveInvoicePort`,
    // `creditTopupPort` and `customerAccountReadPort` — and the sixth is the
    // `settingsReadPort` resolution moving with the rewritten factory. The file is
    // `services/notification-context.ts`. A composition root's own resolutions are in no
    // population here, so a drain that removes four from a root and adds five in a module
    // reads as a rise rather than as a transfer.
    // **D-223: files 1944 -> 1945 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1945 -> 1947, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 1947 -> 1948, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own. `sites` moves by the same three resolutions. Only
    // one of them is a manifest edge — `orderReadPort` puts `orders` in `pwa`'s
    // `dependencies` — because `assets_library` was already declared and
    // `salesChannelResolutionPort` is on `PLATFORM_OWNED_NAMES`.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 1949 -> 1950. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). The three `sites` are **net**: five
    // resolutions arrive in `invoices`' registration — two `lazyPort` reads and three
    // contributed-name reads — against the two `invoicesBridge` cradle reads that go.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1951 -> 1996.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 1997,
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 1471 -> 1535.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** sites 1564 -> 1568, three net `lazyPort` resolutions plus one
    // cradle read. `megamenu` gains five — `catalogCategoryReadPort`, `cmsPageReadPort`,
    // `cmsBlockReadPort`, `assetReadPort` and `assetsLibraryPort` — against the two the drain
    // deletes, `megamenuValidatorDeps` and `megamenuStorefrontDeps`; the fourth is `cms`' new
    // `providePort` factory destructuring `emFactory`, which Awilix makes a cradle read. A
    // composition root's own reads are in no population here, so a drain that removes eight
    // closures from two roots and adds five resolutions in a module reads as a rise.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** sites 1568 -> 1573, the four new `lazyPort`
    // resolutions in `product_feeds`, plus `assets_library`' new port registration.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 1571 -> 1576. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 1579 -> 1645.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 1645,
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
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It names
    // `@endora-commerce/platform/http` for `HttpError`, which is published, so the reach
    // count does not move.
    // **Batch 13 (feature 091, Phase 4): +24.** Every one of the batch's moved
    // screens, this walk's population being module sources of both extensions.
    // **Batch 14 (feature 091, Phase 4): +20 files.** Twenty-one files arrive
    // under `packages/modules/{customers,organizations,sales_channels}/src/admin/`
    // and enter the module walk, where the admin application's own directories
    // were not. One `.tsx` under the moved set was already this walk's, being
    // `sales_channels`' P7a contribution.
    // **Batch 15 (feature 091, Phase 4): 1907 -> 1931.** Twenty-seven admin
    // files became module-package sources, four shims were deleted and one
    // `admin/index.ts` was added: twenty-four net. They reach no platform
    // symbol, so `ledger-size` does not move — this is the population growing,
    // which is exactly what this number is recorded to notice.
    // **Feature 115 Phase 1 (`specs/115-lifecycle-container-move/`): 2069 -> 2385.**
    // The application joins the population as a second consumer (D115-5): 316
    // files, being `backend/src` minus its module walk roots (137) plus
    // `backend/scripts` (179). This is the whole of the +316, and it is a
    // population that arrives rather than a tree that grew — the module half's
    // 2069 is unchanged and is what `manifest-index:71/71` still corroborates.
    // **Stacked on the publication branch: +2.** `backend/scripts/pack-gate.ts`
    // and `backend/scripts/lib/pack-assert.ts`; the test and the two changesets
    // are outside this walk's application population.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2387 -> 2388.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2388 -> 2390 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2390 -> 2391 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2390 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 site.** The application gained
    // one relative reach into the platform and this ledger gained the entry for
    // it: `backend/src/kernel/i18n/error-translation.ts`, the shim over the routing
    // derivation the phase moved out of `_i18n`. One relative reach in exchange for
    // one module import in a file that is about to become platform code, and it
    // retires with its neighbours when T118 moves the caller.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2392 -> 2398 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` Phase 3 (T123): 2398 -> 2399 (+1).** One
    // application file, `scripts/lib/tailwind-sources.ts` — the derivation the
    // manifest generator, the composer and the guard share. It reaches no platform
    // file, so the ledger and the reach count do not move with it.

    // **Feature 115 Phase 6: 2399 -> 2396, re-measured on the union.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2396 -> 2465.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is
    // this branch's test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`,
    // the shard it opens for the two files that stay.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2396 -> 2387 and sites 1823 -> 1814.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2465 -> 2456.** None of this move is this branch's — the tip of
    // `094-akeneo-pim-sync` already read 2456, from the two adaptations !1496 and !1508 and
    // the `master` merge it carries. This walk does not reach `backend/src/modules`, so the
    // one file this branch deletes is outside it; re-recorded here because this merge
    // request is the one whose census measured the drift.
    // **2 387 -> 2 391** with T129b's four files under `backend/scripts` — the check, its analysis and its two ledgers. Its companion test is not in this population.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's sources, whose reaches into the host this walk judges.
    // **`specs/110-instance-repository/` T116 (the `db/` move): -14 files.** This
    // walk's population is the application's own tree and the module packages,
    // and the platform's is neither — so it sees only the departure: the twelve
    // core migrations and the two `db/` sources that left `backend/src/db/`
    // without a binding behind them.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2446 -> 2447.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): sites 1871
    // -> 1884 (+13), files 2447 -> 2460 (+13).** The branch adds 23 files and removes
    // none: four modules' `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located
    // test each), `taxes`' `vitest.config.ts`,
    // `backend/src/seeds/demo-relocated-reference.ts` — the frozen copy of the moved
    // blocks that keeps the demo parity comparison a comparison — and five changesets.
    // This walk reads the twelve non-test module files and `taxes`' `vitest.config.ts`; it
    // reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2460 -> 2471, sites 1884 -> 1896.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 2471 -> 2473 (+2).**
    // The two `backend/scripts/*.ts` files this phase adds — its application walk
    // is the `RELATIVE_HOST_REACHES` half, whose population is the application
    // tree and not only its `src`.
    // **Feature 113's T226: files 2473 -> 2470 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2470 -> 2443 (-27).**
    // The twenty-seven re-export shims this walk read as ordinary application
    // sources. The 193 consumer specifiers the drain re-points are almost all under
    // `backend/test/**`, which this walk does not read, so the file count moves by
    // exactly the shims and by nothing else. Measured on a pristine `origin/master`
    // worktree at `7b70edf22` and re-measured there after the rebase.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2443
    // -> 2444 and sites 1870 -> 1871. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`, and its one
    // reach into the host: `rethrowIfModuleDisabled` from
    // `@endora-commerce/platform/kernel`, a published barrel symbol. This entry is in the
    // census **because the extraction added a module source**; the branch's earlier shape
    // moved neither number, which is what the header below is about.
    // **T119a: 2443 -> 2434.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2434 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 2443 -> 2445.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, its application half walks the application tree rather than only its `src`, so it takes the two new `backend/scripts/*.ts` files; the two under `backend/test/**` and the two root shell scripts are outside it.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 2445 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 site, +1 file.** `returns`' new module source and its
    // one reach into published platform surface — `SalesChannel` off
    // `@endora-commerce/platform/kernel`, the symbol `orders` already names at the
    // identical site. Both ledgers are unchanged.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 2436 -> 2438. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 2437 -> 2426 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely. Exactly the shims
    // and nothing else: the 92 consumer files this task re-points are overwhelmingly under
    // `backend/test/**`, which the application walk does not read, and the barrel and manifest
    // edits are the platform's own.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2426 -> 2427. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2428 rather than the
    // 2439 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2428 -> 2422 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2428 -> 2429 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2429 recorded against the tree before it: 2423. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2423 -> 2425, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2425 -> 2426, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own. `sites` moves by the four platform reaches the two
    // files add: `rethrowIfModuleDisabled` and `SalesChannelResolutionPort` in
    // `cross-module-context.ts`, the same type again in the barrel, and the side-effect
    // import of the `./http` barrel in `request-actor.ts` — which is how T118b's
    // `request.actor` augmentation reaches this package's program, and which is not a
    // `whole-file-reach` because reaching a published barrel is reaching the surface.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2427 -> 2428. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). The two `sites` are its two reaches into
    // the platform: `SalesChannel` off `@endora-commerce/platform/kernel`, for the
    // channel-language read that came out of a root.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2429 -> 2479.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T140 (the instance acceptance criterion): files 2429 -> 2431.** Two: the criterion and its judgement, both application sources under `backend/scripts/`. Its application half is what opens them; the JSON and the test file are outside both populations.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 2479 -> 2481.** Neither side's recorded value describes this tree: the
    // branch's 2479 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 2479 exactly, so the whole delta is the criterion and its
    // judgement, both application sources under `backend/scripts/`. The JSON, the test file and
    // the spec page are outside both of its populations. Quality-job shape — the ignored copies
    // under `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the
    // two sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 2483 -> 2484 (+1).** One file: this walk is the module roots plus the application, and the application gains `backend/scripts/lib/docs-artefacts.ts`. The two new `packages/cli/src/` files are in neither population — the CLI is not a module package. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 2484,
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
    //
    // **Feature 115 Phase 1: 1744 -> 1828.** +84, and every one of them a reach
    // this check could not see: an application file naming a file inside
    // `packages/platform` by relative path. It is the population the guard adds
    // and not a tree that grew, so it moves once and then drains — each of the
    // 84 is a `RELATIVE_HOST_REACHES` key with a retiring phase, and this number
    // falls as they go. The module half's 1744 is untouched.
    //
    // **Feature 115 Phase 6: 2399 -> 2396, re-measured on the union.** −6, and this is that drain
    // beginning: the phase deletes three `_lifecycle` shims whose only content
    // was one relative reach each, and re-points the two generated artefacts and
    // five application files onto `@endora-commerce/platform/lifecycle`. Six
    // `RELATIVE_HOST_REACHES` keys retire with them and `host-reaches` falls
    // 84 -> 79 files, which is a derived floor and not a band.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 1823 -> 1882.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`chore/094-retire-error-table` (over !1508): 1882 -> 1873.** None of this move is this branch's — the tip of
    // `094-akeneo-pim-sync` already read 1873, from the two adaptations !1496 and !1508 and
    // the `master` merge it carries. This walk does not reach `backend/src/modules`, so the
    // one file this branch deletes is outside it; re-recorded here because this merge
    // request is the one whose census measured the drift.
    // **`specs/113-module-owned-demo-data/` Phase 1: sites 1873 -> 1871.** T215 deletes
    // `src/seeds/dev-seed-guard.ts` and `src/seeds/seed-scope.ts`, and each was one
    // relative host reach — `ledger-size` falls 70 -> 68 with them.
    // **`specs/110-instance-repository/` T118b: sites 1896 -> 1897 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **`specs/110-instance-repository/` T119 (the shim drain): sites 1897 -> 1870 (-27).**
    // One site per deleted shim — each was a single `export *` into the platform,
    // which is the whole of its contribution to this walk — so `ledger-size` falls
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 1861 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T119b: sites 1862 -> 1851 (-11).** One site per
    // deleted shim — each was a single `export *` into the platform, which is the whole of its
    // contribution to this walk — so `ledger-size` falls 32 -> 21 and the `host-reaches` floor,
    // which is derived from the ledger rather than banded, falls with it.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 1851 -> 1852. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **`specs/110-instance-repository/` T119c: sites 1852 -> 1846 (-6), and this is the
    // whole of the task.** Each deleted shim *was* a site: a relative reach from
    // `backend/src` into `packages/platform/dist`. The 416 consumer specifiers this task
    // re-points are **not** in this population — they were relative reaches written in
    // application files, which this half reads, but they resolved into `backend/src` and
    // not into the platform. `ledger-size` 21 -> 15 and `host-reaches:21/21 -> 15/15`
    // move with them.
    // **D-223: sites 1852 -> 1853 (+1).** One reach: `assets_library`' `backend/index.ts`
    // now takes `resolvePublicApiBaseUrl` from `@endora-commerce/platform/kernel` as a
    // value, which is the ruling's whole mechanism — the module resolves the origin itself.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 1853 recorded against the tree before it: 1847. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 1853 -> 1896.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 1896,
    // count moves with the file count here because the reaches that went are exactly
    // the files that went.
    // **T119a: sites 1870 -> 1861.** The same nine files, each the single relative
    // specifier its shim held; `ledger-size` falls 41 -> 32 in the same merge request.
    // The third source is T060's floor: every module package whose manifest
    // declares the host package must have contributed a host reach to this walk.
    // The manifest is rendered from the bare specifiers the package's sources
    // import (`manifests:generate`), so the two derivations are independent and
    // a walk that stopped reading those specifiers makes them disagree in the
    // same run. It appears only while a module package declares the host, which
    // is every tree since !910 — `expected: 0` is itself a refusal.
    //
    // The fourth is feature 115's, and it is derived from the ledger rather than
    // from a count: `expected` is the still-on-disk files
    // `RELATIVE_HOST_REACHES` names — 79 of them since Phase 6, one file having
    // reached two platform files until the generated artefacts stopped — and
    // `covered` is what the application walk opened of them. It disappears entirely when that ledger empties, which is what R4.2
    // expects, and `expected: 0` is a refusal rather than a silent floor of
    // nothing.
    sources: ['manifest-index', 'platform-barrels', 'host-dependents', 'host-reaches'],
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
    // **T118c, `mfaActorBridge`: +4 sites, +1 file.** The four `lazyPort<T>` resolutions
    // `mfa` now writes; the two cradle reads beside them are contributed names rather than
    // ports, so this walk does not count them.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1793 -> 1796.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 105: 1891 -> 1890.** `packages/contracts/src/cms-pages.ts`, whose
    // last reader went with the storefront's `path`-addressed CMS fetch. `sites`
    // is unmoved: it declared no port, no registration and no `lazyPort`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1890 -> 1942.** 52 module
    // packages gain a `vitest.config.ts`.
    // **`specs/115-lifecycle-container-move/` Phase 2: 1942 -> 1943.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1943 -> 1945 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 1945 -> 1946 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 1945 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): -1 file.** The error-code routing
    // derivation left `packages/modules/_i18n/src/backend/services/` for the
    // platform's `kernel/i18n/`, so this walk — whose population is the module
    // tree — reads one file fewer. Nothing else about the module tree moved.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 1946 -> 1952 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1952 -> 2014.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2014
    // -> 2027 (+13).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files and `taxes`'
    // `vitest.config.ts`; it reads `.ts` and not `*.test.ts`.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2027 -> 2039.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118b: files 2039 -> 2040 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2040
    // -> 2041 and sites 722 -> 723. The same one file and the same one `lazyPort`
    // resolution, counted here as a port site.
    // **T118c, `returnsBridge`: 723 -> 728 sites, 2041 -> 2042 files.** The five
    // `lazyPort` resolutions `returns` took over from its bridge, and the one new module
    // source.
    // **D-223: files 2043 -> 2044 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2044 -> 2046, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2046 -> 2047, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own. `sites` moves by the same three resolutions, all of
    // them over published container names typed on a contract or kernel port.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2048 -> 2049. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). The two `sites` are the two `lazyPort<T>`
    // calls and not the three cradle reads, which are contributed names rather than
    // ports.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2050 -> 2097.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2098,
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 692 -> 721.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** sites 732 -> 736, one new published port and three net
    // resolutions: `CmsBlockReadPort` declared in `packages/contracts/src/cms.ts`, and
    // `megamenu`'s five `lazyPort` reads against the two the drain deletes. Measured with the
    // two module sources withheld, which isolated the contract half at +1.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** sites 736 -> 742, the four `lazyPort`
    // resolutions the drain adds (`objectStoragePort`, `inventoryAvailabilityPort`,
    // `catalogCategoryReadPort`, `assetReadPort`) plus the two `providePort` registrations
    // that gained a type argument. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, because no job
    // has placed them when these checks run.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 739 -> 745. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 747 -> 788.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 788,
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
    // **85 -> 84 and 93 -> 92 (D-202)**: the first move in the other direction.
    // `@endora-commerce/api-client` is deleted, so the workspace has one member
    // fewer — the population is `2 + members` and the finer one is the patterns
    // and members the ignore list is matched over, so both fall by exactly one.
    // The base reads 85/93, the recorded values exactly.
    //
    // **92 -> 105 (feature 104): `sites` only, and `files` deliberately not.**
    // The population is still `2 + members` — the same 84 manifests are opened
    // — but three of them are now public, and a public versionable member is
    // four more decisions: may it be public, is it complete, what does its
    // `access` resolve to, and can the registry serve its scope. Plus one for
    // the scope agreement across the set, which is a decision about the set
    // rather than about a member. 92 + 3x4 + 1, measured, not computed from a
    // delta.
    //
    // **106 -> 110 (feature 104, the CLI published): `sites` only again, and
    // for the same arithmetic.** `@endora-commerce/cli` becomes the fourth
    // public versionable member, so the same 85 manifests are opened and four
    // more decisions are taken inside them. The scope-agreement decision was
    // already counted — it is one per *set*, not one per member — so this is
    // 106 + 4 exactly, measured.
    //
    // **110 -> 410 (the owner's publication ruling of 2026-09-05): `sites`
    // only, and this is the largest single move this entry will ever make.**
    // The same 85 manifests are opened, and the whole of the change is in how
    // many decisions are taken inside them. Two things happened at once. Every
    // one of the 75 private packages became public, and a public versionable
    // member was already four decisions; and the publication decision itself
    // stopped being one of those four, because "does this package publish" is
    // now asked of **every** versionable member rather than only of the public
    // ones. So it is `2 + 85 members + 1 ignore pattern + 4 linked + 2 settings
    // + 79 publication decisions + 79 x 3 fitness decisions + 1 scope
    // agreement`, measured rather than computed from a delta.
    //
    // It is far outside the band and is meant to be: the band ratchets
    // blindness, and this is the population quadrupling in one merge request
    // because the estate went from four publishable packages to seventy-nine.
    // The next one moves it by four per member, which is ordinary drift again.
    //
    // **410 -> 489 (the owner's licensing ruling of 2026-09-06): `sites` only,
    // and it is the "four per member" the note above predicted.** The same 85
    // manifests are opened and a public versionable member is now a fourth
    // fitness decision — is this package licensed, and, for the one licence
    // form that names a file, is that file there. 410 + 79, measured, not
    // computed from a delta. `files` deliberately does not move: the licence
    // **file** is opened only for a `SEE LICENSE IN` licence, of which this
    // estate has none, so the count follows the tree rather than the ruling and
    // moves on the day a paid package arrives.
    //
    // **`specs/110-instance-repository/` T120: `files` 85 -> 86, `sites` 489 ->
    // 495.** One more manifest — `@endora-commerce/admin-shell` — and the six
    // fitness decisions a public versionable member is now asked, which is the
    // "four per member" two notes up, at its post-ruling width.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 86 -> 87.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 87 -> 89.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    files: 89,
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 495 -> 501.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: sites 501 -> 513.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    sites: 513,
    // **Feature 114 Phase 3 (FR-017, D-225): a second author, and neither count
    // moves.** `changeset-subjects` is the distinct package names the changeset
    // files name, reconciled against the members the workspace globs produce.
    // `files` and `sites` stay at 89 and 513 — measured before and after, the
    // recorded values exactly — because the changeset population is exactly
    // what !966 took out of both, and a token is not a walk.
    //
    // It is **conditional**, which is the only thing about it that is not
    // ordinary: it is omitted when no changeset names a subject. After a
    // release `.changeset/` holds `config.json` and `README.md`, and
    // `read-size.ts` refuses `expected=0` as `no-expectation` — so a token
    // printed `0/0` would exit 2 on every post-release tree, which is a refusal
    // about the calendar rather than about the tree. This record therefore
    // describes a tree with pending changesets, which is every tree except the
    // one immediately after a release.
    //
    // That exception is stated here rather than discovered: `sources` is
    // matched exactly, so the branch that consumes every changeset — the
    // release, and nothing else — drops this token and re-records this one line
    // with it. Written down because the alternative is worse in both
    // directions: a token printed `0/0` exits 2 on that same tree, and a
    // `sources` entry that could be declared optional would make an *absent*
    // reconciliation indistinguishable from one somebody stopped computing,
    // which is the whole thing this ledger is for.
    //
    // **The release of 2026-09-11 is that tree, and this is the re-record the
    // paragraph above predicted.** `release/version-0.8.0` consumed all 85
    // remaining changesets, so `.changeset/` holds `config.json` and
    // `README.md`, no changeset names a subject, and the token is omitted
    // rather than printed `0/0`. `files` and `sites` are untouched at 89 and
    // 513 — measured on the release branch, the recorded values exactly,
    // which is the point of !966 having taken the changesets out of both.
    // The next branch to write a changeset restores the token and this line
    // with it.
    //
    // **`specs/110-instance-repository/` T138 is that branch, and this is the
    // re-record the paragraph above predicted in the other direction.** It
    // carries one changeset naming three subjects, so `changeset-subjects` is
    // printed again and the token is back. `files` and `sites` are untouched at
    // 89 and 513 — !966 took the changesets out of both, which is exactly why a
    // branch adding one moves this line and neither of those.
    sources: ['changeset-subjects', 'workspace-globs'],
  },
  'backend/scripts/check-rsc-discipline.ts': {
    prefix: '[rsc-discipline]',
    run: { kind: 'tsx', path: 'scripts/check-rsc-discipline.ts', args: [] },
    // Every `.tsx` file the walk **opens**, across the storefront application
    // and the two workspace packages it composes — not the 120 that declare
    // `'use client'`, and deliberately not the 36 candidates. A number that
    // moves with the findings cannot answer "did you read the tree".
    // **Feature 096, Phase 6: +1.** The storefront degradation test, which is
    // in the storefront walk; its `sites` do not move, the file classifying no
    // `useEffect` of its own.
    // **Feature 105 (a CMS page has one address): 333 -> 332.** The storefront
    // route file `app/cms/[...slug]/page.tsx` goes: the CMS page is served at
    // `/{slug}` and `/cms/{path}` is a permanent redirect in `next.config.js`,
    // which is configuration and not a `.tsx`. `sites` is unmoved — that file
    // is a Server Component and classified no `useEffect`.
    // **The service-unavailable notice: 332 -> 334.** Two `.tsx` files — the
    // notice's `page.tsx` and its test. `sites` is unmoved and that is the
    // point of this page: it is a Server Component that fetches nothing, so it
    // classifies no `useEffect` and could not be a candidate if it tried.
    files: 334,
    // The `useEffect` callbacks classified inside those client components, and
    // this is the number that matters. #237's shape for this check is a syntax
    // walk that stops recognising an effect while the file count stands still:
    // `files=332` prints exactly the same beside `findings=0` over a tree the
    // predicate can no longer see. `vacuousReason`'s `nothing-classified` is
    // the floor at zero; this band is what catches the partial case.
    // **2026-09-04: 86 -> 90.** Four client components gained a first-paint fetch
    // as features 105 and 108 landed; five `.tsx` files were added over the same
    // range. `files` did not move, which is the #235/#237 pair this entry records:
    // the site count is the one that carries the signal here.
    sites: 90,
    // `storefront-deps` is `storefront/package.json`'s own dependency list —
    // the `@endora-commerce/*` workspace members declaring `react` — against
    // how many of them contributed a file to the walk. It is #215's predicate
    // for this population: `cms-components` holds 43 of the 120 client
    // components and all five known instances of the defect, so a walk that
    // stopped reaching it would leave `files` at 289 and every finding
    // unreported.
    sources: ['storefront-deps'],
  },
  'backend/scripts/check-shared-table-wipes.ts': {
    prefix: '[shared-table-wipes]',
    run: { kind: 'tsx', path: 'scripts/check-shared-table-wipes.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — the new `mfa` integration test. It empties no
    // table.
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 14 (feature 091, Phase 4): +1 file.** The backend test tree gains
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // the server half of the batch's off-state proof.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 2: +1 file.**
    // the one new backend test file; `sites` is unmoved, because it empties no
    // table.
    // Measured rather than reasoned about: this branch's added files were
    // moved aside and each check re-run, so the figure below is this merge
    // request's own contribution and nobody else's. The entries this branch
    // moved *jointly* with `master` are left for their owners.
    // **Feature 103 (overlay file shadowing retired): 1750 -> 1748.** Fifteen test
    // and fixture files go — four `test/overlay` suites whose subject is gone and
    // five fixture trees — and three arrive with the id-collision red proof.
    // Recording the observed value absorbs **+10** left by earlier merges (this
    // branch's base, 36174efa1, observed 1760 against a recorded 1750).
    // **F7: +1**, `test/unit/acceptance/storefront-scaffold-assertions.test.ts`.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 1752 -> 1556.** 196
    // harness-free single-owner test files leave `backend/test/`.
    // **Feature 110 Phase 1: 1559 -> 1561.** The two test files this branch adds under
    // `backend/test/`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 1561 -> 1565.**
    // Four test files — the demo plan, the demo runner, the host command and
    // the manifest declaration.
    // **1565 -> 1566 (this branch, +1): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 1 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 1565.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 1566 -> 1569.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The two-regime guard
    // and its analysis helper, `test/unit/db/instance-migration-order.test.ts` and
    // `test/helpers/instance-migration-order.ts`.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1571 -> 1572 (+1).** One file,
    // `packages/platform/src/lifecycle/manifest-registry.test.ts`: the moved derivation's proof,
    // driven over three suppliers it builds, at the package specifier an instance
    // would write.
    // **`specs/117-instance-bring-up/` Phases 1-2: +2 files.** The two tests this feature adds under
    // `backend/test` — `unit/scripts/check-env-inputs.test.ts`, the new check's
    // companion, and `unit/packages/platform-env-subpath.test.ts`, which is what
    // holds the platform's `./env` subpath open now that the check reads the
    // declaration's source text rather than its build output.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file.** The ratchet the phase
    // leaves behind, `test/unit/kernel/composition-module-value-imports.test.ts`:
    // the production composition root names no module package as a value import.
    // The two `_i18n` error-code tests moved to `test/unit/kernel/` in the same
    // merge request and cancel, being a move rather than an addition.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/110-instance-repository/` Phase 3 (T123): 1575 -> 1576 (+1).** Same
    // population and the same one file as `check-fixture-substitution`:
    // `test/unit/packages/tailwind-sources.test.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1576 -> 1617.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **-23 is
    // this branch's test move** — this walk's population is `backend/test/**`, which those
    // 23 files left.
    // **`specs/110-instance-repository/` T114a: +2 files.** The two `.ts` files
    // under `backend/test/` the task adds — `unit/overlay/deployment-root-supplier.test.ts`
    // and the `divergence.ts` of the source-tree deployment fixture. Its other two
    // fixtures are committed JavaScript, deliberately (issue #130: what is under test
    // is the file name the loader resolves), and this walk reads `.ts`.
    // **1 576 -> 1 577** with T129b's companion test, which is one more file under `backend/test/`.
    // **+2, re-measured on the chained union.** The same `backend/test/**` population and the same two files as the two entries above.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The same `backend/test/**` population as the two entries above.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 1620 -> 1621.** one file:
    // `test/integration/demo/demo-parity.test.ts`, the demo parity comparison.
    // **`specs/110-instance-repository/` T118: +1 file.**
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, which holds the two
    // sides of the contribution split disjoint and their union at 61. It is the only
    // file this task adds under a test root.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 1621 -> 1623 (+2).**
    // The two `backend/test/**` files this phase adds: the companion test and its
    // fixture builder.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 1622 here — so this branch's own contribution is +2. The same `backend/test/**` population as the two entries above.
    // **`fix/admin-image-root-scripts`: files 1624 -> 1626.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files are under `backend/test/`; neither empties a table.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1626
    // -> 1627. One file, the new contract test; this walk's population is
    // `backend/test/**`.
    // **T119a: 1626 -> 1576.** the fifty unit test files T119a moved out of
    // `backend/test/unit/` and into `packages/platform/src`, beside the sources they
    // cover.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 1576 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 1626 -> 1628.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, this walk opens `backend/test/**`, so it takes the two new test files under `backend/test/unit/ci/` and nothing else the branch adds.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 1628 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — the new integration test. It wipes nothing.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 1578 -> 1580. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **D-223: files 1581 -> 1583 (+2).** The two integration tests it adds,
    // `backend/test/integration/invoices/logo-asset-bytes.test.ts` and
    // `.../product_feeds/image-urls-are-absolute.test.ts`.
    // **T11A (`specs/110-instance-repository/`): files 1583 -> 1585.** T11A's two files.
    // Neither deletes a row, so `files deleting rows` does not move.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1583 -> 1584, the one file the branch adds under
    // `backend/test`, `test/integration/megamenu/cross-module-targets.test.ts` — the composed
    // proof for the three bridge members no test in the tree read before it.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 1584 recorded before it: 1586. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the one file the branch adds under `backend/test/` —
    // `integration/pwa/cross-module-wiring.test.ts`, the half of the proof that can see
    // the wiring.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +1 file** — `backend/test/integration/invoices/cross-
    // module-wiring.test.ts`.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 1588 recorded against the tree before it: 1590. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 1587 -> 1589.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 1589 -> 1592.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1590 -> 1620.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 1620 -> 1622.** Neither side's
    // recorded value describes this tree: this branch's 1620 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 1592 was measured
    // without feature 119's two module packages. The +2 is the two files the master side adds
    // under `backend/test/`, which is this walk's whole population; measured by parking all
    // four of that side's additions, which reads 1620 exactly. Quality-job shape — the ignored
    // copies under `docs/docs/modules/` swept first. Measured on the combined tree, never
    // summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 1592 -> 1593.** The same one test file, on the same `backend/test/**` population.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 1622 -> 1623.** Neither side's recorded value describes this tree: the
    // branch's 1622 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 1622 exactly, so the whole delta is the same one test file, on the
    // same `backend/test/**` population. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the two
    // sides' deltas.
    files: 1625,
    sites: 163,
    sources: [],
  },
  'backend/scripts/check-storefront-indexability.ts': {
    prefix: '[storefront-indexability]',
    run: { kind: 'tsx', path: 'scripts/check-storefront-indexability.ts', args: [] },
    // Every file the check **opens**: the 56 `page.tsx` files under
    // `storefront/app`, the eight `seo.ts` declarations beside the indexable
    // ones, and `storefront/app/sitemap.ts` itself. It is deliberately not the
    // 56 — a route losing its structured-data declaration moves this number and
    // leaves `sites` where it was, which is one of the findings.
    // **Feature 105 (a CMS page has one address): 67 -> 65.** `app/cms/[...slug]/`
    // goes with its `seo.ts`, so the walk loses one `page.tsx` and one
    // declaration; `/cms/{path}` is a permanent redirect in `next.config.js`,
    // which this walk does not read.
    // **Feature 108 (the status line tells the truth): 65 -> 66.** The walk
    // gains the `loading.tsx` / `template.tsx` files, which is what the eighth
    // finding is decided against, and this branch deletes two of the three it
    // found. Both halves moved and the net is +1, which is the number worth
    // recording rather than either: 65 -> 68 with the boundaries this tree had,
    // then 68 -> 66 as `app/loading.tsx` and `app/(catalog)/p/[slug]/loading.tsx`
    // go. `app/(catalog)/catalog/loading.tsx` stays, because `/catalog` decides
    // no status, and it is the one boundary file this number now counts.
    // **The service-unavailable notice: 67 -> 68.** One `page.tsx`, and one
    // only: the notice is `noindex`, so it declares no `seo.ts` for the walk to
    // open beside it. The pair moving by one each — see `sites` — is what says
    // a page arrived rather than a declaration.
    files: 68,
    // Routes classified either way: 8 indexable + 48 `noindex`. It moves only
    // when a page is added or removed, so a run whose `sites` fell while `files`
    // held is a route file that left the tree rather than a declaration that
    // left a route.
    // **Feature 105: 57 -> 56.** One `page.tsx`, and the pair is the point —
    // `files` fell by two and `sites` by one, which is a route file and its
    // declaration leaving together rather than either alone.
    // **The service-unavailable notice: 56 -> 57.** The `noindex` count goes
    // 48 -> 49 and the indexable eight do not move: a page nobody may index is
    // still a page this check classifies, and silence would have been a finding.
    sites: 57,
    // `sitemap` is `storefront/app/sitemap.ts`'s own declared route set — the
    // five static URLs plus the three dynamic patterns — against how many of
    // them the route walk could match to a page file. It is #215's predicate for
    // this population: a *partially* moved `storefront/app` leaves the rest
    // readable and clean, and this is the only number that notices. Measured
    // with everything but `(catalog)` moved aside: `files=9`, `sitemap:4/9`,
    // exit 2.
    //
    // Feature 108's two refusals are deliberately **not** a third coverage
    // token. `unenumerable-segment` is not a short walk — it is a walk that
    // says so itself, from a directory `readdir` refused — and `nothing-decided`
    // is a floor on a population no second author in this repository enumerates:
    // "how many pages decide a status" is what this walk computes, and a token
    // reconciling it against itself would say the same thing twice.
    sources: ['sitemap'],
  },
  'backend/scripts/check-subscribe-seam.ts': {
    prefix: '[subscribe-seam]',
    run: { kind: 'tsx', path: 'scripts/check-subscribe-seam.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It subscribes to
    // nothing and constructs no worker.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It subscribes to
    // nothing and builds no worker.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // It subscribes to nothing and constructs no worker. Quality-job shape: the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It subscribes to nothing and constructs no
    // worker.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-test-ownership.ts': {
    prefix: '[test-ownership]',
    run: { kind: 'tsx', path: 'scripts/check-test-ownership.ts', args: [] },
    // **T118c, `mfaActorBridge`: +2 files** — the co-located `mfa` package test and the new
    // `backend/test/integration/mfa` file, which is the half that needs a composed server.
    // Every `.test.ts` the walk opened, across **both** roots — 1428 under
    // `backend/test` and 211 in the module packages. The union is the population
    // and each addend is floored separately inside the check, because a batch
    // that moves a file from the first root to the second leaves this number
    // exactly where it was.
    // **1639 -> 1640**: the branch's own companion test is a `.test.ts` under
    // `backend/test`, so this check counts it. Recorded after the fact rather
    // than predicted, which is the only way this number is ever right.
    // **Feature 110 Phase 1: 1641 -> 1643.** The two test files this branch adds under
    // `backend/test/`, both `.test.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 1643 -> 1647.**
    // Four test files — the demo plan, the demo runner, the host command and
    // the manifest declaration.
    // **1647 -> 1648 (this branch, +1): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 1 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 1647.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 1648 -> 1649.** One, not
    // three: this walk's population is test files, and the two new files under
    // `backend/test/helpers/` are helpers.
    // **`specs/110-instance-repository/` Phase 4a: +1 file.** The two-regime guard,
    // `test/unit/db/instance-migration-order.test.ts`; its analysis helper is not a
    // `*.test.ts` and is not in this population.
    // **Stacked on the CI-gate branch: +1.** That branch adds the gate-coverage
    // test and its two analysis helpers — one of the three is a test file, which is all this walk takes.
    // **`specs/115-lifecycle-container-move/` Phase 3: 1650 -> 1651 (+1).** One file,
    // `packages/platform/src/lifecycle/manifest-registry.test.ts`: the moved derivation's proof,
    // driven over three suppliers it builds, at the package specifier an instance
    // would write.
    // **`specs/117-instance-bring-up/` Phases 1-2: +2 files.** The two tests this feature adds under
    // `backend/test` — `unit/scripts/check-env-inputs.test.ts`, the new check's
    // companion, and `unit/packages/platform-env-subpath.test.ts`, which is what
    // holds the platform's `./env` subpath open now that the check reads the
    // declaration's source text rather than its build output.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): files +1, sites -3.** The file is
    // the FR-030 ratchet under `test/unit/kernel/`. The three sites are three
    // ledger entries this branch retired rather than three tests: the routing
    // derivation stopped being `_i18n`'s, so `error-code-collision.test.ts`,
    // `error-code-routing-equality.test.ts` and `check-inventory.test.ts` name
    // that module no longer and their `_i18n` shard entries went stale — which is
    // this check's own two-way rule, met in the merge request that moved them.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/110-instance-repository/` Phase 3 (T123): 1654 -> 1655 (+1).** One
    // file under `backend/test`: `test/unit/packages/tailwind-sources.test.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 1655 -> 1715.** This entry
    // could not be measured before this commit: the check exited 2 (`covered 56 of the 57
    // unit(s)`) and printed no read line, because `pim_akeneo` declared a test run and
    // shipped no test file. Moving its 23 harness-free tests into the package is what
    // restored the disclosure, so both numbers are first records rather than drift.
    // **`specs/110-instance-repository/` T114a: +1 file.** This walk's union takes
    // one of the two `.ts` files the task adds under `backend/test/` — the new unit
    // test — and not the deployment fixture's `divergence.ts`, which is a fixture and
    // owns no subject.
    // **1 655 -> 1 656** with T129b's companion test, which is one more file under `backend/test/`.
    // **+1, re-measured on the chained union.** This walk opens `*.test.ts` only, and gains T114a's new unit test from the base.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This walk opens `*.test.ts` only, and takes the module's own test files.
    // **`fix/search-reindex-task-timeout`: files 1717 -> 1718.** The same one new co-located test file - a test, which is this walk's whole subject.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 1718 -> 1719.** one file:
    // `test/integration/demo/demo-parity.test.ts`, the demo parity comparison.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 1719
    // -> 1723 (+4).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the four co-located demo tests, which is the whole
    // of what this walk sees of the branch.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 1723 -> 1727, sites 1103 -> 1109.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.**
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, which holds the two
    // sides of the contribution split disjoint and their union at 61. It is the only
    // file this task adds under a test root.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 1727 here, so this branch's own contribution is +1. The new unit test; this walk opens `*.test.ts` only, so the platform source is outside it.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 1727 -> 1728 (+1).**
    // One file — `test/unit/scripts/check-demo-data-budget.test.ts`. The fixture
    // builder beside it is a helper and not a test.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 1728 here — so this branch's own contribution is +1. This walk opens `*.test.ts` only, so it takes the companion test and not the fixture helper beside it — which is what makes it differ by one from its three neighbours.
    // **`fix/admin-image-root-scripts`: files 1729 -> 1730.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. One, not two: this population is `.test.ts` files, and `test/helpers/dockerfile.ts` is not one.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 1730
    // -> 1732 (+2). One file into each half — the co-located unit test into `packages=`,
    // the contract test into `application=`, which is the split this check prints
    // (`application=1487 packages=245`). The contract test is the repository's by
    // derivation and not by placement: it calls `setupBackendServer`, so `composesServer`
    // is true (`specs/106-module-owned-tests/` §1).
    // **T119a: 1730 -> 1685.** Two movements that do not cancel: the fifty unit test files
    // T119a moved out of `backend/test/unit/` and into `packages/platform/src`, beside the
    // sources they cover (-50), and five of them land in
    // `packages/platform/src/lifecycle`, which is `_lifecycle`'s module directory, so this
    // check counts them on the package side (+5).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 1685 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 1730 -> 1732.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, this population is `*.test.ts` files, and both of the branch's new test files are ones — which is why it moves by two here and not by one, unlike the last branch to touch this row.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 1732 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 site, 1687 -> 1689 files.** The co-located unit test in
    // the module package and the integration test that stays in `backend/test/` — the split
    // this drain's proof is deliberately in two halves for.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 1689 -> 1691. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **D-223: files 1693 -> 1697 (+4).** The four test files it adds — two co-located in
    // `assets_library` (`public-url-base.test.ts`, `services/assets-library-url.test.ts`)
    // and two under `backend/test/integration/` (`invoices/logo-asset-bytes.test.ts`,
    // `product_feeds/image-urls-are-absolute.test.ts`).
    // **T11A (`specs/110-instance-repository/`): files 1697 -> 1698.** One, not two:
    // this population is the test files, and `test/helpers/host-residue.ts` is a helper.
    // `sites` does not move — the new test owns no module's subject.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 1697 -> 1700, the branch's three new test files.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 1700 recorded before it: 1701. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 1701 -> 1704, the three co-located tests
    // the branch adds. Quality-job shape: the ignored copies `composer:generate` places
    // under `docs/docs/modules/` swept first, because no job has placed them when these
    // checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's three new test files: the two co-located beside their
    // subjects in `packages/modules/pwa`, and
    // `backend/test/integration/pwa/cross-module-wiring.test.ts`, which is
    // harness-using and so owes this check's ledger nothing.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 1704 -> 1707. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +2 files** — the co-located test and the backend
    // integration test, which is what this check exists to tell apart.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 1709 recorded against the tree before it: 1711. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 1707 -> 1708.**
    // **+1 and not +2**: this check's population is test files, so only `unit/harness/setup-file-imports.test.ts` is in it — `harness-tenant-scope.ts` is a harness module, not a test, and is judged by the ownership rule nowhere.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 1708 -> 1712.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 1711 -> 1750.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 1750 -> 1751.** Neither side's
    // recorded value describes this tree: this branch's 1750 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 1712 was measured
    // without feature 119's two module packages. **+1 and not +3**, for the reason master's
    // block above gives and which holds for the third file as well: this check's population is
    // test files, so only `backend/test/unit/harness/setup-file-imports.test.ts` is in it.
    // `harness-tenant-scope.ts` is a harness module rather than a test, and parking
    // `packages/cli/test/new-instance/template-reconciliation.test.ts` on its own leaves 1751
    // — it is outside this walk. `sites` does not move and is not re-recorded. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 1712 -> 1713.** The same one test file.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 1751 -> 1752.** Neither side's recorded value describes this tree: the
    // branch's 1751 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 1751 exactly, so the whole delta is the same one test file.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 1755,
    // Owner **attributions**, not classified files, and the difference is the
    // reason both numbers are printed. A per-file `sites` would move with
    // `files` and say the same thing twice; attributions move independently in
    // both directions that matter — a batch moving a file into its package
    // removes the specifiers that named it, and an owner resolver that stopped
    // matching either spelling collapses this to zero while `files` is untouched
    // (issue #237's shape).
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 1088 -> 1181.** This entry
    // could not be measured before this commit: the check exited 2 (`covered 56 of the 57
    // unit(s)`) and printed no read line, because `pim_akeneo` declared a test run and
    // shipped no test file. Moving its 23 harness-free tests into the package is what
    // restored the disclosure, so both numbers are first records rather than drift.
    // **`chore/094-close-remaining-reds`: sites 1181 -> 1104 (-77).** The same 81-site
    // conversion as `check-singleton-identity`'s entry above, seen by a walk with a
    // narrower population: this one opens `*.test.ts` alone, so the 4 reaches in
    // `test/perf/pim_akeneo/`'s two `.perf.ts` files are outside it and 77 of the 81
    // land here. `test/helpers/package-entities.ts` is outside it too — measured, by
    // reverting the helper alone, which leaves the number at 1104 — so the eleven
    // specifiers it gains add nothing back. `files` is untouched at 1715: no test file
    // arrived or left.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The module's co-located tests and the declared run that owns them.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** sites 1110 -> 1111, one: the two co-located tests are already in
    // their packages and are classified by position, so only
    // `test/integration/megamenu/cross-module-targets.test.ts` becomes a site. It is
    // server-bound and multi-owner, so it stays under `backend/test` and needs no ledger
    // entry.
    sites: 1112,
    // Two independent authors. `manifest-index` is issue #215's shared floor
    // over the module walk, whose unit is the module's own directory rather than
    // a test file — 14 of the 70 packages ship no test and a floor over test
    // files would refuse every clean run. `package-test-scripts` is the
    // packages' own manifests answering "which packages have tests", against the
    // packages this walk found one in: a package that declares a `test` script
    // and ships nothing the walk can see is a run that cannot be told from a
    // walk that lost that package, which is exit 2 rather than a finding.
    sources: ['manifest-index', 'package-test-scripts'],
    //
    // **1088 -> 1087.** D-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. One fewer
    // file under `backend/test` is one fewer ownership site, and the ledger shrank
    // with it (182 -> 181) — `pim_pimcore`'s shard was the one carrying this file,
    // under a generic `scheduled` reason that never said why it was harder than
    // its five neighbours.
  },
  'backend/scripts/check-transaction-context.ts': {
    prefix: '[transaction-context]',
    run: { kind: 'tsx', path: 'scripts/check-transaction-context.ts', args: [] },
    // **T118c, `mfaActorBridge`: +1 file** — `mfa`'s new module source. It writes no SQL.
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 14 (feature 091, Phase 4): +3 files.** The three `.ts` files the
    // batch adds under a module package's `src/admin/` —
    // `customers`' and `organizations`' contribution entries and
    // `sales_channels`' admin API client. The other eighteen files it moves are
    // `.tsx` and this walk reads `.ts` only, which is why a batch that moved
    // twenty-one files moves this number by three.
    // **Batch 15 (feature 091, Phase 4): 1913 -> 1916.** Three, and the three are
    // the whole of what this walk sees of a twenty-seven-file move: it reads
    // `.ts` and not `.tsx`, and `catalog`' and `orders`' admin layers landed in
    // their packages as twenty-four `.tsx` screens plus
    // `catalog/src/admin/index.ts`, `catalog/src/admin/lib/resolve-product-selection.ts`
    // and `orders/src/admin/lib/paymentStatus.ts`.
    // **Feature 103 (overlay file shadowing retired): 2008 -> 2007.** One file, net:
    // `overlay/conflict-policy.ts` and `overlay/errors.ts` go with the shadowing
    // machinery, `packages/claimed-module-ids.ts` arrives with the module-id
    // collision rule.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 2007 -> 2059.** 52 module
    // packages gain a `vitest.config.ts`.
    // **Feature 113 Phase 0 (`specs/113-module-owned-demo-data/`): 2060 -> 2068.**
    // Eight source files: `backend/src/cli/demo-command.ts`, the
    // `backend/src/demo/` re-export shim, and the platform's new six-file
    // `src/demo/` layer — the guard and the scope reason relocated out of
    // `backend/src/seeds/` (spec §7), plus the plan, the runner, the report
    // and the barrel, which are new.
    // **`specs/110-instance-repository/` Phase 4a: +2 files.** The platform package's
    // new `src/migrations/` — the published baseline list and its barrel — which this
    // walk reads because its population is the source roots, the platform's among
    // them.
    // **`specs/115-lifecycle-container-move/` Phase 2: 2070 -> 2071.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 2071 -> 2073 (+2).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`:
    // `manifest-registry.ts`, which is the derivation itself, and
    // `services/module-id-claims.ts`, which moved with it because the collision
    // assembly is part of the merge and a platform file may not name an application
    // one. `backend/src` does not move at all — the binding and the claims
    // re-export both keep their paths, which is the whole shape of the phase.
    // **`specs/115-lifecycle-container-move/` Phase 4: 2073 -> 2074 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 2073 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +1 file.** `packages/platform/src/env/index.ts`, the
    // environment-input declaration FR-001 gives the platform. It is under the
    // platform source root, which this walk covers, and it is the only file this
    // feature adds there.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +1 file, net.** Two arrive and one
    // goes: `packages/platform/src/kernel/i18n/error-translation.ts` (the routing
    // derivation, moved out of `_i18n` because it had no consumer inside it) and
    // `backend/src/kernel/i18n/error-translation.ts` (its re-export shim), against
    // `packages/modules/_i18n/src/backend/services/error-translation.ts`, deleted.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 2076 -> 2082 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **Feature 115 Phase 6: 2082 -> 2079.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 2079 -> 2141.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. This branch's test
    // move is net zero here — measured at the commit before it, which read the same number.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 2079 -> 2070.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 2141 -> 2131.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (2132), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 2079 -> 2086 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T114a: +1 file.**
    // `packages/platform/src/overlay/deployment-roots.ts` — the four functions
    // `overlay-roots.ts` used to compute, each taking the deployment root as a
    // parameter. It is the only source file the task adds under a root this walk
    // reads; the two application files it edits move no count. Measured by parking
    // this branch's five new files and re-running.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The 61 backend sources the module adds to this walk's population.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 2145 -> 2146.** three source
    // files arrive — `src/seeds/demo-composition.ts` (the five composition steps),
    // `src/seeds/demo-host-residue.ts` (the corpus Phase 2 drains) and
    // `src/demo/composition-loader.ts` — against the two `src/seeds/` re-export shims T215
    // deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 2148
    // -> 2162 (+14).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the twelve non-test module files,
    // `demo-relocated-reference.ts` and `taxes`' `vitest.config.ts`.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 2163 -> 2174.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +1 file.** `packages/platform/src/composition/compose-app.ts` — the assembly `composeApp` used to
    // perform inside `backend/src/composition.ts`, moved whole. The application file keeps
    // its path and its export, so the move itself nets to nothing across the two source
    // roots this walk reads and the +1 is the new platform file alone.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 2174 here, so this branch's own contribution is +1. The one new platform source, `packages/platform/src/composition/compose-app.ts`; the application file keeps its path and its export, so the move itself nets to nothing across the two roots.
    // **Feature 113's T226: files 2175 -> 2172 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 2172 -> 2173 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 2175 -> 2176 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 2176 -> 2174. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 2174 -> 2147 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 2147
    // -> 2148. One file, the module source this task extracts,
    // `packages/modules/cms/src/backend/services/asset-embed-resolver.ts`.
    // **T119a: 2147 -> 2138.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`).
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 2138 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 file** — `returns`' new module source. It opens no
    // transaction.
    // **`specs/110-instance-repository/` T119b: files 2139 -> 2128 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 2128 -> 2129. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 2130 rather than the
    // 2141 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 2130 -> 2124 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 2130 -> 2131 (+1).** The module source it adds,
    // `packages/modules/assets_library/src/backend/services/storage/public-url-base.ts`.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 2131 recorded against the tree before it: 2125. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 2125 -> 2127, the two module sources the branch adds —
    // `packages/modules/cms/src/backend/services/cms-block-read-port.ts` and
    // `packages/modules/megamenu/src/backend/services/cross-module-ports.ts`. This walk reads
    // a module's non-test `.ts`, so the branch's three new test files and its changeset are in
    // no population of its own.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 2127 -> 2128, the one new module source.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the two module sources the branch adds —
    // `packages/modules/pwa/src/backend/services/cross-module-context.ts` and
    // `.../request-actor.ts`. This walk reads a module's non-test `.ts`, so the two
    // co-located tests beside them, the backend integration test and the changeset are
    // in no population of its own.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 2129 -> 2130. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **T118c, `invoicesBridge`: +1 file** — `invoices`' new module source
    // (`services/cross-module-context.ts`). It opens no transaction and writes no SQL.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 2131 -> 2176.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    files: 2178,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-singleton-identity.ts': {
    prefix: '[singleton-identity]',
    run: { kind: 'tsx', path: 'scripts/check-singleton-identity.ts', args: [] },
    // **T118c, `mfaActorBridge`: +3 files** — `mfa`'s new module source, its co-located test
    // and the new backend integration test. None reaches a package's sources by path.
    // The consumer population, not the module one: every file under the
    // application member (`src`, `test` and `scripts` alike), the platform's
    // sources and every module package's. The test tree is in it because that is
    // where 176 of the 181 files holding a reach live, and leaving it out would
    // have made the check blind to both defects it exists for.
    // **Batch 13 (feature 091, Phase 4): +25.** The twenty-four moved screens,
    // plus the batch's backend off-state test.
    // **Batch 14 (feature 091, Phase 4): +21 files.** The whole moved set —
    // eighteen screens, two contribution entries and one admin API client —
    // arriving under `packages/modules/*/src/admin/`, which is this walk's
    // population and was not the admin application's.
    // **Batch 15: 3879 -> 3904.** The twenty-four net module-package sources
    // above, plus the batch's own backend integration test.
    // **Feature `specs/098-storefront-ssr-seo-a11y-suite/` Phase 2: +2 files.**
    // the new check script and its companion test, both under `backend/`.
    // Measured rather than reasoned about: this branch's added files were
    // moved aside and each check re-run, so the figure below is this merge
    // request's own contribution and nobody else's. The entries this branch
    // moved *jointly* with `master` are left for their owners.
    // **Feature 103 (overlay file shadowing retired): 4152 -> 4171.** This change's
    // own contribution is **-13** over the whole-tree walk: two `src/overlay`
    // files and fifteen overlay test and fixture files go, four arrive. Recording
    // the observed value absorbs **+32** from earlier merges (this branch's base,
    // 36174efa1, observed 4184).
    // **F7: +3.** `backend/` plus each package: `packages/cli/src/new-storefront/`'s
    // three sources. The two acceptance scripts are under `backend/scripts`, which
    // this walk does not read.
    // **Feature 098 Phase 4 (the storefront conformance job): 4180 -> 4181.**
    // The nine files that job is made of — six under
    // `storefront/test/conformance/`, `storefront/playwright.conformance.config.ts`,
    // `backend/scripts/conformance/seed-storefront-fixtures.ts` and
    // `scripts/conformance-storefront.sh` — intersected with this walk's
    // population.
    // One of the nine: `backend/scripts/conformance/seed-storefront-fixtures.ts`.
    // The storefront is outside this walk by construction — its conjunct 1
    // (a file whose closure also loads a package's published artefact) is
    // false there.
    // **Feature 106 (`specs/106-module-owned-tests/`): sites 1103 -> 852, files 4181 ->
    // 4233.** `sites` falls by 251 because a test that reached
    // `packages/modules/<id>/src` from `backend/test` was a cross-package value reach
    // and the same test inside that package is not — the population this check exists
    // to judge genuinely shrank. `files` rises by the 52 new configurations.
    // **Feature 110 Phase 1: 4297 -> 4299.** Two of the three TypeScript files this
    // branch adds; the third is under `backend/test/unit/scripts/`, outside this walk.
    // **Feature 109, Phase 1c, follow-up: +1.** One file, for the same
    // reason `check-diacritic-folds` moves by one: the package source counts and
    // the `backend/scripts` shim does not.
    // `check-port-dependencies` follows a delegating root to its composer now,
    // so the derivation lives in `@endora-commerce/cli/lib/delegated-composer.ts`
    // with a re-export shim beside the other shared analyses.
    // **Stacked on 113 Phase 0: +12.** That branch adds thirteen files —
    // the demo-data declaration, its runner and their tests, twelve of them
    // TypeScript and one a changeset. This walk takes the twelve TypeScript sources.
    // **4312 -> 4315 (this branch, +3): the pack gate's own files.** It
    // ships `backend/scripts/pack-gate.ts`, `backend/scripts/lib/pack-assert.ts`
    // and `backend/test/unit/ci/pack-gate.test.ts`, and this walk opens
    // 3 of them. Measured by taking the three out of the tree and
    // re-running: without them this check reads 4312.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 4315 -> 4318.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +4 files.** The platform package's
    // new `src/migrations/` (the published baseline list and its barrel) plus the
    // two-regime guard and its helper under `backend/test`.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/115-lifecycle-container-move/` Phase 2: 4322 -> 4323.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **`specs/115-lifecycle-container-move/` Phase 3: 4323 -> 4326 (+3).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`
    // — `manifest-registry.ts` and the relocated `services/module-id-claims.ts` —
    // plus `packages/platform/src/lifecycle/manifest-registry.test.ts`. `backend/src` does not
    // move: the binding and the claims re-export both keep their paths.
    // **`specs/115-lifecycle-container-move/` Phase 4: 4326 -> 4327 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 4326 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +4 files.** The files this feature adds under the
    // module-package and platform walk this check reads. None is a composed
    // singleton reach: the declaration is data, and the resolution modules are
    // the CLI's, which is not a module package.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +2 files.** The whole-tree walk's
    // view of the branch's net inventory — the platform derivation, its shim and
    // the FR-030 ratchet in, the `_i18n` source out.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 4333 -> 4339 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` Phase 3 (T123): 4339 -> 4341 (+2).** The
    // branch's two TypeScript files — `scripts/lib/tailwind-sources.ts` and its
    // test. Neither reaches a module package's source, so `sites` does not move.

    // **Feature 115 Phase 6: 4341 -> 4338, re-measured on the union.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 4338 -> 4473.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is
    // this branch's test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`,
    // the shard it opens for the two files that stay.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 4338 -> 4329.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`chore/094-retire-error-table` (over !1508): 4473 -> 4463.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **-9** was already standing at
    // `094-akeneo-pim-sync`'s tip (4464), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 4338 -> 4345 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. This walk opens the module tree and the backend tests together, so it takes both the package and the 42 new test files.
    // **`specs/110-instance-repository/` T114a: +3 files.** All three `.ts` files the
    // task adds: `packages/platform/src/overlay/deployment-roots.ts` and the two under
    // `backend/test/` (the unit test and the source-tree deployment fixture's
    // `divergence.ts`). This walk is the widest of the `.ts` ones and reads every root
    // the other three split between them.
    // **+1, re-measured on the chained union.** The new platform source; the fixtures sit outside this walk and the changeset is not a source file.
    // **4 329 -> 4 334** with T129b's five new `.ts` files — four under `backend/scripts` and the companion test, all of which this consumer walk opens.
    // **+7, re-measured on the union after rebasing onto `ad0fe0876`.** The seven platform
    // sources T113 and T114 added to `packages/platform/src/` while this branch was open. The
    // branch's own +5 is unchanged; this is a fresh census of the combined tree, not a sum.
    // **+4, re-measured on the chained union.** This branch adds four sources this walk opens — the check, its library, its two ledgers — and T114a's platform source arrives on the base.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This walk opens the module tree and the backend tests together, so it takes both.
    // **`fix/search-reindex-task-timeout`: files 4479 -> 4480.** The same one new co-located test file.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** The
    // ORM configuration, the migration ordering, the two merges and the
    // bootstrap became `@endora-commerce/platform/db` — eight files under
    // `packages/platform/src/db/` — while `backend/src/db/` kept four bindings
    // and the `migrate.ts` entry point and lost `migration-order.ts` and
    // `pluralizing-naming-strategy.ts` outright. Eight in, two out, and the
    // twelve core migrations moved between two roots this walk reads, so they
    // net to nothing here.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+1, master's.** The search test file, which this walk opens with the rest of the module tree.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // `cli/module-commands.ts` moved out of `backend/src/` and into
    // `packages/platform/src/`, and a re-export shim took its old path — so the
    // move itself nets to nothing across the two roots this walk reads, and the
    // +2 is the platform's new `cli/index.ts` barrel plus the shim. Measured by
    // parking this branch's three new files and re-running: every recorded value
    // below came back exactly.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 4486 -> 4488.** four files
    // arrive — `src/seeds/demo-composition.ts`, `src/seeds/demo-host-residue.ts`,
    // `src/demo/composition-loader.ts` and `test/integration/demo/demo-parity.test.ts` —
    // against the two `src/seeds/` re-export shims T215 deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. The same two files.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 4490
    // -> 4508 (+18).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the seventeen `.ts` files plus `taxes`' new
    // `vitest.config.ts`; the five changesets are markdown.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. The one new platform source.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 4509 -> 4524.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +2 files.** The two sources the task adds —
    // `packages/platform/src/composition/compose-app.ts`, the assembly moved out of
    // `backend/src/composition.ts`, and
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, its contribution-split
    // ledger. The application file keeps its path, so the move nets to nothing.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 4524 here, so this branch's own contribution is +2. The new platform source and the new unit test, both inside this walk.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 4524 -> 4528 (+4).**
    // The four `.ts` files this phase adds; its population is the workspace's
    // sources, changesets excluded.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 4526 here — so this branch's own contribution is +4. The four new `.ts` sources.
    // **Feature 113's T226: files 4530 -> 4527 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 4527 -> 4528 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 4530 -> 4531 (+1).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 4531 -> 4529. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 4529 -> 4502 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`fix/admin-image-root-scripts`: files 4530 -> 4532.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files sit under the application member, whose `test` tree is in this walk.
    // **Re-measured on the union after rebasing onto `7b70edf22`.** Feature 110's T118b
    // landed on `master` between this branch's base and the rebase, adding two sources
    // this walk reads, so the recorded value describes neither tree on its own: 4532 -> 4531.
    // Measured on the combined tree — a read size is a measurement of what the run walks,
    // never a sum of the two sides' deltas.
    // **Re-measured on the union after rebasing onto T119.** That task deleted the
    // twenty-seven re-export shims this walk was reading, so every entry here moves by the
    // same −27 and this one lands at 4504 rather than the 4531 recorded against a tree that
    // still held them. The two files this branch adds were already in the recorded value;
    // measured on the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 4504
    // -> 4507 (+3). The three `.ts` files: the module source, its test and the contract
    // test. `sites` does not move — the unit test reaches its subject with a relative
    // `./asset-embed-resolver.js` inside its own package, which is not a cross-package
    // value reach.
    // **T119a: 4504 -> 4495.** the nine re-export shims `specs/110-instance-repository/`
    // T119a deleted from `backend/src`
    // (`http/interceptors/{dispatch,registry,route-table,validation}.ts`,
    // `kernel/i18n/request-language.ts`, `kernel/lifecycle/unique-module-ids.ts`,
    // `kernel/logging.ts`, `kernel/request-scope-hook.ts` and
    // `kernel/sales-channels/sales-channels-cache.ts`). The fifty moved test files do not
    // appear here in either direction: this walk skips `*.test.ts`, so they were invisible
    // where they were and are invisible where they went.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 4495 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 4504 -> 4508.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, the walk covers the application member's `src`, `scripts` and `test` trees, so it takes the two new `backend/scripts/*.ts` sources and the two new tests: four.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 4508 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: +1 site, 4498 -> 4501 files.** The files are the three new
    // sources; the site is the new module source's value reach. Nothing composed is reached
    // by filesystem path.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 4501 -> 4505. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 4502 -> 4491 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 4491 -> 4494. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 4497 rather than the
    // 4508 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 4497 -> 4491 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 4497 -> 4502 (+5).** The five `.ts` files it adds:
    // `public-url-base.ts`, its two co-located tests and the two integration tests.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 4502 recorded against the tree before it: 4496. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **T11A (`specs/110-instance-repository/`): files 4496 -> 4498.** T11A's two files.
    // Neither reaches a module package's source, so the site count does not move.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 4496 -> 4501, all five of the branch's new `.ts` files —
    // the two module sources, their two co-located tests and the backend integration test.
    // This walk is the widest of the module family and reads tests on both sides of the
    // package boundary; only the changeset is outside it.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 4501 recorded before it: 4503. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 4503 -> 4507, all four new `.ts` files.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's five new TypeScript files — two `pwa` module sources,
    // their two co-located tests, and
    // `backend/test/integration/pwa/cross-module-wiring.test.ts`.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 4508 -> 4512. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +3 files** — the two new `invoices` module files and
    // the backend integration test. The one `site` is the backend test's value reach
    // into a module package's sources, which is what this check classifies.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 4515 recorded against the tree before it: 4517. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 4512 -> 4514.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 4514 -> 4519.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 4517 -> 4611.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 4611 -> 4613.** Neither side's
    // recorded value describes this tree: this branch's 4611 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 4519 was measured
    // without feature 119's two module packages. The +2 is the two files the master side adds
    // under `backend/test/`; parking all four reads 4611, and parking the `packages/cli` test
    // on its own leaves 4613, so that file is outside this walk. `sites` stays at 869 and is
    // not re-recorded: none of the three arriving TypeScript files reaches a module package's
    // source by filesystem path, which is what this check counts sites over. Quality-job shape
    // — the ignored copies under `docs/docs/modules/` swept first. Measured on the combined
    // tree, never summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 4519 -> 4522.** Three: the criterion, its judgement and its unit test — `layout.sourceRoots` is the whole application tree, `backend/test/**` included, and it reads no JSON.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 4613 -> 4616.** Neither side's recorded value describes this tree: the
    // branch's 4613 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Attributed by parking and re-measuring rather than by subtraction: with the five files the
    // master side adds withdrawn and its edit to `test/unit/release/changeset-flow.test.ts`
    // reverted, this walk reads 4613 exactly, so the whole delta is the criterion, its judgement
    // and its unit test — `layout.sourceRoots` is the whole application tree, `backend/test/**`
    // included, and it reads no JSON. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed from the two
    // sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 4624 -> 4625 (+1).** The same one file as `check-platform-surface` above, for the same reason. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 4625,
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
    // **`chore/094-akeneo-adapt` (!1496, over !1495): sites 852 -> 949.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. Of that, **-28 is this branch's
    // test move**, and the direction is the point: a test beside its subject names that
    // subject **relatively within its own package**, which is not a value reach into a
    // package's source and is not a site. The 23 files stopped being 28 of them by moving.
    // **`chore/094-close-remaining-reds`: sites 949 -> 868 (-81).** The whole of the
    // move is this branch's, measured rather than inferred: with the 33 converted
    // files reverted and every other change on the branch in place, the walk reports
    // 949 again. `pim_akeneo`'s integration, contract and perf tests named 81 entity
    // classes by filesystem path into a package's `src` — the reach this check exists
    // to refuse — and each now names it through `test/helpers/package-entities.ts`,
    // which resolves it out of the composed `entities` array. A helper import is no
    // reach, so 81 sites go and none arrives.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. The value reaches into a package's source that the module's tests make.
    sites: 869,
    sources: ['manifest-index', 'entities-registry', 'tenant-chains'],
    //
    // **852 -> 851 sites, 4336 -> 4337 files, and the two have different causes.**
    // The site went because d-218 moved `pim_pimcore`'s
    // `hmac-canonical-vectors.test.ts` and its `.json` vectors out of
    // `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. Its import
    // of `packages/modules/pim_pimcore/src/backend/services/push-signature.js` was
    // a value reach into a package's source — this check's own subject — and
    // inside the package it is `./push-signature.js`, which is no reach at all.
    // The file arrived because d-217 added
    // `backend/test/helpers/interactive-run.ts`, the launcher
    // `uninstall-hard-needs-force.integration.test.ts` spawns to prove `--hard`
    // refuses at a terminal too.
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
    // **Batch 13 (feature 091, Phase 4): -1.** Twenty-four admin screens move into
    // four module packages, which this walk already covered on both sides, and
    // the `FulfilmentStrategyPicker` shim is deleted.
    // **Batch 14 (feature 091, Phase 4): -1 file.** Twenty-three admin files
    // leave `admin/src` (eighteen moved, five deleted) and twenty-one arrive
    // under `packages/modules/*/src/admin/`, plus the batch's own admin test.
    // **Batch 15 (feature 091, Phase 4): 420 -> 417.** The same net three as
    // every other walk over the admin surface — four re-export shims deleted,
    // one `catalog/src/admin/index.ts` added. That it is **three** and not
    // twenty-seven is the load-bearing half: this scanner follows a module's
    // admin sources into its package, so the batch did not take twenty-seven
    // screens out of the hard-coded-string population by moving them.
    // **Batch 16 onwards (feature 091, Phase 4): 417 -> 422.** Not re-recorded by
    // the batches that moved it — every one of them stayed inside the -10%/+50%
    // band, which is what the band is for and also what it cannot say. Recorded
    // here by the merge request that added the `module-admin` token below,
    // because that is the run whose `[read-size drift]` block named it.
    // **Feature 105: 422 -> 421.** `admin/src/modules/cms_pages/CmsPagesPage.tsx`
    // goes with the pre-014 CMS page projection it was typed against. It carried
    // no baseline entry — every string in it was already translated — so nothing
    // in `HARDCODED_STRINGS_BASELINE` is stranded by the deletion.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 421 -> 429.** The `pim_akeneo`
    // module package arriving, plus `master` at 5c7a4d82a. This branch's test move is net
    // zero here — measured at the commit before it, which read the same number.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 429 -> 436.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **`specs/110-instance-repository/` T138 (the admin member): files +1.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.

    files: 437,
    sites: null,
    // `admin-ui` is the workspace manifests' own answer to "how many packages
    // ship a tree of admin UI", reconciled against how many of them the walk
    // actually opened a file in (feature 091, P5c). It replaced a by-name
    // refusal — "no member is `@endora-commerce/admin-kit`" — with a floor that
    // covers the second such package too, which is what P5b creates. It reads
    // `2/2` on this tree, and adding the token moved `files` by nothing: the
    // kit was already a root, under its name.
    //
    // `module-admin` is the third family's floor, and it is the one this walk
    // had none of: 55 module packages' `src/admin` layers are 357 of the 422
    // files, they enter the population as a directory listing, and a count
    // derived from that same listing corroborates nothing. It is the generated
    // admin contribution registry's answer — `check:admin-zones`' and
    // `check:admin-surface`' too, through the one shared derivation in
    // `scripts/lib/module-admin-layers.ts`. Adding it moved `files` by nothing
    // and `sources` by one token; measured red by taking one layer off disk,
    // where it reads `module-admin:54/55` and exits 2.
    sources: ['admin-ui', 'module-admin'],
  },
  'scripts/check-naming.sh': {
    prefix: '[naming]',
    run: { kind: 'bash', path: 'scripts/check-naming.sh', args: [] },
    // **T118c, `mfaActorBridge`: +4 files** — the three new source files and the merge
    // request's own changeset, measured on the *staged* tree for the reason the header
    // gives. Recorded at 8195 first, which was this branch before it had written its
    // changeset: the file this walk opens like any other.
    // **Batch 13 (feature 091, Phase 4): +2.** Whole-tree arithmetic: twenty-four
    // files move into the module packages, twenty-four leave `admin/src`, the
    // `FulfilmentStrategyPicker` shim there is deleted with its last reader, the
    // batch adds two off-state test files, and it adds its changeset — which
    // this walk opens like any other file, and which is the one number a batch
    // is apt to record before writing it.
    // **Batch 14 (feature 091, Phase 4): +2 files.** The whole-tree walk gains
    // the batch's two new test files, its two new `tsconfig.ui.json`s and its
    // changeset, and loses the five residue files
    // `admin/src/modules/sales_channels/` held — four `export {}` barrels and
    // the `DefaultChannelBadge` copy P7a could not delete. Net two.
    // **Batch 15: 7050 -> 7051.** The same one file, over the same whole-tree
    // population — see the sibling entry above.
    // **Feature 101, Phase 1: +17.** `endora check`'s frame and the five
    // relocated analyses: seven files under `packages/cli/src/check/`, five
    // under `src/rules/`, `src/checks.ts`, and four under `packages/cli/test/`.
    // The five `backend/scripts/check-*.ts` hosts stayed where they are —
    // `check-inventory.test.ts`'s `script` field must resolve to a file in this
    // tree — so the whole-tree walks gained the package's copy and lost nothing.
    // **+1 more** for the merge request's own changeset file: this check and
    // `check:nul-bytes` walk `.changeset/`, `check:language` does not.
    // **+4 more** from the ten merge requests this branch rebased onto.
    // **Feature 101, Phase 2: +11.** The same thirteen files as
    // `check:nul-bytes` above, less the two shims — this walk is `git`'s and an
    // **Feature 101, Phase 2: +15**, the same fifteen files `check:nul-bytes`
    // counts above. **Not measured by parking**: this walk is `git ls-files
    // --cached --others`, so once the files are committed, moving them on disk
    // leaves them in `--cached` and the parked run reads the same number — a
    // trap worth naming, because it reports a delta of zero rather than
    // failing. Measured instead against a detached worktree of `origin/master`,
    // which reads 7395 to this branch's 7410. Recording the observed value
    // absorbs **+35** from merge requests that have already landed.
    // **Feature 103 (overlay file shadowing retired): 7410 -> 7448.** This change's
    // own contribution is **-13** over the whole-tree walk: two `src/overlay`
    // files and fifteen overlay test and fixture files go, four arrive. Recording
    // the observed value absorbs **+51** from earlier merges (this branch's base,
    // 36174efa1, observed 7461).
    // **F7: +8.** The whole-repository walk gains the command's three sources and
    // its test, the acceptance criterion's two sources and its test, and the
    // recorded expectation. Measured against a detached baseline, for the reason
    // `check:language`'s entry gives.
    // **Feature 098 Phase 4 (the storefront conformance job): 7530 -> 7543.**
    // The nine files that job is made of — six under
    // `storefront/test/conformance/`, `storefront/playwright.conformance.config.ts`,
    // `backend/scripts/conformance/seed-storefront-fixtures.ts` and
    // `scripts/conformance-storefront.sh` — intersected with this walk's
    // population.
    // Nine of the thirteen are this branch's; the other four were already
    // standing on `master` (measured 7534 there, in a detached worktree of
    // `origin/master`, before this branch was rebased onto it). The recorded
    // number is what this tree reads, not the old record plus a delta.
    // **Rebased onto feature 104: 7543 -> 7545.** Not this branch's nine — the two
    // `.changeset/*.md` files `feat/104-publication` brought with it, which this
    // whole-tree walk sees and the source-comment walks do not. Re-measured on
    // the rebased tree rather than added to the number above it.
    // **Feature 098 Phase 5 (the storefront performance budget): 7545 -> 7551.**
    // Two of the six are this branch's two new shell files, measured by moving
    // both out of the tree and re-running, which read 7549; the other four were
    // already standing on `master`. What is recorded is what this tree reads.
    // **Rebased onto `master` at a9deb1cfd: 7551 -> 7555.** Not this branch's
    // two — the four `specs/106-module-owned-tests/*.md` files that merge
    // brought with it. Re-measured on the rebased tree.
    // **Feature 105: 7555 -> 7559.** Net **-3** from this branch — four source
    // files deleted and one changeset `.md` added — over a **+7** this entry
    // already owed `master`, which reads 7562 at bf869a18a. Measured in a
    // second worktree at this branch's own base commit rather than subtracted
    // from the number above it.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 7559 -> 7617.** 52 module
    // packages gain a `vitest.config.ts`; the 196 moves are net zero. The remaining +6
    // is inherited drift, on the same terms as `check-nul-bytes` above.
    // **Feature 104 §§ 1.5–1.6: files 7617 -> 7619.** Two of the four are this
    // branch's — `npmrc.ts` and its changeset, this walk reading `.md` where
    // `check:language`'s does not — and two arrived on `master`. Parking the
    // two reads 7619, and parking is sound here because both files are
    // untracked: `--cached` answers from the index, so the caveat recorded
    // above bites on a file that has already been committed and not on one that
    // has never been.
    // **2026-09-05: +14, and no branch that moved it could have known.** A nine-way
    // merge landed `specs/109-backend-test-kit/` (5 files), `specs/110-instance-repository/`
    // (5) and `specs/111-shared-fixture-package-naming/` (4). All fourteen arrived in two
    // **documentation-only** merge requests, which re-recorded nothing -- correctly, from
    // their authors' point of view: a branch that adds only markdown has no reason to
    // suspect it moves a read size, and neither of them touched a check. But three walks
    // in this estate count markdown, so a docs-only merge request silently drifts them.
    // That is the gap the drift report exists to fill and the one case where nobody is at
    // fault for not filling it in advance; it is caught on the merged tree instead.
    // **2026-09-05: +2, two markdown files from a documentation-only merge.** The F11
    // re-plan landed `specs/110-instance-repository/`'s draft rows and a register entry;
    // three walks here count markdown and no branch that added it had reason to look.
    // Fourth occurrence of this class in two days -- it is now the ordinary way this
    // file goes stale, and the drift census on the merged tree is the only place it
    // shows.
    // **2026-09-05, feature 104 (the CLI published): +1.** One changeset file.
    // The count therefore falls again when a release consumes it, which is the
    // oscillation `check-release-intent`'s own entry stopped tracking by taking
    // the changesets out of its population — these two walks cannot do that,
    // being whole-tree walks whose subject is every file in the repository.
    // **2026-09-05: +6, and this is the fifth time in two days.** Six markdown files
    // from `specs/113-module-owned-demo-data/` and the D-209..D-211 rulings. The
    // mechanism is settled and is not a defect: a documentation-only merge request
    // moves three whole-tree walks, its author has no reason to look, and the drift
    // census on the merged tree is the only place it surfaces. That is the census
    // working, not failing -- the band tolerates it, `master` stays green, and the
    // correction is one small merge request per batch. Recorded here so the sixth
    // reader does not go looking for a cause.
    // **Feature 110 Phase 1: +9.** The same nine files `check-nul-bytes` counts —
    // three TypeScript sources, the five of the `mod-instance-surfaces` fixture
    // package and the changeset markdown. Re-measured after the rebase.
    // **Feature 109, Phase 1c: +1.** One file, and it is the whole delta: the
    // branch's changeset, `.changeset/test-kit-scoped-plugins-and-decoration-order.md`.
    // Both walks count markdown, so a merge request that adds one adds a file to
    // each of them; the three source files it edits were already in the walk.
    // Re-measured after rebasing onto the merges that landed while the branch was
    // open, not carried over from the pre-rebase figure.
    // **Feature 109, Phase 1c, follow-up: +3.** The same three files
    // `check-nul-bytes` counts, this walk having the same whole-repository subject.
    // `check-port-dependencies` follows a delegating root to its composer now,
    // so the derivation lives in `@endora-commerce/cli/lib/delegated-composer.ts`
    // with a re-export shim beside the other shared analyses.
    // **Stacked on 113 Phase 0: +13.** That branch adds thirteen files —
    // the demo-data declaration, its runner and their tests, twelve of them
    // TypeScript and one a changeset. This walk takes all thirteen.
    // **`specs/114-release-shape-gate/` landed: +5.** The release-shape gate's
    // design added five files — four markdown and one `.mjs` contract. This walk
    // takes all five, this walk being the whole tree.
    // **7775 -> 7782 (not this branch's, and recorded here because the drift
    // report named it).** Measured with this branch's three new files taken out
    // of the tree: the walk still reads 7782, so every one of these 7
    // arrived with the five merges this branch was rebased onto and the record
    // was already stale on `master`. Re-recorded rather than left drifting,
    // because a census that cannot reach `0 drifted` stops being read.
    // **7782 -> 7783 (+1): this branch's own changeset file.** Both of these are
    // whole-repository walks, and `.changeset/*.md` is in the repository. It is
    // the ordinary per-changeset move this file already warns about one entry
    // over, arriving in the two walks that count every file rather than in the
    // one whose population is the changesets.
    // **`specs/115-lifecycle-container-move/`'s design landed on `master`: +4.**
    // !1450 added four markdown files — the plan, the research and the two
    // contracts. This walk takes all four, its subject
    // being the whole tree. Re-derived on this branch's own
    // tree rather than carried over; the guard this merge request adds creates no
    // file, so the whole of the +4 is that merge's.
    // **And +1 for this merge request's own changeset**, which the guard it lands
    // does not create but the release gate does: a change to a package under
    // `packages/` carries one, and this walk's subject is the whole tree.
    // **Stacked on the publication branch: +4.** The pack gate, its judgement
    // library, its test and its changeset — this walk is the whole repository.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 7784 -> 7787.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +5 files.** The platform package's
    // new `src/migrations/` plus the two-regime guard and its helper, and the branch's
    // own changeset — this walk reads every file in the checkout to decide which are
    // module folders, and `.changeset/*.md` is one of them.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/110-instance-repository/`'s two contracts landed on `master`: +2.**
    // !1456 added `contracts/instance-migration-order.md` and
    // `contracts/instance-tree.md` and re-recorded nothing. None of it is this
    // branch's, which edits three existing files and creates none, so the record
    // was already stale on `master`. Unlike `check-nul-bytes` above, this walk is
    // tracked source rather than every file on disk, so a worktree's own
    // `backend/.env` does not move it — measured both ways, 7794 either way.
    // **And +1 for this merge request's own changeset.** This walk reads every
    // file in the checkout to decide which are module folders, and `.changeset/*.md`
    // is one of them; `check-doc-snippets` above does not move, its population being
    // `docs/docs` and `specs` rather than the tree.
    // **7784 -> 7785 (+1): the licence-and-peers branch's own changeset file**,
    // the same one file the entry above takes. This walk does **not** take
    // `backend/.env`, which is why the two whole-tree numbers moved by different
    // amounts on the run that produced them and only one of them needed the
    // local file taken out before it could be recorded.
    // **Nine files from `master` plus this branch's changeset: +10**, the same
    // nine the neighbouring whole-repository walk takes.
    // **+7 from `master`**, the same six specification files and one changeset the
    // neighbouring whole-repository walk takes.
    // **+4: two files from this branch, two already on `master`.** Same two root
    // licence files; this walk and `check-nul-bytes` disagree on the residue
    // because their declared exclusions differ, not because the tree does.
    // **+8**, the same eight the neighbouring whole-repository walk takes.
    // **`specs/104-package-publication/`'s registry auth repair: +1.** This branch
    // adds one file, `packages/cli/test/npmrc-auth-effect.test.ts` — the install
    // that measures the generated `.npmrc`'s effect rather than its text. This
    // walk is `git`'s listing of the whole checkout, so it takes a test file like
    // any other.
    // **`specs/115-lifecycle-container-move/` Phase 2: 7804 -> 7805.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **+2 for this branch**, the same barrel and changeset the neighbouring
    // whole-repository walk takes.
    // **+1 for this branch** — its changeset, the only file it adds. This walk is
    // the whole repository; `check:language` does not move, a changeset being
    // neither a source file nor a `docs/docs` page.
    // **`specs/115-lifecycle-container-move/` Phase 3: 7808 -> 7812 (+4).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`
    // — `manifest-registry.ts` and the relocated `services/module-id-claims.ts` —
    // plus `packages/platform/src/lifecycle/manifest-registry.test.ts` and this branch's own
    // changeset, which this walk takes because its population is the whole
    // repository. `backend/src` does not move: the binding and the claims
    // re-export both keep their paths.
    // **The service-unavailable notice: 7808 -> 7812.** The same four source
    // files the neighbouring whole-repository walk takes.
    // **+4 for this branch**, the same four files the neighbouring whole-repository
    // walk takes.
    // **The licence-tier deletion: 7816 -> 7817 (+1)**, the branch's own changeset,
    // the same one file the neighbouring whole-repository walk takes.
    // **+6 from `master`.** `specs/117-instance-bring-up/` landed with six files —
    // spec, plan, research and three contracts — and re-recorded nothing. All six
    // are documents under a declared root, so this walk and the two
    // whole-repository ones move by the same amount.
    // **+4 for this branch.** `specs/118-instance-member-selection/` — spec, plan,
    // research and one contract. All four are documents under a declared root, so
    // the document walk and the two whole-repository walks move by the same four.
    // **The storefront environment refusal adds nothing here**, and it is the one
    // number on this branch that does *not* track its `check-nul-bytes` neighbour
    // file for file: this walk excludes `storefront/`, so it sees none of the four
    // new files while the whole-repository walk sees all of them. Measured by
    // parking them — 7827 either way.
    // **7823 -> 7827 (+4), still none of it this branch's**, and the four are worth
    // a line because of *how* they were found. The `+6 from master` note above was
    // measured against a base this branch was then rebased past, which is the
    // failure the header's own lesson names: a re-recorded value is a measurement
    // of a branch against a base, so a rebase invalidates it without touching a
    // line anyone wrote. The census caught it on the rebased tree, and parking this
    // branch's four files left the number where it is. Its `check-nul-bytes` twin
    // did not move, so the four are outside the whole-repository walk and inside
    // this one — the reverse of the asymmetry recorded immediately above.
    // **+4 for this branch**, the same four files the neighbouring whole-repository
    // walk takes.
    // **`specs/115-lifecycle-container-move/` Phase 4: 7831 -> 7832 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 7831 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +15 files.** Every file this feature adds, this
    // walk's population being the whole checkout: the contract shape and its test,
    // the platform's declaration, the storefront's and the admin's, the
    // reconciliation rule with its repository host and its companion, the
    // `./env` subpath test, the four input-resolution modules, and the two tests
    // that prove the resolution and the non-interactive guarantee.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): 7832 -> 7835, of which +2 is this
    // branch and +1 was already stale.** Same listing as `check-language.sh`, so
    // the branch's contribution is the same net two files. The third was stale on
    // `master` before this branch existed and is measured rather than assumed:
    // `git ls-tree -r --name-only origin/master`, put through this script's own
    // exclusion filter, is **7833** lines.
    // The branch's two are the platform derivation, its shim and the FR-030 ratchet
    // in against the `_i18n` source out, plus
    // `.changeset/composition-root-module-value-imports.md`, which
    // `git ls-files --cached --others --exclude-standard` lists like any other file.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`NEXT_PUBLIC_SITE_URL` reaches the deployment path: 7852 -> 7854, of which +1 is
    // this branch and +1 was already stale.** The branch's one is
    // `.changeset/environment-input-address-of.md`, which
    // `git ls-files --cached --others --exclude-standard` lists like any other file; every
    // other edit is to a file that already existed, this repair being four lines in the
    // deployment path and a field on a declaration. The other is measured rather than
    // assumed, in this entry's own idiom: `git ls-tree -r --name-only HEAD | wc -l` is
    // **7854** at `1d906d15a`, against which this walk reads 7853 with the changeset
    // taken out — so `master` had moved by one before the branch existed.
    // **The `addressOf` fixture repair: 7854 -> 7855 (+1), all of it this merge request's
    // own changeset.** Same single file as `check-nul-bytes` one entry over, seen through
    // a different listing: this walk's population is
    // `git ls-files --cached --others --exclude-standard`, which lists a committed
    // changeset like any other file. Parking it on disk therefore measures nothing here,
    // because `--cached` still lists it — so it was measured by taking it out of the index
    // as well, which reads **7854**, the recorded value. Nothing was inherited stale, and
    // `git ls-tree -r --name-only` is 7855 at this branch's base against 7856 at its head:
    // the same +1, from a second listing.
    // **Rebased onto the `addressOf` fixture repair, and the storefront-scaffold criterion
    // stops inheriting its own environment: 7855 -> 7856 (+1).** Both branches moved this
    // entry and each wrote the same intermediate 7855, so the value below is the sum of the
    // two rather than either one's, re-measured after the rebase. The one file is
    // `.changeset/storefront-declared-variables.md`, which
    // `git ls-files --cached --others --exclude-standard` lists like any other; nothing else
    // on this branch adds or removes one. `backend/.env` does not move this walk — git's own
    // list, not a directory tree — measured both ways, 7856 either way.
    // **+2 on `master`, on the same union: 7856 -> 7858.** The same two files
    // `check-nul-bytes` names one entry back — `demo-opt-in.md` and
    // `.changeset/contracts-cli-test-kit-typecheck-programs.md` — the third already being
    // counted. This entry reads git's file list rather than the directory tree, so
    // `backend/.env` moves it in neither direction.
    // **`specs/115-lifecycle-container-move/` Phase 5, rebased: 7858 -> 7865 (+7 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // Both sides of a rebase conflict moved this entry, so the value below is a fresh
    // measurement of the combined tree rather than either side's arithmetic. The seventh
    // file is this branch's changeset, which
    // `git ls-files --cached --others --exclude-standard` lists like any other;
    // `backend/.env` moves this walk in neither direction, git's list not being a
    // directory tree.
    // **`specs/110-instance-repository/` T120: 7858 -> 7865 (+7).** The same seven
    // files `check-nul-bytes` names — the shell package's manifest, its two
    // tsconfigs, its `eslint.config.js`, its barrel, its `src/types/env.d.ts`
    // and this merge request's changeset; the 106 moved ones cancel. git's own
    // list again, so `backend/.env` moves it in neither direction.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **+1: `contracts/admin-stylesheet-composition.md`.** The one document this branch
    // adds; the other five files it changes already existed, and an edit moves no count
    // here. Measured with `backend/.env` absent and no untracked `docs/docs/modules/`
    // copies.
    // **`specs/110-instance-repository/` Phase 3 (T123/T124/T125): 7873 -> 7937
    // (+64).** Every file this branch adds and nothing it edits: 60 packages'
    // own `tailwind.css`, `admin/src/tailwind.generated.css`, the
    // installed-package fixture's, and two TypeScript files. Measured with no
    // untracked `docs/docs/modules/` copies.
    //
    // **+1: the branch's changeset.** Same population and the same reason as
    // `check-nul-bytes` — a changeset is a file this walk opens. `check:language`
    // does **not** move with it: its subject is comments and `/docs/` pages, and a
    // changeset is neither.
    // **Feature 115 Phase 6: 7938 -> 7936, re-measured on the union.** 2 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`. The walk is repository-wide, so the changeset
    // this phase adds offsets one of the three.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 7936 -> 8102.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is
    // this branch's test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`,
    // the shard it opens for the two files that stay.
    //
    // **`specs/110-instance-repository/` Phase 3 (T126/T127): 7938 -> 7942 (+4).**
    // The same four files `check-nul-bytes` gains, for the same reason: both are
    // whole-tree walks with a deny-list filter, so they move together —
    // `packages/admin-shell/theme.css`,
    // `admin/test/unit/shell-theme-override.test.ts`,
    // `admin/test/helpers/compile-instance-stylesheet.mjs` and the changeset.
    // **+4 for this branch, measured on the union after rebasing onto `8bf0da614`.** Four files
    // arrive: the shell's `theme.css`, its changeset, and the admin's override test with its
    // compile helper. The branch first recorded against `79a1befe6`, and Phase 6 has since
    // deleted three re-export shims, so the base moved under it — this value is a fresh census
    // of the combined tree rather than the sum of the two.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 7940 -> 7931.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files. This walk is the whole repository, so it
    // also gains the phase's own changeset file: -9 +1.
    // **`specs/110-instance-repository/` T132/T133: 7940 -> 7947 (+7).** As the byte scan
    // above, and for the same population: `endora new instance`'s four sources, its two
    // test files and the changeset.
    // **+7, re-measured on the union after rebasing onto Phase 7.** This branch adds four
    // sources, two tests and a changeset; `specs/115-lifecycle-container-move/` Phase 7 has
    // since deleted nine lifecycle shims, so every base below is lower than this branch first
    // measured. The delta is unchanged; the total is a fresh census of the combined tree.
    // **`chore/094-retire-error-table` (over !1508): 8102 -> 8104.** Two contributions, measured apart by
    // restoring the deleted file and re-running. **+3** was already standing at
    // `094-akeneo-pim-sync`'s tip (8105), from the two adaptations !1496 and !1508 and the
    // `master` merge that branch carries, and this merge request is simply the one that
    // measured it. **-1** is this branch's own:
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 7940 -> 7947 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **The same merge request: +2 more.** Its two changeset files, which this
    // walk's population includes.
    // **+9, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **+2 on the T115 branch, as the byte scan above and for the same population.**
    // `specs/110-instance-repository/contracts/application-root-supplier.md` came from the
    // T114a design merge on `master`; the second is T115's one empty changeset.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. Repo-wide, and the same population as `check-nul-bytes.ts` above.
    // **+2, re-measured on the union after rebasing onto `b32f37b7d`.** The same two added
    // files as `check-nul-bytes.ts` above; this scan is repo-wide and the two renames cancel.
    // **+2, and only one of them is this branch's** (`specs/113-module-owned-demo-data/`
    // `tasks.md`). The other +1 was already standing on `master` when this branch forked at
    // `ad0fe0876`: a docs-only merge moved this walk and re-recorded nothing, measured by the
    // baseline census run before this file was written (`3 drifted, 39 agree, 0 not measured, of
    // 42 recorded`, +1 on exactly these three entries). !1512 carries the same repair; whichever
    // lands second is a no-op, because the recorded value here is the observed one either way.
    // **+4, re-measured on the union after rebasing onto `chore/d217-d218-impl`.** The same four
    // files as `check-nul-bytes.ts` above: one this branch adds, three the base does.
    // **+1 on the chained base, re-measured.** The same changeset file as `check-nul-bytes.ts`
    // above.
    // **+6: five this branch's and one `master`'s.** The reverted tree reads 7949, so
    // one file landed on `master` unrecorded; the other five are
    // `specs/110-instance-repository/` T114a's five new files. This walk and
    // `check-nul-bytes` are the two whole-repository ones and move together.
    // **+1: this row's own changeset.** The whole-repository walk reads
    // `.changeset/*.md` too, so the file that announces the surface change moves it.
    // **+6, re-measured on the chained union.** The same six files as `check-nul-bytes.ts` above; this scan is repo-wide.
    // **7 939 -> 7 944** with feature 110's D-219 batch: five new `.ts` files and two changesets arrive, two stylesheets go.
    // **+10, re-measured on the union after rebasing onto `ad0fe0876`.** `master`'s ten new
    // files, as recorded for `check-nul-bytes.ts` above; this scan's population is repo-wide.
    // **+12, re-measured on the chained union.** Repo-wide, so the same twelve as `check-nul-bytes.ts` above: five this branch's net, seven the chained base's.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. Repo-wide, and the same population as `check-nul-bytes.ts` above.
    // **`fix/search-reindex-task-timeout`: files 8131 -> 8133.** Two: the new co-located test file and `.changeset/search-indexer-task-wait.md`, this walk being the whole repository like `check-nul-bytes`'.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +7 files.** The six
    // net new sources plus the changeset; this walk reads the whole checkout.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+2, both master's.** Repo-wide, so the same two files as `check-nul-bytes.ts` above.
    // **D-221 (`feat/catalog-new-product-route`): 8133 -> 8135 (+2).** The same two files
    // `check-nul-bytes` names, this walk having the same whole-repository listing.
    // The listing is `git ls-files --cached --others --exclude-standard`, so it is read
    // from the **index**: deleting a tracked file from disk does not move it, and the
    // measurement that attributes it is a diff of the two refs' listings.
    // **+7, two of them this branch's.** Repo-wide, so the same two added files as `check-nul-bytes.ts` above, on the same moved base.
    // **`fix/ordering-guard-follows-the-platform`: 8142 -> 8143 (+1).** The one file
    // `check-nul-bytes` names, this walk having the same whole-repository listing.
    // Attributed against a pristine `origin/master` worktree, which reads 8142 — and
    // *not* by moving the file aside, which leaves this number at 8143 once the file is
    // committed, for the index-versus-disk reason recorded three lines above. That
    // difference between the two checks is what identified the file.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +3 files.**
    // The listing is `git ls-files --cached --others`, so the move is net zero and
    // the three additions are the platform's `cli/index.ts` barrel, the re-export
    // shim at `backend/src/cli/module-commands.ts`, and this row's changeset.
    // Measured against a pristine `origin/master` worktree, which read exactly the
    // recorded value.
    // **+1, the same changeset from the base.** Repo-wide, so it sees the same one file as `check-nul-bytes.ts` above.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 8142 -> 8144.** four files
    // arrive — `src/seeds/demo-composition.ts`, `src/seeds/demo-host-residue.ts`,
    // `src/demo/composition-loader.ts` and `test/integration/demo/demo-parity.test.ts` —
    // against the two `src/seeds/` re-export shims T215 deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. Repo-wide, and decomposed the same way: the base reads 8146, so +2 is the base's and +3 is this branch's net.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 8149
    // -> 8172 (+23).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads every one of them — this walk is the whole
    // repository.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. Repo-wide, and the same two files as `check-nul-bytes.ts` above.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 8174 -> 8196.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +3 files.** The two sources above plus the
    // changeset, because this walk's population is the whole repository rather than a
    // source root.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 8196 here, so this branch's own contribution is +3. Repo-wide, so the same three files as `check-nul-bytes.ts` above.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 8196 -> 8202 (+6).**
    // Six files, the same population as `check:nul-bytes`': four sources and two
    // changesets.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 8199 here — so this branch's own contribution is +6. This branch adds six files: the check, its library, its ledger, its companion test, and two changesets. Repo-wide, so the same six.
    // **Feature 113's T226: files 8205 -> 8202 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 8202 -> 8205 (+3).**
    // This walk is the whole repository, so it reads the one platform source
    // (`packages/platform/src/demo/packages.ts`) and the two changesets this merge
    // request carries.
    // **`specs/110-instance-repository/` T118b: files 8205 -> 8208 (+3).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. This walk reads the whole tree, so it takes a third file: the merge
    // request's own changeset, which is written last, after the numbers have been
    // read, and is the one that is easy to forget. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 8208 -> 8181 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`fix/admin-image-root-scripts`: files 8205 -> 8207.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. The whole tree, and there is no changeset to make it three.
    // **Re-measured on the union after rebasing onto `7b70edf22`.** Feature 110's T118b
    // landed on `master` between this branch's base and the rebase, adding two sources
    // this walk reads, so the recorded value describes neither tree on its own: 8207 -> 8210.
    // Measured on the combined tree — a read size is a measurement of what the run walks,
    // never a sum of the two sides' deltas.
    // **Re-measured on the union after rebasing onto T119.** That task deleted the
    // twenty-seven re-export shims this walk was reading, so every entry here moves by the
    // same −27 and this one lands at 8183 rather than the 8210 recorded against a tree that
    // still held them. The two files this branch adds were already in the recorded value;
    // measured on the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 8183
    // -> 8187 (+4). All four files; a whole-repository walk. **Measured on the staged tree,
    // deliberately**: this listing is `git ls-files --cached --others --exclude-standard`,
    // so a file deleted from the working tree and not yet staged is still counted and an
    // added-then-committed file is counted whether or not it is on disk. The branch's first
    // shape put its test at a path this one abandons, and an unstaged measurement read 8188
    // — one too many, for the deleted file the index still held.
    // **T119a: 8183 -> 8177.** -9 shims, -50 and +50 for the moved test files, +2
    // `vitest.*.ts` and +1 `tsconfig.test.json`.
    // **T119a's changeset: 8177 -> 8178.** The one markdown file this branch adds under
    // `.changeset/`; `check-language.sh` does not move, its own roots not reaching that
    // directory.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 8178 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 8183 -> 8189.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, the whole tree, and there is no changeset to make it seven — a perf tier is not a published package's surface.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 8189 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: 8182 -> 8186.** The three new source files and the merge
    // request's changeset, which this walk opens.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 8186 -> 8192. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 8188 -> 8177 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // Plus **one** for the changeset this merge request carries: this walk reads
    // `.changeset/*.md`, so the file that declares the release lands in the very
    // census that measures it. 8177 -> 8178.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 8178 -> 8182. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 8186 rather than the
    // 8196 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 8186 -> 8180 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **+1 more for the changeset**, which this whole-repository walk reads and the
    // narrower ones do not.
    // **D-223: files 8186 -> 8192 (+6).** The five `.ts` files it adds and one markdown
    // file, the changeset.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 8192 recorded against the tree before it: 8187. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **T11A (`specs/110-instance-repository/`): files 8187 -> 8189.** T11A's two files.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 8187 -> 8193, the same six as `check-nul-bytes`: five `.ts`
    // files and the changeset.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 8193 recorded before it: 8195. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 8195 -> 8200, the four new `.ts` files
    // and this merge request's changeset. Read on the **staged** tree. Quality-job shape:
    // the ignored copies `composer:generate` places under `docs/docs/modules/` swept
    // first, because no job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's five new TypeScript files — two `pwa` module sources,
    // their two co-located tests and one backend integration test — plus the changeset,
    // this walk reading markdown too.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 8201 -> 8206. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +5 files** — the three new `.ts` files and this merge
    // request's two changesets, which this walk opens like any other file. Read on the
    // **staged** tree, for the reason the block above gives.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 8211 recorded against the tree before it: 8213. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 8206 -> 8208.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 8208 -> 8215.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/110-instance-template-symbols` (the scaffolded backend compiles): files 8215 -> 8217.**
    // The two files this branch adds —
    // `packages/cli/test/new-instance/template-reconciliation.test.ts` and its changeset. Rule 1
    // judges names, so both sit in its population; measured on a tree with both moved aside,
    // which read 8215 exactly.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 8213 -> 8345.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 8345 -> 8349.** Neither side's
    // recorded value describes this tree: this branch's 8345 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 8217 was measured
    // without feature 119's two module packages. The +4 is the four files the master side
    // adds, every one of them tracked; Rule 1 judges names, so the changeset sits in this
    // population beside the three sources. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first, and the resolution of this file **staged** before the
    // run: this walk takes its population from `git ls-files --cached --others
    // --exclude-standard`, so it reads the index rather than the disk, and an unmerged path is
    // listed once per conflict stage. Measured on the combined tree, never summed from the two
    // sides' deltas.
    // **T140 (the instance acceptance criterion): files 8217 -> 8221.** Four: the three `.ts` files plus `backend/acceptance/instance-expected-state.json`, this walk being the whole tree.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 8349 -> 8354.** Neither side's recorded value describes this tree: the
    // branch's 8349 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Park-and-re-measure does not reach this check: its population is `git ls-files --cached
    // --others --exclude-standard`, the **index** rather than the disk, so withdrawing a staged
    // file leaves it listed. It is measured after staging the resolution instead — during an
    // unresolved merge a conflicted path is listed once per stage and this walk reads two high.
    // The delta is all five files the master side adds, this walk being the whole tree.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **Feature 114, Phase 1: 8354 -> 8355**, the same one file as the walk above —
    // this branch's empty changeset. The park-and-re-measure caveat three lines up is
    // why it is attributed differently: this population is the **index**, so the file
    // stayed listed after it was taken off disk and the walk read 8355 both ways. It is
    // attributed from the branch's own added-file list instead
    // (`git diff --diff-filter=A origin/master...HEAD` names exactly that one path),
    // which is the index's own answer to the same question.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **Merged with `origin/master` at f788f9af5, and re-measured rather than reconciled.** Feature 114's Phase 1 moved this walk by one — its own empty changeset — and this branch moved it by six, so each side's number describes a tree without the other's files and no arithmetic over the two produces the union. The number below is a fresh measurement on the merged tree, taken in a worktree created from the merge commit and reporting an empty `git status`.
    // **Feature 114, Phase 2 (the history landing): 8355 -> 8225.** The same −130 as the
    // walk above and for the same reason: 214 `.changeset/*.md` deleted, 83
    // `CHANGELOG.md` and one verifier added. This population is the **index**, so it is
    // attributed from the branch's own added and deleted lists rather than by parking —
    // `git diff --diff-filter=A origin/master...HEAD` names the 84 additions and
    // `--diff-filter=D` the 214 deletions, which is the index's own answer to the same
    // question. **Measured** in a fresh worktree in the quality job's shape, with the
    // landing staged; never summed from a delta.
    // **Merged with `origin/master` at f93a38ed6 (!1592, the instance bring-up repairs),
    // and re-measured rather than reconciled: 8231.** The same two sides as the walk above
    // — +6 there, −130 here — and the same reason neither describes the union. Measured on
    // the merged tree **after the resolution was committed**, which this population makes
    // mandatory rather than tidy: it is `git ls-files --cached`, the index, where a
    // conflicted path is listed once per stage and a run taken mid-merge reads high.
    // **Feature 114 Phase 3 (D-225): +1 -> 8232.** This merge request adds exactly one
    // tracked file — the empty changeset that records that neither half of it has any
    // release meaning — and its other fifteen changeset edits are modifications. Measured
    // on both sides in one worktree created from the branch, `quality`-job tree shape, with
    // nothing rebuilt between the two runs: `origin/master` reads 8231, the recorded value
    // exactly, and the branch reads 8232.
    // **`specs/110-instance-repository/` T138 (the admin member): files +7, plus 3 of `master`'s own.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // Three of the ten are `specs/120-…`'s, on `master` at 15b866da3 and re-recorded here for
    // the reason `check-doc-snippets` states: the census reads the tree, not the diff.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 8171 -> 8177 (+6).** The same six files as `check-nul-bytes` above, this walk having the same whole-repository listing. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 8177,
    sites: null,
    sources: ['manifest-index'],
    //
    // **Every number this branch records is a fresh census of the combined tree,
    // never its own delta added to what it first measured.** It was written
    // against `50a56f6ef` and rebased onto `ad0fe0876`, and four merges moved the
    // bases under it in between — so each attribution below was measured by
    // withdrawing this branch's files and re-running, not reasoned from the
    // printed delta. **7948 -> 7951, and this branch's own contribution is −2.**
    // D-218 moved `pim_pimcore`'s `hmac-canonical-vectors.test.ts` and its `.json`
    // vectors out of `backend/test/unit/` and into the package beside their
    // subject, which the asset classifier's new fixture predicate is what made
    // possible. This walk reads `backend/test` and does not count a module
    // package's `src` the same way, so the move is a departure: with the branch
    // withdrawn the tree reads **7953**. The remaining +5 was already in the tree
    // — the recorded 7948 was behind `ad0fe0876` before this branch touched
    // anything.
  },
  'scripts/check-language.sh': {
    prefix: '[language]',
    run: { kind: 'bash', path: 'scripts/check-language.sh', args: [] },
    // **T118c, `mfaActorBridge`: +3 files** — the three new files; all three are `.ts`, so the
    // source half of this walk takes each one. Measured on the *staged* tree.
    // **Batch 13 (feature 091, Phase 4): +1.** Whole-tree arithmetic: twenty-four
    // files move into the module packages, twenty-four leave `admin/src`, the
    // `FulfilmentStrategyPicker` shim there is deleted with its last reader, and
    // the batch adds two off-state test files.
    // **Batch 14 (feature 091, Phase 4): -1 file.** This walk's population is
    // source-code comments and `docs/`, so the batch's two new test files and
    // its changeset are outside it and its two new `tsconfig.ui.json`s are not
    // source. What it sees is the five residue files
    // `admin/src/modules/sales_channels/` held — four `export {}` barrels and
    // the `DefaultChannelBadge` copy P7a could not delete — against the four
    // files the batch adds to a module package's `src/`.
    // **Batch 15: 5262 -> 5261.** The same net one as the fold check above,
    // over the same whole-tree population.
    // **Feature 101, Phase 1: +17.** `endora check`'s frame and the five
    // relocated analyses: seven files under `packages/cli/src/check/`, five
    // under `src/rules/`, `src/checks.ts`, and four under `packages/cli/test/`.
    // The five `backend/scripts/check-*.ts` hosts stayed where they are —
    // `check-inventory.test.ts`'s `script` field must resolve to a file in this
    // tree — so the whole-tree walks gained the package's copy and lost nothing.
    // **+1 more** from the merge requests this branch rebased onto.
    // **Feature 101, Phase 2: +14** — the fifteen files `check:nul-bytes`
    // counts, less the changeset, which this walk does not read. That the
    // arithmetic differs from `check:nul-bytes`' and `check:naming`'s by
    // exactly the one file the comment above already says is excluded is the
    // cross-check. Measured against a detached worktree of `origin/master`
    // rather than by parking, for the `git ls-files --cached` reason
    // `check:naming` states: it reads 5517 to this branch's 5531. Recording the
    // observed value absorbs **+26** from merge requests that have already
    // landed.
    // **Feature 103 (overlay file shadowing retired): 5531 -> 5562.** This change's
    // own contribution is **-13** over the whole-tree walk: two `src/overlay`
    // files and fifteen overlay test and fixture files go, four arrive. Recording
    // the observed value absorbs **+44** from earlier merges (this branch's base,
    // 36174efa1, observed 5575).
    // **F7: +7.** `git ls-files`' population gains eight files; the recorded
    // expectation is JSON and outside this walk. Measured against a detached
    // worktree of `origin/master` rather than parked: `--cached` answers from the
    // index, so a delta taken on the branch alone would have read zero.
    // **Feature 098 Phase 4 (the storefront conformance job): 5646 -> 5655.**
    // The nine files that job is made of — six under
    // `storefront/test/conformance/`, `storefront/playwright.conformance.config.ts`,
    // `backend/scripts/conformance/seed-storefront-fixtures.ts` and
    // `scripts/conformance-storefront.sh` — intersected with this walk's
    // population.
    // All nine, exactly: `master` measured 5646 in the same detached
    // worktree, which is the number that was recorded.
    // **Feature 098 Phase 5 (the storefront performance budget): 5655 -> 5657.**
    // Both are this branch's — `scripts/perf-storefront.sh` and
    // `scripts/lib/storefront-stack.sh` — and exactly two, measured by moving
    // them out of the tree and re-running, which read 5655 again. Unmoved by
    // the rebase onto `master` at a9deb1cfd: the four specification pages that
    // merge brought are outside this walk, which is source comments and
    // `docs/docs/**`.
    // **Feature 105: 5657 -> 5653.** The four `.ts`/`.tsx` files that branch
    // deletes; its changeset is a `.md` outside `docs/docs/`, so this walk does
    // not open it, which is why the delta here is -4 where `check:naming`'s,
    // over the same four deletions, is -3.
    // **Feature 106 (`specs/106-module-owned-tests/`): files 5653 -> 5705.** 52 module
    // packages gain a `vitest.config.ts`; the 196 moves are net zero for a whole-tree
    // walk.
    // **Feature 104 §§ 1.5–1.6: files 5705 -> 5706.** One of the three is this
    // branch's: `npmrc.ts`. Its changeset is a `.md` outside `docs/docs/`, so
    // this walk does not open it — which is why the delta here is +1 where
    // `check:naming`'s, over the same two added files, is +2. The other two
    // arrived on `master`; parking this branch's reads 5707.
    // **2026-09-05: the ten-way merge, and the split is measured.** A queue of ten
    // branches landed together. The **+1** on the narrow walks is feature 112's one new
    // file, `test/service-free-outer-tests.ts`, reaching each walk at the size of the
    // subtree it covers. The **+5 / +6** on the whole-tree walks is four spec files from
    // `specs/112-test-tree-membership/` plus one from the platform-subpath ruling --
    // documentation-only merge requests, which re-record nothing because their authors
    // have no reason to think markdown moves a read size, and three walks here count it.
    // 
    // Predicted before the merge and confirmed after: the same nine entries, with the
    // same deltas, measured first on a locally built merge of the ten branches and then
    // on the merged `master` in a clean checkout. Every branch was 0-drift on its own
    // base; the drift exists only in the union, which is what makes the merged tree the
    // only place it can be recorded.
    // **2026-09-05: +1 for feature 109's `packages/platform/src/composition/index.ts`.**
    // The platform's sixth subpath (D-160.14) is one new file, reaching each walk at the
    // size of the subtree it covers -- which is why eleven module and platform walks move
    // by exactly one and share the value they move from. `check-nul-bytes` and
    // `check-naming.sh` move by two: the barrel plus this branch's changeset markdown.
    // Measured twice over one tree, with the new file present and withheld, so the delta
    // is the branch's own and not the base's.
    // **Feature 110 Phase 1: 5789 -> 5795.** Six: three TypeScript sources and the
    // fixture package's three hand-written `.js` files. Its `package.json`, its
    // documentation page and the changeset markdown are outside this scan.
    // **Feature 109, Phase 1c, follow-up: +2.** The two new sources; this walk
    // reads comments and does not count the changeset markdown.
    // `check-port-dependencies` follows a delegating root to its composer now,
    // so the derivation lives in `@endora-commerce/cli/lib/delegated-composer.ts`
    // with a re-export shim beside the other shared analyses.
    // **Stacked on 113 Phase 0: +12.** That branch adds thirteen files —
    // the demo-data declaration, its runner and their tests, twelve of them
    // TypeScript and one a changeset. This walk takes the twelve TypeScript sources.
    // **`specs/114-release-shape-gate/` landed: +1.** The release-shape gate's
    // design added five files — four markdown and one `.mjs` contract. This walk
    // takes the `.mjs` contract alone — `specs/` is not `docs/docs`, which is the only
// documentation tree this walk reads.
    // **5810 -> 5813 (not this branch's, and recorded here because the drift
    // report named it).** Measured with this branch's three new files taken out
    // of the tree: the walk still reads 5813, so every one of these 3
    // arrived with the five merges this branch was rebased onto and the record
    // was already stale on `master`. Re-recorded rather than left drifting,
    // because a census that cannot reach `0 drifted` stops being read.
    // **CI gate reconciliation (`gate-coverage.test.ts`): 5813 -> 5816.**
    // Three files: `backend/test/helpers/ci-jobs.ts`,
    // `backend/test/helpers/ci-gate-coverage.ts` and
    // `backend/test/unit/ci/gate-coverage.test.ts`.
    // **`specs/110-instance-repository/` Phase 4a: +4 files.** The platform package's
    // new `src/migrations/` plus the two-regime guard and its helper.
    // **Stacked on the CI-gate branch: +3.** That branch adds the gate-coverage
    // test and its two analysis helpers.
    // **`specs/104-package-publication/`'s registry auth repair: +1.** This branch
    // adds one file, `packages/cli/test/npmrc-auth-effect.test.ts` — the install
    // that measures the generated `.npmrc`'s effect rather than its text. Its
    // changeset and its contract edit are outside this walk, whose population is
    // source-code comments and `docs/`.
    // **`specs/115-lifecycle-container-move/` Phase 2: 5820 -> 5821.** One file:
    // `packages/platform/src/lifecycle/index.ts`, the `./lifecycle` barrel — the
    // host-internal address D115-4 gives `_lifecycle`'s operator surface.
    // **+1 for this branch** — the `./lifecycle` barrel alone. A changeset is not a
    // source file and not a `docs/docs` page, so this walk does not see it.
    // **`specs/115-lifecycle-container-move/` Phase 3: 5822 -> 5825 (+3).** The two
    // files the manifest-registry move adds under `packages/platform/src/lifecycle/`
    // — `manifest-registry.ts` and the relocated `services/module-id-claims.ts` —
    // plus `packages/platform/src/lifecycle/manifest-registry.test.ts`. `backend/src` does not
    // move: the binding and the claims re-export both keep their paths.
    // **The service-unavailable notice: 5822 -> 5826.** The same four source
    // files. All four carry English comments; the notice's Polish copy is in
    // `messages.ts`, which this walk already opened and which holds string
    // literals rather than comments — outside Principle VIII by design.
    // **+3 for this branch**, the three storefront sources; the test file is not in
    // this walk's population.
    // **The storefront environment refusal: 5829 -> 5833 (+4), none of it this
    // branch's.** Parking the four files leaves 5833 unchanged. Like its
    // `check-naming.sh` twin — the two are one job and one pair of modes — this walk
    // does not read `storefront/`, so the four new files are invisible to it and the
    // +4 is `master`'s.
    // **`specs/115-lifecycle-container-move/` Phase 4: 5833 -> 5834 (+1).** The divergence
    // split (D115-3) is net one file. `packages/platform/src/lifecycle/divergence-declaration.ts`
    // is new — the parser and the empty default, which are pure over
    // `DeploymentDivergenceDeclarationSchema` and name no path — while under `backend/src`
    // one file goes and one arrives: `lifecycle/services/divergence.ts` is deleted and
    // `overlay/divergence-loader.ts` takes its place beside `overlay-roots.ts`, so that
    // pair cancels here whether or not this walk reads it. Measured rather than reasoned
    // about: with the platform file alone taken out of the tree this walk reads 5833 again.
    // **`specs/117-instance-bring-up/` Phases 1-2: +15 files.** Every file this feature adds, this
    // walk's population being the whole checkout: the contract shape and its test,
    // the platform's declaration, the storefront's and the admin's, the
    // reconciliation rule with its repository host and its companion, the
    // `./env` subpath test, the four input-resolution modules, and the two tests
    // that prove the resolution and the non-interactive guarantee.
    // **Rebased onto `specs/115-lifecycle-container-move/` Phase 4.** Both branches
    // moved this entry and each wrote the same intermediate number, so the value
    // below is the sum of the two contributions rather than either one's — the
    // state the drift census exists to surface, and the reason it is re-measured
    // after a rebase rather than carried across it.
    // **`specs/117-instance-bring-up/` Phase 0 (FR-030): +2 files.** `git ls-files --cached
    // --others --exclude-standard`, so it is the branch's net tracked inventory:
    // the platform derivation, its shim and the FR-030 ratchet in, the `_i18n`
    // source out.
    // **Rebased onto `specs/117-instance-bring-up/` Phases 1-2.** Both branches moved
    // this entry, so the value below is the sum of the two contributions rather than
    // either one's — re-measured after the rebase rather than carried across it, which
    // is the state the drift census exists to surface.
    // **`specs/115-lifecycle-container-move/` Phase 5: 5851 -> 5857 (+6 files).** The five
    // `module:*` command bodies and the `OperatorRuntime` seam they take, moved out of
    // `backend/src/lifecycle/scripts/` into `packages/platform/src/lifecycle/commands/`
    // (D115-1). Six files added and none removed: the five entry points keep their paths,
    // shrunk to the ORM handle, the Redis connection and the system scope.
    // **`specs/110-instance-repository/` T120: 5851 -> 5854 (+3).** git's tracked
    // inventory filtered to the extensions this scan reads, so the 106 moved
    // files cancel and the three are the shell package's barrel, its
    // `src/types/env.d.ts` and its `eslint.config.js`; the manifest, the two
    // tsconfigs and the changeset are not in this scan's extension set, which
    // is why it moves by three where the two whole-tree walks move by seven.
    // **Re-measured on the union after rebasing onto `7d699f4cc`.** Phase 5 and this
    // branch each recorded this entry on `e3dd43635` and neither could see the other;
    // the value below is a fresh census of the combined tree, not the sum of the two.
    // **`specs/110-instance-repository/` Phase 3 (T123/T124/T125): 5860 -> 5924
    // (+64).** The same 64 files as `check-naming.sh`: 60 packages' own
    // `tailwind.css`, the generated enumeration, the fixture's and two TypeScript
    // files. A `@source` directive carries no comment, so none of them can carry a
    // finding; they are population, which is exactly what this number records.
    // **Feature 115 Phase 6: 5924 -> 5921, re-measured on the union.** 3 fewer files under
    // `backend/src`: the phase re-points the application's own reaches onto
    // `@endora-commerce/platform/lifecycle` and deletes the three `_lifecycle`
    // re-export shims that then had no importer left anywhere —
    // `src/lifecycle/plugin.ts`, `services/migration-ownership.ts` and
    // `services/module-origin.ts`.
    // **`chore/094-akeneo-adapt` (!1496, over !1495): files 5921 -> 6064.** The
    // `pim_akeneo` module package arriving, plus `master` at 5c7a4d82a. Of that, **+1 is
    // this branch's test move**: `backend/scripts/ledgers/test-ownership/pim_akeneo.ts`,
    // the shard it opens for the two files that stay.
    // **`specs/110-instance-repository/` Phase 3 (T126/T127): 5924 -> 5927 (+3).**
    // Three of the four files the branch adds. This scan's extension set carries
    // `*.css` and `*.mjs` as well as `*.ts`, so `packages/admin-shell/theme.css`,
    // `admin/test/helpers/compile-instance-stylesheet.mjs` and
    // `admin/test/unit/shell-theme-override.test.ts` all count; the changeset is
    // the one that does not, being `.md` and outside `docs/docs/`. That is the
    // same three-against-four split this entry recorded for T120.
    // **+3 for this branch, measured on the union after rebasing onto `8bf0da614`.** Four files
    // arrive: the shell's `theme.css`, its changeset, and the admin's override test with its
    // compile helper. The branch first recorded against `79a1befe6`, and Phase 6 has since
    // deleted three re-export shims, so the base moved under it — this value is a fresh census
    // of the combined tree rather than the sum of the two.
    // **`specs/115-lifecycle-container-move/` Phase 7: files 5924 -> 5915.** The nine
    // `_lifecycle` re-export shims left in `backend/src/lifecycle/` — `routes.admin.ts`
    // and eight under `services/` — were held open by `backend/test/**` alone; the phase
    // re-points those 112 reaches onto `@endora-commerce/platform/lifecycle` and deletes
    // the shims, which empties `src/lifecycle/services/` entirely. Every walk that reads
    // `backend/src` loses the same nine files.
    // **`specs/110-instance-repository/` T132/T133: 5924 -> 5930 (+6).** The comment scan
    // over the tree's own sources: four under `packages/cli/src/new-instance/` and the two
    // test files. The changeset is markdown outside `docs/docs/**` and is not in this walk.
    // **+6, re-measured on the union after rebasing onto Phase 7.** This branch adds four
    // sources, two tests and a changeset; `specs/115-lifecycle-container-move/` Phase 7 has
    // since deleted nine lifecycle shims, so every base below is lower than this branch first
    // measured. The delta is unchanged; the total is a fresh census of the combined tree.
    // **`chore/094-retire-error-table` (over !1508): 6064 -> 6063.** The tip of `094-akeneo-pim-sync` read 6064, so
    // the whole move is this branch's.
    // `backend/src/modules/_i18n/services/error-translation.ts` — the prefix router
    // feature 090 Phase 4 deleted and this branch re-created — is deleted again, and its
    // replacement is `pim_akeneo`'s own `errorCodes` declaration, which adds no file.
    // **`specs/110-instance-repository/` T113 and T114: 5924 -> 5931 (+7 files).**
    // `backend/src/packages/` (3 files) and `backend/src/overlay/`'s loader (2)
    // moved into `@endora-commerce/platform` behind two new host-internal
    // subpaths, `./packages` and `./overlay`, each with a barrel of its own.
    // Seven files added to the platform, none removed from `backend/src`: every
    // old path keeps a shim or a binding, which is what T119 drains.
    // **+7, re-measured on the union after rebasing onto `1c5a51d86`.** T113 and T114 add seven
    // files to `packages/platform/src/` (three under `packages/`, two under `overlay/`, two
    // barrels); the two whole-repository walks take this branch's two changesets as well. The
    // branch first recorded against a `master` that still held the nine lifecycle shims, so
    // every base moved under it — this is a fresh census of the combined tree, not a sum.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 168 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 docs pages, a contract and a changeset. This scan reads source comments across the tree and takes every source file the branch adds.
    // **+5, all of it this branch's.** `specs/110-instance-repository/` T114a's five new
    // files. The reverted tree reads 5928, which is what is recorded — so unlike the
    // other two whole-tree walks this one carried no `master` residue, its population
    // excluding the directory the unrecorded file landed in.
    // **+1, re-measured on the chained union.** The new platform source, whose comments this scan reads.
    // **5 921 -> 5 924** with feature 110's D-219 batch: five new `.ts` files arrive and two stylesheets go.
    // **+7, re-measured on the union after rebasing onto `ad0fe0876`.** The same seven platform
    // sources T113 and T114 added while this branch was open; the comment scan opens them.
    // **+6, re-measured on the chained union.** This scan reads source comments, so it takes this branch's five new `.ts` files and not its two deleted stylesheets, plus what the chained base adds.
    // **Re-measured on the union of `master` and `094-akeneo-pim-sync`.** The branch brings the `pim_akeneo` module into the tree: 163 files added, 100 of them the package under `packages/modules/pim_akeneo`, 42 backend tests, 12 spec pages, 3 admin tests, 2 documentation pages, a contract and a changeset. This scan reads source comments across the tree and takes every source file the branch adds.
    // **`fix/search-reindex-task-timeout`: files 6079 -> 6080.** The same one new co-located test file.
    // **`specs/110-instance-repository/` T116 (the `db/` move): +6 files.** Eight
    // `db/` sources arrive under `packages/platform/src/`, two leave
    // `backend/src/db/`, and the twelve core migrations move between two roots
    // this walk reads.
    // **Re-measured on the union after rebasing onto `f3d3da596`.** `master` moved
    // this entry too — the `pim_akeneo` module and its 71st package — so the value
    // below is a census of the combined tree rather than the sum of the two
    // branches' arithmetic.
    // **+1, master's.** The search test file; this scan reads source comments and takes the `.ts` and not the changeset.
    // **D-221 (`feat/catalog-new-product-route`): 6080 -> 6081 (+1).** One file, the new
    // `ProductsList.create-affordance-gating.test.tsx`. Its `check-naming.sh` twin moves
    // by two because this scan's population is source-code extensions plus
    // `docs/docs/**` and each module's own `docs/`, and a `.changeset/*.md` is in none
    // of them.
    // **+6, one of it this branch's.** This scan reads source comments, so it takes the new test file and not the changeset.
    // **`specs/110-instance-repository/` T117 (the host CLI dispatcher): +2 files.**
    // The same three additions the whole-repository walks take, minus the
    // changeset markdown, which is not in this population. Measured against a
    // pristine `origin/master` worktree, which read exactly the recorded value.
    // **`specs/113-module-owned-demo-data/` Phase 1: files 6087 -> 6089.** four files
    // arrive — `src/seeds/demo-composition.ts`, `src/seeds/demo-host-residue.ts`,
    // `src/demo/composition-loader.ts` and `test/integration/demo/demo-parity.test.ts` —
    // against the two `src/seeds/` re-export shims T215 deletes.
    // **Re-measured on the chained base, and this delta is not this branch's.** It is now rebased onto `feat/110-t117-cli-to-platform` (T117), which moves the module-command dispatcher into the platform: the move nets to nothing across the two source roots, and what it adds is the platform's `cli` barrel and the shim left at the old path. This scan reads source comments. The base reads 6089 here, so the whole of this +2 is this branch's own sources; the changeset markdown is not in this population.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T220 + T223): files 6091
    // -> 6109 (+18).** The branch adds 23 files and removes none: four modules'
    // `src/backend/demo/` (`rows`, `seed`, `reset` and a co-located test each), `taxes`'
    // `vitest.config.ts`, `backend/src/seeds/demo-relocated-reference.ts` — the frozen
    // copy of the moved blocks that keeps the demo parity comparison a comparison — and
    // five changesets. This walk reads the seventeen `.ts` files plus `taxes`' new
    // `vitest.config.ts`; the five changesets are markdown.
    // **Not this branch's.** `feat/110-t118-composition-split` merged after this branch recorded, adding one platform source (`kernel/i18n/error-envelope-options.ts`) and its changeset. This scan reads source comments, so it takes the `.ts` and not the changeset markdown.
    // **Feature 113 Phase 2 (`specs/113-module-owned-demo-data/`, T222 + T224):
    // files 6110 -> 6125.** The two batches add **16** module-package source files — four
    // modules' `src/backend/demo/` (`admin_roles`, `admin_users`, `organizations`,
    // `catalog`), each a `rows`, a `seed`, a `reset` and a co-located test — and
    // delete one, `backend/src/seeds/seeded-role-permissions.ts`, whose constant is
    // published on `@endora-commerce/mod-admin-roles/backend` instead. Seven
    // changesets go with them. The base was measured on `origin/master`, where the
    // census printed `0 drifted, 43 agree`, so every number below is this branch's
    // and none of it is a delta subtracted from a moving tree.
    // **`specs/110-instance-repository/` T118: +2 files.** The two sources the task adds —
    // `packages/platform/src/composition/compose-app.ts`, the assembly moved out of
    // `backend/src/composition.ts`, and
    // `backend/test/unit/kernel/compose-app-contributions.test.ts`, its contribution-split
    // ledger. The application file keeps its path, so the move nets to nothing.
    // **Re-measured on the union after rebasing onto `fe45ed589`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file, never by subtracting deltas: that tree reads 6125 here, so this branch's own contribution is +2. This scan reads source comments, so it takes the two `.ts` files and not the changeset markdown.
    // **`specs/113-module-owned-demo-data/` Phase 3 (the demo-data budget): files 6125 -> 6129 (+4).**
    // The four `.ts` files this phase adds. It reads comments, and the two
    // changesets are `.md` outside `docs/docs/**`.
    // **Re-measured on the union after rebasing onto `be22a122e`.** Attributed by measuring the base on a pristine `origin/master` worktree carrying no stray ignored file — it reads 6127 here — so this branch's own contribution is +4. The four new `.ts` sources; this scan reads source comments and the two changesets are markdown.
    // **Feature 113's T226: files 6131 -> 6128 (-3).** The corpus is gone —
    // `backend/src/seeds/` loses `dev-catalog-seed.ts`, `demo-host-residue.ts` and
    // `demo-relocated-reference.ts`: the legacy entry point, the last host-held demo
    // block, and the frozen copy the parity comparison read against. Nothing is added
    // under a walked root — the foundation phase is a step inside `demo-composition.ts`.
    // **Feature 113's T235 (the escape hatch's runner half): files 6128 -> 6129 (+1).**
    // One platform source, `packages/platform/src/demo/packages.ts`: the resolver that
    // probes a `demo.package` name and imports it in two separate steps (§6.4).
    // **`specs/110-instance-repository/` T118b: files 6131 -> 6133 (+2).** Two new source files and
    // nothing else — `packages/contracts/src/actor.ts` (the session-free `Actor`)
    // and `packages/platform/src/http/request-actor.ts` (the `declare module
    // 'fastify'` block that puts it on the request). Nothing moved, nothing was
    // deleted, and no site count follows: neither file makes a claim this walk
    // judges. Attributed by running this census on a pristine `origin/master`
    // worktree — `0 drifted, 44 agree, 0 not measured, of 44 recorded` — so all
    // twenty entries below are this merge request's own and none is a subtraction.
    // **Re-measured on the union after rebasing onto `0441ea466`.** Feature 113's T226 and
    // T235 landed on `master` between this branch's base and the rebase — the seed corpus
    // deleted, one platform source added — so the recorded value, which was this branch's
    // own base plus its +1, is two high against the combined tree: 6133 -> 6131. A read size is
    // a measurement of the tree the run walks, so it is re-measured here and never
    // reconciled textually out of the two conflicting sides.
    // **`specs/110-instance-repository/` T119 (the shim drain): files 6131 -> 6104 (-27).**
    // The twenty-seven re-export shims under `backend/src/{commands,events,http,kernel,tenancy}`
    // this walk read as ordinary application sources. It judges none of them — a
    // twenty-line `export *` carries no finding for any of these rules — so the
    // number moves and the verdict does not. Measured on a pristine `origin/master`
    // worktree at `7b70edf22`, whose census printed `0 drifted, 44 agree`, and
    // re-measured there after the rebase rather than carried across it — every one
    // of the sixteen entries this drain moves is the same twenty-seven files.
    // **`fix/admin-image-root-scripts`: files 6131 -> 6133.** The two files this branch adds, `backend/test/helpers/dockerfile.ts` and `backend/test/unit/ci/image-root-script-supply.test.ts`; the four it modifies already existed. Attributed by parking the pair and re-running, never by subtracting: without them every recorded entry agrees. Both new files carry comments, which is this walk's population.
    // **Re-measured on the union after rebasing onto T119.** That task deleted the
    // twenty-seven re-export shims this walk was reading, so every entry here moves by the
    // same −27 and this one lands at 6106 rather than the 6133 recorded against a tree that
    // still held them. The two files this branch adds were already in the recorded value;
    // measured on the combined tree, never summed from the two sides' deltas.
    // **`specs/110-instance-repository/` T118c (the `assets_library` drain):** files 6106
    // -> 6109 (+3). The three `.ts` files. Its markdown half is `docs/docs/**`, so a `.md`
    // under `.changeset/` is outside it, which is the asymmetry against `check-naming.sh`
    // below.
    // **T119a: 6106 -> 6099.** -9 shims, -50 and +50 for the moved test files, +2 for the
    // package's two new `vitest.*.ts` files.
    // **Re-measured on the union after rebasing onto T118c's `assets_library` drain.** That
    // merge request extracts `cms`' asset-embed resolver into a module source, adds its
    // co-located test and a contract test, and carries a changeset — files this walk reads,
    // and none of them counted in the 6099 recorded against the tree before it. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/perf-nightly-capacity`: files 6106 -> 6112.** Attributed by parking the six new files and re-running: without them the census prints `0 drifted, 44 agree`, so every number below is this branch's and none of it is a delta subtracted from a moving tree. The six are `backend/scripts/lib/perf-weights.ts`, `backend/scripts/perf-selection.ts`, `backend/test/unit/ci/perf-selection.test.ts`, `backend/test/unit/ci/schedule-kind.test.ts`, `scripts/lib/schedule-kind.sh` and `scripts/perf-backend.sh`; the twenty-three files it modifies already existed. Here, all six new files carry comments, which is this walk's population; the two shell scripts carry most of them.
    // **Re-measured on the union after rebasing onto T119a.** That task moved 50 of the
    // platform's own unit tests out of `backend/test/` and into `packages/platform/src/`,
    // beside the sources they cover, so this walk reads fewer files than the 6112 recorded
    // against the tree before it. The six files this branch adds are already in that
    // measurement; taken on the combined tree, never summed from the two sides' deltas.
    // **T118c, `returnsBridge`: 6102 -> 6105.** The three new source files. This walk does
    // not open `.changeset/`, which is why it moves by three where `check:naming` and
    // `check:nul-bytes` move by four.
    // **Re-measured on the union after rebasing onto T119b's neighbours.** `origin/master`
    // moved six commits under this branch while it worked, so the recorded value describes
    // neither tree on its own: 6105 -> 6111. This branch's own additions — the module's
    // notification context, its co-located test and the integration test — were already in
    // the recorded figure. Measured on the combined tree, never summed from the deltas.
    // **`specs/110-instance-repository/` T119b: files 6108 -> 6097 (-11).** the eleven
    // re-export shims `specs/110-instance-repository/` T119b deleted from `backend/src`
    // (`demo/index.ts`, `http/error-envelope.ts`, `http/trusted-proxy.ts`, `kernel/compose.ts`,
    // `kernel/container.ts`, `kernel/module-context.ts`, `kernel/ports/require-admin.ts`,
    // `kernel/public-api-base-url.ts`, `kernel/lifecycle/activation-resolver.ts`,
    // `kernel/lifecycle/required-modules.ts` and `tenancy/resolve-tenant-context.ts`) —
    // `backend/src/http/` and `backend/src/kernel/ports/` are gone entirely.
    // **Re-measured on the union after rebasing onto the two T118c drains.** `origin/master`
    // moved eight commits under this branch while it worked, so the recorded value describes
    // neither tree alone: 6097 -> 6100. Taken in the **quality-job shape** — the ignored
    // copies `composer:generate` places under `docs/docs/modules/` swept first, because no
    // job has placed them when these checks run and a developer's tree reads ~80 higher.
    // **Re-measured on the union after rebasing onto T119b.** That task deleted eleven
    // re-export shims — `backend/src/http/` and `backend/src/kernel/ports/` went entirely —
    // so every entry here moves by the same −11 and this one lands at 6103 rather than the
    // 6114 recorded against a tree that still held them. Quality-job shape: the ignored
    // copies under `docs/docs/modules/` swept first, since no job has placed them when
    // these checks run.
    // **`specs/110-instance-repository/` T119c: files 6103 -> 6097 (-6).** the six platform
    // entity re-export shims T119c deleted from `backend/src`
    // (`kernel/audit/audit-log-entry.entity.ts`,
    // `kernel/lifecycle/module-registration.entity.ts`,
    // `kernel/sales-channels/sales-channel.entity.ts` and the three under
    // `kernel/settings/`) — `backend/src/kernel/audit/` is gone entirely. Exactly the
    // shims and nothing else: the 416 consumer specifiers this task re-points are
    // overwhelmingly under `backend/test/**`, and the barrel edit is the platform's own.
    // Quality-job shape: the ignored copies `composer:generate` places under
    // `docs/docs/modules/` swept first, because no job has placed them when these checks
    // run and a developer's tree reads ~80 higher on `check-nul-bytes`.
    // **D-223: files 6103 -> 6108 (+5).** The five `.ts` files it adds:
    // `public-url-base.ts`, its two co-located tests and the two integration tests.
    // **Re-measured on the union after rebasing onto T119c.** That task rewrote 416 entity
    // specifiers onto bare subpaths and deleted the six shims behind them, so this walk reads
    // fewer files than the 6108 recorded against the tree before it: 6102. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **T11A (`specs/110-instance-repository/`): files 6102 -> 6104.** T11A's two files.
    // // **`specs/110-instance-repository/` T118c (the `megamenu` drain, `cms` publishes
    // `cmsBlockReadPort`):** files 6102 -> 6107, the five `.ts` files. The changeset is not
    // under `docs/docs/**` and this walk's markdown population is, so it gains nothing from it
    // — which is why this number and `check-naming.sh`'s move by different amounts on one
    // branch.
    // **Re-measured on the union after rebasing onto T11A.** That task added the residue
    // partition's analysis and its assertions under `backend/test/`, files this walk reads
    // and none of them counted in the 6107 recorded before it: 6109. This branch's own
    // additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`specs/110-instance-repository/` T118c (the `product_feeds` drain —
    // `assets_library` publishes `objectStoragePort` and a batched
    // `assetReadPort.resolvePublicUrls`):** files 6109 -> 6113, the four new `.ts` files.
    // Read on the **staged** tree, as this entry's own block above requires. Quality-job
    // shape: the ignored copies `composer:generate` places under `docs/docs/modules/`
    // swept first, because no job has placed them when these checks run.
    // **`specs/110-instance-repository/` T118c (the `pwa` drain, `pwaBridge`
    // retired):** the branch's five new TypeScript files — two `pwa` module sources,
    // their two co-located tests, and
    // `backend/test/integration/pwa/cross-module-wiring.test.ts`.
    // **Re-measured on the union after rebasing onto the `product_feeds` drain.** Both targets
    // landed the same day and each added its own module sources, co-located tests and wiring
    // test, so the recorded value describes neither tree alone: 6114 -> 6118. Quality-job
    // shape — the ignored copies under `docs/docs/modules/` swept first. Measured on the
    // combined tree, never summed from the two sides' deltas.
    // **The nightly diagnostic repair: +2.** The two test files this merge request adds —
    // `backend/test/unit/harness/vitest-reporters.test.ts` (the reporter union) and
    // `backend/test/unit/ci/junit-artifact.test.ts` (the `test:backend` junit artefact).
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first.
    // **T118c, `invoicesBridge`: +3 files** — the two new `invoices` module files and
    // the backend integration test. The markdown half does not move: `docs/docs/module-
    // reference/invoices.md` is regenerated rather than new.
    // **Re-measured on the union after rebasing onto the nightly-diagnostic change.** That
    // merge request added two test files under `backend/test/`, which these walks read and
    // which were not in the 6121 recorded against the tree before it: 6123. This branch's
    // own additions were already in that figure. Quality-job shape — the ignored copies under
    // `docs/docs/modules/` swept first. Measured on the combined tree, never summed.
    // **`fix/required-module-refusal-stopped` (the issue #258 refusal, restored): files 6118 -> 6120.**
    // The two files this branch adds under `backend/test/`: `harness-tenant-scope.ts`, which holds the tenant context the setup file enters so that `test/tenancy-setup.ts` need not name `@endora-commerce/platform/composition`, and `unit/harness/setup-file-imports.test.ts`, the guard that refuses a setup file which does. Measured rather than reasoned about: both were moved aside and every check re-run, and the base tree drifted on nothing — 0 of 44.
    // **Re-measured on the union after rebasing onto T161's sweep.** That merge request made
    // seven documents honest about the retired `isBaseline` predicate and this branch adds its
    // own guard and harness constant, so the recorded value describes neither tree: 6120 -> 6125.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **`fix/110-instance-template-symbols` (the scaffolded backend compiles): files 6125 -> 6126.**
    // **+1, not +2**, and the difference is the whole of this walk's population: it scans
    // source-code comments, so it takes `packages/cli/test/new-instance/template-reconciliation.test.ts`
    // and not the branch's changeset markdown, which `.changeset/` holds and no `/docs/` page
    // reaches. Measured on a tree with both moved aside, which read 6125 exactly.
    // **Feature 119 (`specs/119-infakt-integration/`), adapted by `review/119-infakt-adaptations`: files 6123 -> 6226.**
    // The header block above this table has the arithmetic; nothing here
    // widened a band.
    // **Re-measured on the union after merging `origin/master` into
    // `feat/119-infakt-integration` (14 commits): files 6226 -> 6229.** Neither side's
    // recorded value describes this tree: this branch's 6226 was measured before
    // `fix/required-module-refusal-stopped`, T161's sweep and
    // `fix/110-instance-template-symbols` landed on `master`, and `master`'s 6126 was measured
    // without feature 119's two module packages. The +3 is the three TypeScript files the
    // master side adds. **+3 and not +4**, and the difference is this walk's population: it
    // scans source-code comments and `docs/docs/**`, so the master side's changeset markdown,
    // which `.changeset/` holds and no `/docs/` page reaches, is not in it. Quality-job shape
    // — the ignored copies under `docs/docs/modules/` swept first, and the resolution of this
    // file **staged** before the run: this walk takes its population from `git ls-files
    // --cached --others --exclude-standard`, so it reads the index rather than the disk, and
    // an unmerged path is listed once per conflict stage. Measured on the combined tree, never
    // summed from the two sides' deltas.
    // **T140 (the instance acceptance criterion): files 6126 -> 6129.** Three `.ts` files — the criterion, its judgement and its unit test. Its per-extension walk reads no JSON, which is the whole of its difference from `check:naming` here.
    // **Re-measured on the union after merging `origin/master` into `feat/119-infakt-integration`
    // (13 commits): files 6229 -> 6232.** Neither side's recorded value describes this tree: the
    // branch's 6229 was measured before `specs/110-instance-repository/` T140 and !1583 landed on
    // `master`, and `master`'s own value was measured without feature 119's two module packages.
    // Park-and-re-measure does not reach this check: its population is `git ls-files --cached
    // --others --exclude-standard`, the **index** rather than the disk, so withdrawing a staged
    // file leaves it listed. It is measured after staging the resolution instead — during an
    // unresolved merge a conflicted path is listed once per stage and this walk reads two high.
    // The delta is the master side's three `.ts` files; its per-extension walk reads no JSON and
    // does not reach `specs/`, which is the whole of its difference from `check:naming` here.
    // Quality-job shape — the ignored copies under `docs/docs/modules/` swept first. Measured on
    // the combined tree, never summed from the two sides' deltas.
    // **T141 (the instance bring-up repairs).** Five source files under `packages/platform/src` — `db/platform-schema.ts`, `lifecycle/resident.ts` and the three co-located tests beside them — plus this merge request's own changeset, which the whole-tree walks open like any other file. Measured against a pristine `origin/master` worktree run in the same shape, which reports 0 drifted of 44: every number below moved on this branch and none of it was already stale.
    // **Merged with `origin/master` at 3a5616b7d, and re-measured rather than reconciled.** Feature 119 landed two module packages while this branch was open, so its number describes a tree without this branch's files and this branch's number describes a tree without feature 119's. Neither describes the union, and there is no arithmetic that would: the number below is a fresh measurement on the merged tree, taken in a clean worktree in the `quality` job's shape.
    // **Feature 114, Phase 2 (the history landing): 6232 -> 6233.** One file, against the
    // −130 the two whole-tree walks above take from the same branch, and the difference
    // *is* this check's population: its source half is an extension list (`*.ts`, `*.mjs`,
    // `*.sh`, …) and its docs half is `docs/docs/**`, so 214 deleted `.changeset/*.md` and
    // 83 added `CHANGELOG.md` are in neither. What moves it is the landing's verifier,
    // `specs/114-release-shape-gate/contracts/verify-landing.mjs`, which `*.mjs` reaches
    // wherever it sits — the earlier note's "does not reach `specs/`" is about `.md` under
    // `specs/`, not about the directory. **Measured** in a fresh worktree in the quality
    // job's shape, with the landing staged, this population being the index.
    // **Merged with `origin/master` at f93a38ed6 (!1592, the instance bring-up repairs),
    // and re-measured rather than reconciled: 6238.** This walk moves by five from that
    // side and by one from this, against the −130 the two above take from this branch, and
    // both differences are its population: an extension list plus `docs/docs/**`, so
    // !1592's five `.ts` files under `packages/platform/src` are in it and its changeset is
    // not, exactly as this branch's 214 deleted changesets and 83 added changelogs are not
    // and its `.mjs` verifier is. Measured on the merged tree after the resolution was
    // committed, this population being the index.
    // **`specs/110-instance-repository/` T138 (the admin member): files +6.** The seven
    // files this branch adds are `AdminRoot.tsx` in the shell, `endora generate` and its
    // test, the two halves of the admin-artefact renderer that moved into the CLI, the
    // shim left at its old path, and the changeset. Measured in a clean worktree in the
    // `quality` job's shape, against `origin/master` at 15b866da3 measured the same way,
    // so nothing below folds in a number that was already stale.
    // Six rather than seven: this walk reads source and the changeset is a `.md` outside it.

    // **`specs/110-instance-repository/` T137 (the documentation member and the moved
    // documentation renderers): 6246 -> 6251 (+5).** The five TypeScript files `check-nul-bytes` names; the changeset is markdown under `.changeset/`, which is outside this walk's roots. Quality-job shape: the ignored copies
    // `composer:generate` places under `docs/docs/modules/` swept first, and `docs/build`
    // removed — a working tree that has built the site reads far higher on `check-nul-bytes`.
    files: 6251,
    sites: null,
    sources: ['manifest-index'],
    //
    // **5928 -> 5929, and this branch's own contribution is −1.** D-218 moved
    // `pim_pimcore`'s `hmac-canonical-vectors.test.ts` and its `.json` vectors out
    // of `backend/test/unit/` and into the package beside their subject, which the
    // asset classifier's new fixture predicate is what made possible. Same
    // population shape as `check:naming` above. With the branch withdrawn the tree
    // reads **5930**; the other +2 was already there.
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
