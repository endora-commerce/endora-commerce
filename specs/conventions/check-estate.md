# The static check estate — writing one, and measuring what it read

**Open this before adding or changing a `check-*` script, before re-recording a read size, and
whenever a check reports something you do not recognise.** It carries the obligations a new
check owes (inventory entry, estate verdict, red proofs, exit-2 discipline, a recorded read
size), the measurement traps that have each produced a recorded number no clean tree can
reproduce, and the two shell checks' own rules. The per-check rows are in
`check-inventory.md`. One of the bodies `AGENTS.md` routes to; it is the single home for these
rules, so never restate them in `AGENTS.md` or in a tool-specific pointer file.

**Adding or changing a check?** It needs an entry in
`backend/test/unit/scripts/check-inventory.test.ts` (which enumerates every `check-*` script
and fails on one it does not name), a companion test, and an exit code of **2** for "nothing
was read" — an empty file list, a missing input, a tree it could not walk. A green result
must not be able to mean "not looking": that is issue #113.

**And an entry in `endora check`'s estate manifest** (`packages/cli/src/check/estate.ts`,
feature `specs/101-endora-check/`), saying what your rule means when its subject is one module
package instead of this repository: `package` with a host or a phase, or `repository-only`
with a written reason. That reconciliation is two-way and lives in the same inventory test, so
a check cannot arrive with no verdict there and a verdict cannot outlive its script — which is
the point, because a command that fronts most of the estate and does not *name* the rest is a
curated subset, and a curated subset is a list somebody updates or does not. **`repository-only`
is a claim about the rule's subject, not about its root**: a rule the inventory records as
walking the module tree (`residueGuard: 'derived-population'`) cannot be repository-only, since
a module package is one of those modules, and the test refuses the contradiction. Neither the
estate's size nor the reason lists are written down anywhere — both are derived, and the size
went stale by four inside five days the last time it was in prose (D-100).

**And a job has to run it, which is a question about the *pipeline* and not about the
script.** `check-inventory.test.ts` already holds every `check-*` entry to the `quality` and
`quality:static` command blocks in both directions, and it is complete over **its** population
— which is the problem, because that population is `check-*.ts` files, `check-*.sh` files and
`check:*` package scripts. `manifests:check` is a gate called `manifests:check` running a file
called `generate-module-manifests.ts`, so it was in none of the three, appeared in **no CI job
at all** for its whole existence, and was found red on `master` with 70 stale module-package
manifests by a developer running it locally. That is issue #113's shape one level up: not a
green that means "not looking", but a gate whose green is never even claimed. A population
keyed on a naming habit is defined by the presence of the habit — #244's finding, arriving in
the inventory that enforces #244. So `backend/test/unit/ci/gate-coverage.test.ts` asks the
question over a population keyed on what a script **runs**: every package script, of every
workspace member and of the repository root, whose command runs a file under a `scripts/`
directory. It derives whether any job reaches it — following a job through a Dockerfile a
`docker build -f` names, through `pnpm --filter` / `-r` selectors, through a chain of package
scripts and through `pre*` / `post*` lifecycle hooks — and fails on one that is neither run
nor classified. A classification states a **property**: `produces` (it writes the tree, and it
names the gate that verifies its output, **which must itself be run by a job** — that one
assertion is the whole defect), `superseded`, `developer-tool` or `local-operation`. There is
deliberately no "not wired yet" verdict, and no `check-*` script for any of it: parsing
`.gitlab-ci.yml` inside a unit run is a test, in the `boot-gate` and `build:docs` precedent.

**And it prints what it read** (issue #244). Exit 2 answers "the input was empty"; it does
not answer "the input was 7% of itself", which is the case that happens — the same shape has
now been found seven times, and every one of them was a check whose output said what it
found and never said what it read. So every check prints one line in one grammar, from
`backend/scripts/lib/read-size.ts` or the shell twin `scripts/lib/read-size.sh`:
`[entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18`.
`files` is what the walk **opened**, never the files a finding landed in; `sites` is the
finer population where the check has one (#235/#237 are the case where the file count stood
still and the site count moved); `sources` is the **independent** derivation it is reconciled
against — the manifest index for a module walk, `package.json` scripts for a declared
program — because a check that computes its own population and then reports it has said the
same thing twice. Where there is genuinely no second author the token is `self-reported` and
the reason goes in `READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE`. The reporter itself exits 2 on
nothing read, on an expectation of zero and on a walk **shorter** than its expectation, and
`backend/test/unit/scripts/check-read-size.test.ts` spawns **every** check and holds
each printed number to the band recorded in `backend/test/helpers/check-read-sizes.ts`
(−10% / +50%). Re-record a number when the population legitimately grows; never widen the
band to make a run pass — **and which entries to re-record is now printed rather than
remembered**: the same run emits a `[read-size drift]` block naming every recorded entry that
no longer describes the tree, with the recorded value, the observed one, the signed delta and
how much of the slack to that edge the move consumed, on a green run as well as a red one
(feature `specs/095-read-size-drift-report/`). It exists because the band ratchets *blindness*
and cannot ratchet *staleness* — a recorded value went wrong three times in ten days, twice
silently, every one of them comfortably inside the band — and because "re-record in the merge
request that moved it" presupposes an author knows which entries their change moved, which is
the computation each check performs and not a thing a checklist can enlarge. The header is a
census (`3 drifted, 32 agree, 0 not measured, of 35 recorded`), printed even when nothing
drifted, because a silent report cannot be told from one that did not run; an entry the run
could not measure is named as *not measured* and never counted as agreeing.

**Measure a read size in a tree with the shape CI has, and that means a *clean* one.** Two
things make a working checkout read high, and only the first is widely known. `composer:generate`
places ~62–80 copies under `docs/docs/modules/` that no `quality` job has placed when the check
runs, so `git clean -fX docs/docs/modules && rm -f docs/.module-docs-copies.json` comes before
any measurement — that trap has caught four agents here. The second is the same mistake without
the landmark: **`check-nul-bytes` reads git-ignored files by design**, so a whole-tree walk counts
whatever else your checkout happens to be carrying. Measured on 2026-09-11, one working checkout
against a pristine worktree of the same commit: **8166 against 8158** — two
`admin/vite.config.ts.timestamp-*.mjs`, four `.env` files, `storefront/tsconfig.tsbuildinfo` and a
stale `packages/api-client/` directory left behind by the package D-202 deleted. Recording the
first number would have put one developer's local residue into the shared record, where every CI
run afterwards reports drift against a value no clean tree can produce — a ratchet inverted into a
permanent false positive. So re-record from a fresh `git worktree`, never from the tree you have
been working in.

**And two of them read the *index*, not the disk, which makes a measurement taken mid-merge
wrong in a way nothing reports.** `check-naming.sh` and `check-language.sh` take their population
from `git ls-files --cached --others --exclude-standard`. During an **unresolved merge** git lists
a conflicted path **once per stage**, so both over-count by two for every conflicted file — 8351
and 6231 measured before `git add` of a one-file resolution, 8349 and 6229 after it. Stage the
resolution, then measure. It also breaks the attribution method that works everywhere else: you
cannot park a file and re-run these two, because parking changes the index entry rather than
removing it from the walk. This is the same failure as the two above wearing a third costume —
**a number measured in a tree whose shape is not the one CI will see** — and the three together
are why a read size is re-measured rather than reasoned about.

**This record conflicts on nearly every long-lived branch, and the cause is co-movement rather
than co-location — so sharding it one file per check would not help.** The practice is settled: a
conflict here is never reconciled, because read sizes are measurements — resolve wholly to the
incoming side, re-measure on the merged tree in a commit afterwards, and re-measure even the
entries that merged cleanly. What was *not* settled was why the conflict keeps happening, and the
standing assumption — that one file holding forty-four independent measurements makes any two
branches collide even when the entries they move are disjoint — is **false**, measured twice on
2026-09-15. First, forty-four throwaway commits were built per world, each re-recording exactly one
check the way a real re-record is written (a dated narrative, then the number), and every pair
merged with `git merge-tree --write-tree`: **0 of 946 disjoint pairs conflict** on `master`, and 0
with the record sharded. Entries are hundreds of lines long, so two edits are never inside git's
context window. Second, every merge in the last 400 on `master` where *both* sides had touched the
record — 28 of them — was three-way merged as one file and again per entry: **233 conflicting
entries as one file against 224 sharded**, identical in 20 of the 28, better by one to four in six
of them, and two that were already clean. The conflicts are concentrated instead:
`scripts/check-naming.sh` and `check-nul-bytes.ts` conflict in **25 of 28**, `check-language.sh` in
18, `check-diacritic-folds.ts` in 15. Those are the whole-repository walks, whose `files` is
literally how many files the repository has, so **every** branch that adds or deletes one file
moves them — and two branches that genuinely move the same entry conflict whatever shape the record
has. A hot entry cannot be sharded apart from itself. If this is ever attacked again, attack the
co-movement (a merge driver performing the resolution that is already mechanical, with the
`[read-size drift]` census promoted from a report to an assertion so nothing lands stale) rather
than the file layout — and note that `specs/114-release-shape-gate/contracts/verify-landing.mjs`
declares `backend/test/helpers/check-read-sizes.ts` as a **prefix** in its `BRANCH_ARTEFACTS` list,
which stops matching the moment the record becomes a directory. That verifier is pinned to a past
release commit and is wired to no job, and it fails closed — assertion 6 names each unexplained
path — so it is not a defect today and is deliberately not on `specs/deferred-defects.md`, whose
criterion is about postponing the repair of a *module* defect and which would have it fixed now
rather than filed. It is written here because here is where the person who would trip it is
reading.

**How many checks that is is not written here**: this sentence read
*"all twenty-seven"* while `RECORDED_READ_SIZES` — the list the test actually spawns — held
**34**, a count of a derived fact going stale by seven inside the paragraph whose entire
subject is a number nobody re-derived (D-100). The record file answers it, and it grows in the
merge request that adds a check. The copies that stood in `check-read-sizes.ts`' and
`check-inventory.test.ts`' own headers were removed rather than decremented (feature 091,
Phase 5 T5): what they meant was *"every check in `CHECKS`"*, which is what they now say.

**That spawning test tolerates a non-zero exit and refuses a *kill*, and the two are not
the same finding.** A check may legitimately be red on the working tree and still has to
disclose what it read; a check the kernel killed disclosed nothing for a reason that is not
its own. Collapsing both into one caught error is how `master` came to fail with
`check-port-catches.ts printed no read line` — a content-shaped assertion, exit 1 rather than
137, matching nothing anyone greps for after an OOM — while the truth was that the two
heaviest checks had been SIGKILLed inside a 4 GB runner.
`backend/test/helpers/check-process.ts` keeps the `close` event's answers apart, and
`backend/test/helpers/spawn-pool.ts` sizes the pool from the container's own accounting
rather than from a number somebody picked: cores, intersected with what cgroup v2 says is
left, minus one child's worth of headroom. If you write a test that spawns processes, spawn
them through those two — the next resource failure will wear the same disguise.

**And it refuses a kill *whichever layer took the signal*, which is the half that repair
missed and the reason this paragraph says "kill" rather than "signal".** `signal !== null` on
the `close` event is the kernel's own discrimination and it is correct for a **direct child**;
the estate is spawned as `pnpm exec tsx <check>`, three processes deep, and the one holding
the TypeScript program is the innermost. Its two ancestors survive, observe a child that died
on a signal, and report it the way POSIX has always reported one — by exiting `128 + signum`
themselves — so the parent's `close` carries `code: 137, signal: null` and the discrimination
never fires. Scheduled pipeline 13573 therefore printed *"exited 137 … it ran to a verdict of
its own, so this is the check's behaviour"* over a `check-port-shape` the kernel had killed,
and sent its reader into an analysis with no bug in it. A relay is now its own termination
kind, and the two questions it raises are answered by two different authorities on purpose:
**was it a signal** is the `128 + n` convention, un-mapped through Node's own
`os.constants.signals` so nothing writes `137` or `SIGKILL` down; **was it memory** is the
container's `memory.events`, read through `backend/test/oom-evidence.ts` — the same derivation
the suite's own OOM verdict uses, asked over the window the child was alive for. Neither can
answer the other's question, and an external `kill -9` is the case that proves it. The one
reading it can get wrong — a check that exits `128 + n` as a verdict of its own, which none
does — is named in the message rather than hidden, because at the `close` event the two are
the same two values and no analysis here can separate them.

**A check's peak RSS is a measurement with an expiry date, and it has expired once already.**
`PEAK_BYTES_PER_CHECK` in `check-read-size.test.ts` is the divisor the pool is sized with, and
the numbers that stood beside it (746 MB and 627 MB for the two heaviest, 2026-08-24) were an
**under**-estimate of the tree eighteen days later: re-measured 2026-09-11 over every recorded
check, `check-port-shape` peaks at 836 MB and `check-port-catches` at 828, the 41 `tsx` checks
run 232–836 MB with a median of 593, and nothing else reaches 700. Do not write those numbers
anywhere else — they are in that constant's own doc block, where the derivation reads them —
and re-measure rather than widen when the tree grows. **`check-port-shape` growing by a third
in eighteen days is its own piece of work** and is not a message repair: it is a single
process that will not fit a 4 GB container beside three sibling vitest forks for very much
longer.

The inventory entry carries the red proofs, and two properties decide whether they are worth
anything (issue #130). **The fixture enters at the top of the analysis** — source text, a
file map, an injected reader, a fixture tree on disk — never a value the check normally
computes: the entry for `check-entry-scope` handed a *pre-classified* record to the last
function in the chain, so the classifier it was supposed to protect never ran, and the
`setInterval(`-only grep inside it hid a live FR-020 gap. A fixture that enters below the
defect cannot catch it. And **one proof per shape the check claims to refuse**, each
asserting the finding's kind, or four of a check's five signals can go blind behind the
fifth's red. `docs/docs/architecture/kernel.md` § *Writing a check that can go red* is the
working guide.

**Exit 2 on a walk that came back *short*, not only on one that came back empty** (issue
#215). `files.length === 0` is the wrong predicate for a check whose population is
`backend/src/modules`: 1364 of the 1469 `.ts` files under `backend/src` live there, so a
moved module tree does not empty the walk — it leaves the other 105 files, which the check
reads, finds nothing wrong in, and reports clean. Measured with `src/modules` moved out of
`src`, eight checks exited 0; three more were red only because a ledger went stale, and
four survive a *partial* move because their floor is "at least one" rather than "all of
them". So a module-tree walk derives its expected population from the generated manifest
index and refuses when a registered module contributed no source —
`backend/scripts/lib/module-population.ts`, and never a count written down, here or in a
check (D-100). `backend/test/unit/scripts/moved-module-tree.test.ts` spawns each of them
over a fixture backend whose modules are gone and whose registry still lists them; the
inventory's `residueGuard` field is the two-way link to it.

**Refusing a moved tree is not following one, and the difference is what makes F4's layout
move reviewable** (feature 080, T040a). Because that floor is *per module*, the first module
to leave `backend/src/modules` reds all sixteen checks at once — the index still registers it
and no walk produces a file for it — so before this the move was one commit or nothing. The
module root is therefore a **derived list**, `backend/scripts/lib/module-roots.ts`: the
generated index is *located* (searched for over the workspace members, so it is found where it
is today and equally at `backend/src/` after the ruling that makes it host-owned), the
application's source root is the index's own ancestor one level inside the member holding it,
and each module's directory is either a directory under that root named after a registered id
or a **workspace member declaring `endora: { type: 'module', id }`** — the package's own
statement about itself, the same one the runtime discovery reads. Which directories are members
comes from `pnpm-workspace.yaml`, never from a path written down: `packages/modules` appears in
no check and in no ledger. A check takes `layout.moduleWalkRoots` (module sources) or
`layout.sourceRoots` (the whole application tree plus each package), and `layout.keyOf` /
`layout.displayOf` for the two key shapes the ledgers already use — both byte-identical for a
tree that has not moved. The split half of `moved-module-tree.test.ts` is the proof: every
check in that file's list, over a fixture with some modules in packages and the rest in
`src/modules`, exits **0**, and over the same tree with one module's `package.json` removed —
nothing else changed — every one of them exits **2**. **Which** modules the fixture puts where
is a **pool** and not a roster, and a module leaving `backend/src/modules` for real therefore
costs no edit to it: the fixture relocates whichever pool members the application tree still
holds, counts the real module packages toward the same floor, and refuses — naming the pool —
when too few modules would sit outside the application tree for the split to stage anything.
The counts are printed by the run and are deliberately written down neither here nor in the
fixture (D-100); what is written down is the pool, because "this module carries no ledger key,
no `scripts/*.ts` entry point, no cross-owner permission gate and no overlay reach" is not a
property a walk can decide.

Both run in CI as GitLab's `quality:static` job — full tree, every MR and every push to
`master`. They need only bash, grep, perl and POSIX awk (no `pnpm install`), so keep them
free of gawk-isms and of anything that assumes a node toolchain. Neither script may pass on
an empty file list; both exit 2 when `git` is missing rather than reporting a vacuous green.

`pnpm run check:language` (Principle VIII) scans source-code **comments** and `docs/docs/**`
pages for Polish. It ignores cited terms — anything inside backticks, `"quotes"`, a fenced
code block, or (in docs) markdown emphasis — because an English comment routinely has to
quote a Polish UI label, currency rendering or expected test string. **If it flags you, cite
the term rather than translating it.** Two deliberate carve-outs exist:

- Polish proper nouns with no English form (state institutions, official registries, the
  Polish names of shipped features) live in the `proper_nouns` list in
  `scripts/check-language.sh`. Keep it short — a UI label is a citation, not a proper noun.
- An intrinsically bilingual page opts out with `check-language: allow-non-english` plus a
  reason, in its YAML front matter. Currently only the EN→PL glossary
  (`docs/docs/contributing/translations.md`) qualifies.

`pnpm run check:naming` (Principle VI) checks backend module folder shape, migration
identifiers, Zod contract keys, route segments and — since feature 081 — that a migration
**class name is scoped by its owning module** (`unscoped-name`; zero findings when it landed,
and it exits 2 on a tree that holds no migration rather than reporting a vacuous green).
Module folders are plural snake_case;
`_`-prefixed infra modules (`_i18n`, `_lifecycle`), singular named surfaces and vendor/
protocol proper nouns are allow-listed in `scripts/check-naming.sh`. A `z.object()` field
that must stay snake_case because it is **persisted verbatim** (a JSONB envelope with a SQL
column default, an external vendor's wire format) is marked with `naming:allow-snake-case`
plus a reason in a comment directly above the field — see `cmsContentEnvelopeSchema` in
`packages/contracts/src/cms.ts`. Do not use it to skip a genuine API-shape fix.

**Its module root is resolved, never spelled** (feature 080, T012), and since T040a it is a
**list of module directories** rather than one root. Three of the five rules walk the module
tree, and the path used to be written into the script eight times, so a tree that moved took
them with it: the rules iterated nothing, the other two reported on what was left, and the
script printed a green tick. `scripts/lib/module-root.sh` — the bash twin of
`backend/scripts/lib/module-roots.ts` — resolves it instead: the generated manifest index is
found by **name** anywhere under the checkout (T012 keyed on `<root>/_lifecycle/`, which stops
being where it lives once the index is host-owned), the ids come off its entry array rather
than off its import specifiers (a specifier is relative today and a bare package name
tomorrow), and a module's directory is the ancestor of a `manifest.ts` named after one of those
ids that either sits under the application's source root or carries a `package.json` of its
own. A repository with no index is exit 2 and one with two is exit 2 as well, rather than a
scan silently narrowed to whichever sorted first. If you are writing a shell check that walks
modules, iterate that list; do not add a ninth literal. Rule 1 is the one exception and says
so in place: it judges *names*, so its population is every directory that sits **where** a
module sits (`module_root_module_folders`), because a misnamed folder is the one the index does
not list. `read_size_module_coverage` takes the same directories, so its
`manifest-index:<covered>/<expected>` token counts a module that has become a package instead
of reporting the shortfall it exists to refuse. **`check:language` resolves it the same way**,
and did not until the nested-worktree repair below: it spelled the index path, so a moved tree
ended its run on "could not read the manifest index" — a refusal rather than #215's silent
green, but still a check that stops working for a layout change it should follow. The two are
one job and one pair of modes; deriving the population twice is two answers waiting to
disagree.

**"This repository" excludes a checkout nested inside it, and that is what makes the refusal
survivable here.** Agents in this project work in `git worktree`s created *under* the
repository directory, so from the main checkout the repo-wide walk finds one index per
worktree plus its own — eleven when this was measured — and `check:naming` exited 2 on every
local run while CI stayed green, which is to say it became unrunnable exactly where
verification happens. Pruning a nested work tree is not a weakening of the refusal: another
commit of this same repository is not this one's source, so scanning it means judging another
branch's tree and reporting the verdict as ours. **The discriminator is the `.git` entry**,
derived per run and never a path name — a rule keyed on `.claude/worktrees` would be a derived
fact written down (D-100) and would miss the first worktree somebody put elsewhere.
`git worktree list --porcelain` was the alternative and was rejected: the walk sees files, and
the `.git` marker travels with them while git's registry can disagree with the filesystem in
both directions; the registry knows nothing of a nested clone or a submodule; and it needs
`git` on `PATH`, which a sourced library cannot assume. What it cannot see is stated in
`scripts/lib/module-root.sh` — a checkout whose marker is elsewhere (`GIT_DIR`, a
`--separate-git-dir` whose gitfile is gone) reads as ordinary source and is walked, which is
the direction to be wrong in. Two generated manifest indexes in one checkout are still exit 2,
and `shell-checks.test.ts` proves both halves over real fixture trees.

