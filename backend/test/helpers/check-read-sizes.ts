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
export const RECORDED_READ_SIZES: Readonly<Record<string, RecordedReadSize>> = {
  'backend/scripts/check-action-route-permissions.ts': {
    prefix: '[action-route-permissions]',
    run: { kind: 'tsx', path: 'scripts/check-action-route-permissions.ts', args: [] },
    files: 1878,
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
    sites: 86,
    // `emitted-manifests` is this check saying which artefact its manifest half
    // came from: the manifests are imported rather than walked, and a packaged
    // module's resolves at its build output. It is the disclosure half of the
    // staleness refusal; see `scripts/lib/emitted-freshness.ts`.
    sources: ['manifest-index', 'emitted-manifests'],
  },
  'backend/scripts/check-channel-resolution.ts': {
    prefix: '[channel-resolution]',
    run: { kind: 'tsx', path: 'scripts/check-channel-resolution.ts', args: ['--enforce'] },
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
    files: 2002,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-command-coverage.ts': {
    prefix: '[command-coverage]',
    run: { kind: 'tsx', path: 'scripts/check-command-coverage.ts', args: ['--strict'] },
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
    files: 1552,
    sites: null,
    // 64, not 65: this check excludes modules by argument, and the expectation
    // is derived after the exclusion rather than despite it.
    sources: ['manifest-index'],
  },
  'backend/scripts/check-container-imports.ts': {
    prefix: '[container-imports]',
    run: { kind: 'tsx', path: 'scripts/check-container-imports.ts', args: [] },
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
    files: 1803,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-diacritic-folds.ts': {
    prefix: '[diacritic-folds]',
    run: { kind: 'tsx', path: 'scripts/check-diacritic-folds.ts', args: [] },
    // **Batch 13 (feature 091, Phase 4): +1.** Whole-tree arithmetic: twenty-four
    // files move into the module packages, twenty-four leave `admin/src`, the
    // `FulfilmentStrategyPicker` shim there is deleted with its last reader, and
    // the batch adds two off-state test files.
    // **Batch 15: 4954 -> 4953.** The whole-tree walk: four re-export shims
    // deleted, and three files added (`catalog/src/admin/index.ts` and the
    // batch's two new test files).
    files: 5142,
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
    sites: 478,
    sources: [],
  },
  'backend/scripts/check-doc-snippets.ts': {
    prefix: '[doc-snippets]',
    run: { kind: 'tsx', path: 'scripts/check-doc-snippets.ts', args: [] },
    files: 1102,
    sites: 11,
    sources: [],
  },
  'backend/scripts/check-entity-tenant-classification.ts': {
    prefix: '[tenant-classification]',
    run: { kind: 'tsx', path: 'scripts/check-entity-tenant-classification.ts', args: [] },
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
    files: 2002,
    sites: 251,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-presence.ts': {
    prefix: '[entry-presence]',
    run: { kind: 'tsx', path: 'scripts/check-entry-presence.ts', args: [] },
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
    files: 2002,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-entry-scope.ts': {
    prefix: '[entry-scope]',
    run: { kind: 'tsx', path: 'scripts/check-entry-scope.ts', args: [] },
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
    files: 2002,
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
    sites: 43,
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
    files: 128,
    sites: 864,
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
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    files: 1749,
    // **Batch 13 (feature 091, Phase 4): +1**, a fixture read in the batch's own
    // backend off-state test.
    // **Batch 14 (feature 091, Phase 4): +1 file and +1 site.** The batch's own
    // backend test,
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // which boots the server and therefore reads the database — so it joins
    // both the walk and the finer population in the same merge request.
    // **Batch 15: 532 -> 533.** One read site in the batch's own backend
    // integration test.
    sites: 567,
    sources: [],
  },
  'backend/scripts/check-harness-teardown.ts': {
    prefix: '[harness-teardown]',
    run: { kind: 'tsx', path: 'scripts/check-harness-teardown.ts', args: [] },
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 14 (feature 091, Phase 4): +1 file.** The backend test tree gains
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // the server half of the batch's off-state proof.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    files: 1749,
    sites: null,
    sources: [],
  },
  'backend/scripts/check-kernel-boundary.ts': {
    prefix: '[kernel-boundary]',
    run: { kind: 'tsx', path: 'scripts/check-kernel-boundary.ts', args: [] },
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
    files: 2002,
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
    files: 222,
    sites: 14,
    sources: ['manifest-index', 'contracts-barrel'],
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
    files: 2324,
    sites: 53,
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
    files: 128,
    // Every registered module, shipping or not. It moves only with the module
    // set, so a run whose `sites` fell while `files` held is a module that left
    // the index rather than a translation that left a package.
    sites: 71,
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
    files: 78,
    // The finer population, and it answers a different question: the navigation
    // entries the committed sidebar names plus the rows the committed map
    // carries. A page added and not regenerated moves `files` and leaves `sites`
    // where it was, which is exactly the drift the check refuses; 78 entries (65
    // module entries, the map's own, and 12 sub-pages) and 71 rows.
    sites: 149,
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
    // **Batch 13 (feature 091, Phase 4): +4.** The four `.ts` files the batch
    // moves under the module walk roots — `inventory`'s and `quick_order`'s
    // admin clients, `pim_ergonode`'s client and its `format.ts`. The other
    // twenty files it moves are `.tsx` and this walk does not open them.
    // **Batch 15 (feature 091, Phase 4): 1478 -> 1481.** The three `.ts` files
    // `catalog`' and `orders`' admin layers add to the module walk — this check
    // reads module sources and shipped bundles, and the twenty-four `.tsx`
    // screens are outside its extension set.
    files: 1563,
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
    sites: 31619,
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
    files: 392,
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
    sites: 2159,
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
    files: 4145,
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
    sites: 11129,
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
    files: 7278,
    sites: null,
    sources: [],
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
    files: 109,
    // The finer population, and the one that moves when a **resolver shape** is
    // added or lost: every `expectModuleAbsent` and `withModuleOff` call the
    // walk read, both helpers, one per call however many modules the call
    // names. Nine of them are table-driven `it.each` sites, and the file count
    // does not move when that shape stops resolving — which is exactly why a
    // check that answers per call has to print both numbers (#235/#237).
    sites: 198,
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
    sites: 667,
    files: 10,
    sources: [],
  },
  'backend/scripts/check-port-catches.ts': {
    prefix: '[port-catches]',
    run: { kind: 'tsx', path: 'scripts/check-port-catches.ts', args: [] },
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
    files: 2002,
    sites: 196,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-port-dependencies.ts': {
    prefix: '[port-deps]',
    run: { kind: 'tsx', path: 'scripts/check-port-dependencies.ts', args: [] },
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
    files: 1788,
    sites: 1468,
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
    files: 2063,
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
    sites: 1742,
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
    files: 1885,
    sites: 692,
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
    files: 85,
    sites: 93,
    sources: ['workspace-globs'],
  },
  'backend/scripts/check-shared-table-wipes.ts': {
    prefix: '[shared-table-wipes]',
    run: { kind: 'tsx', path: 'scripts/check-shared-table-wipes.ts', args: [] },
    // **Batch 13 (feature 091, Phase 4): +1.** The batch's backend off-state
    // proof, `test/integration/_admin_surfaces/batch-thirteen-palette-off-state.test.ts`.
    // **Batch 14 (feature 091, Phase 4): +1 file.** The backend test tree gains
    // `test/integration/_admin_surfaces/batch-fourteen-palette-off-state.test.ts`,
    // the server half of the batch's off-state proof.
    // **Batch 15 (feature 091, Phase 4): 1652 -> 1653.** One: the batch's own
    // `test/integration/_admin_surfaces/batch-fifteen-palette-off-state.test.ts`.
    files: 1749,
    sites: 162,
    sources: [],
  },
  'backend/scripts/check-subscribe-seam.ts': {
    prefix: '[subscribe-seam]',
    run: { kind: 'tsx', path: 'scripts/check-subscribe-seam.ts', args: [] },
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
    files: 2002,
    sites: null,
    sources: ['manifest-index'],
  },
  'backend/scripts/check-transaction-context.ts': {
    prefix: '[transaction-context]',
    run: { kind: 'tsx', path: 'scripts/check-transaction-context.ts', args: [] },
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
    files: 2002,
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
    // **Batch 13 (feature 091, Phase 4): +25.** The twenty-four moved screens,
    // plus the batch's backend off-state test.
    // **Batch 14 (feature 091, Phase 4): +21 files.** The whole moved set —
    // eighteen screens, two contribution entries and one admin API client —
    // arriving under `packages/modules/*/src/admin/`, which is this walk's
    // population and was not the admin application's.
    // **Batch 15: 3879 -> 3904.** The twenty-four net module-package sources
    // above, plus the batch's own backend integration test.
    files: 4150,
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
    sites: 1101,
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
    files: 422,
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
    files: 7338,
    sites: null,
    sources: ['manifest-index'],
  },
  'scripts/check-language.sh': {
    prefix: '[language]',
    run: { kind: 'bash', path: 'scripts/check-language.sh', args: [] },
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
    files: 5473,
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
