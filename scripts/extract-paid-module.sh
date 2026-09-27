#!/usr/bin/env bash
#
# One paid module leaves this repository: steps **E3, E4, E7 and E8** of
# `specs/134-paid-module-extraction/contracts/extraction-procedure.md`, performed by a script
# rather than by hand.
#
#   bash scripts/extract-paid-module.sh <module-id> [--out <dir>] [--dry-run]
#
# §4 of that contract asks for this script by name and says what it is for: *"one script,
# written while doing wave 1's first module, in this repository: takes a module id, performs the
# move, the drops and the regeneration, and refuses if W1 or W2 is incomplete. One-way and
# idempotent."* It was written while extracting `inpost` (T035) and is T036's instrument.
#
# ## What it does NOT do, and this is the honest half
#
# Five of E1…E12 are **not** here, because each needs a judgement a script cannot make:
#
#   E1  the `endora check` baseline — one command, but the artefact has to be read and committed,
#       and it must be taken at the commit the package **leaves in** rather than at the branch
#       point. Wave 1 took it early and 13 of its read lines then described a package one layer
#       smaller than the one that left, which would have handed E12 step 4 thirteen differences
#       that were not the move's
#   E2  reading the module's ledger shards — a `migration-foreign-writes` shard means STOP
#   E5  the vendor contract module — every consumer of its symbols has to be re-pointed
#   E9  classifying every remaining occurrence as prose or coupling
#   E10 re-deriving what is derived about the tree, read sizes included
#
# §4 prices the residual per-module cost at *"E1, E2, E5, E9 and reading E12's output: roughly
# half a day, and E9 is most of it"*. That is the number this script leaves alone.
#
# ## Idempotence, and what that means for a half-finished run
#
# Every step is a no-op when it has already happened: no **tracked** file under the package, an
# absent dependency line and an already-clean generated artefact are all success. So a run
# interrupted anywhere can be re-run. What it is **not** is reversible — `git` is the undo, which
# is why it refuses a dirty working tree.
#
# ## The refusals
#
#   * a dirty working tree (there is no undo but `git`)
#   * nothing tracked under `packages/modules/<id>/` — which is an exit **0**, not a refusal:
#     the module is already out, and a second run over the same module is how that path is
#     exercised
#   * **W2**: a test of this module still under `backend/test/` or `admin/test/` that is not
#     the host's. The backend half is **asked of `check:test-ownership`** and not re-derived
#     here (W2.1, D-262 clause 1): a file it calls the host's is the host's here too — its
#     presence is expected and it is the operator's job to move it to the paid repository's
#     `host/backend/test/modules/<id>/` — and a file it calls the module's is a test with no
#     harness in the repository it is about to land in, in the merge request that is also
#     moving the code, where the two failures are indistinguishable. The admin half is the
#     files under `admin/test/` naming the module by **specifier**, in either spelling; each
#     is dispositioned by subject under W2.2 and most of it moves into the package
#   * **W1**: a *free* package still naming this module in code that runs. Comments are prose and
#     are left in place deliberately (E9, D-247); a specifier is coupling — and so is a
#     composition root naming the module by its camelCase id (`scripts/lib/w1-root-names.sh`,
#     contract W1.1, T125)
#   * a `migration-foreign-writes` shard for this module (E2 / W7: a paid module writing a free
#     module's table after the split is a cross-repository schema dependency with no owner)
#   * **E3p**, and this one is the export's own completeness: a path of this history carrying the
#     module's id that the resolved path set did not carry and no standing or E3p.2 disposition covers.
#     The path set is **resolved, never enumerated** (D-263, refusal 14) — see
#     `backend/scripts/derive-extraction-path-set.ts` and the E3p section below
#
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$REPO_ROOT"

MODULE_ID=""
OUT=""
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,63p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) printf 'unknown option: %s\n' "$1" >&2; exit 2 ;;
    *) MODULE_ID="$1"; shift ;;
  esac
done

if [ -z "$MODULE_ID" ]; then
  printf 'usage: bash scripts/extract-paid-module.sh <module-id> [--out <dir>] [--dry-run]\n' >&2
  exit 2
fi

PKG="packages/modules/$MODULE_ID"
OUT=${OUT:-"$(dirname "$REPO_ROOT")/extracted-$MODULE_ID"}

say() { printf '[extract:%s] %s\n' "$MODULE_ID" "$1"; }
die() { printf '[extract:%s] REFUSED — %s\n' "$MODULE_ID" "$1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preconditions
# ---------------------------------------------------------------------------

[ -n "$(git status --porcelain)" ] && die "the working tree is dirty. This script's undo is \`git\`, and it cannot be told your changes from its own."

# **Tracked presence, not the directory.** `git rm -r` leaves the directory standing, because
# `dist/` and `node_modules/` inside it are ignored and untracked — so a `-d` test reports an
# extracted module as still present, and E7's `git rm` then dies with *"pathspec does not match any
# files"*. Measured by running this script twice.
if [ -z "$(git ls-files -- "$PKG")" ]; then
  say "no tracked file under $PKG — already extracted, or never a package here. Nothing to do."
  if [ -d "$PKG" ]; then
    say "  ($PKG still exists on disk: its ignored dist/ and node_modules/ survive a \`git rm\`.)"
  fi
  exit 0
fi

# E2 / W7. A shard here is a design question, never a step.
FOREIGN_WRITES="backend/scripts/ledgers/migration-foreign-writes/$MODULE_ID.ts"
[ -f "$FOREIGN_WRITES" ] && die "$FOREIGN_WRITES exists. It records this module writing another module's table, and a paid module writing a free module's table across the split is a schema dependency with no owner. Design the repair first — \`contracts/foreign-write-repair.md\` is normative — and delete the shard in the same merge request as the repair, not as part of this move."

KEBAB=${MODULE_ID//_/-}

# W2 — **this step carries no predicate of its own** (W2.1, D-262 clause 1).
#
# It read `grep -E "/(<id>|<kebab>)/"` over `backend/test` and `admin/test` until 2026-09-21 —
# a path **segment** — and enumerated two call names of its own beside it. Both halves
# disagreed with `check:test-ownership`, which reads module **specifiers** and, until the same
# day, one call name: `backend/test/integration/pim_pimcore/delivered-record-column-parity.test.ts`
# was refused here as `pim_pimcore`'s and classified there as nobody's, while
# `admin/test/modules/pim-akeneo.module-owned-surface.test.tsx` was seen by neither, because it
# sits flat rather than in a per-module directory. Three files of one class, two verdicts,
# decided by a filename convention nothing enforces.
#
# So the backend half **asks the instrument**: one list, in one place, read by every instrument
# that asks the question (`module-test-ownership.md` §1). The admin half is the same predicate
# spelled for a tree the instrument does not walk — the module's specifier in either spelling,
# never a directory segment and never a filename prefix.
#
# And there is deliberately **no `≥ 2` carve-out** (D-262 clause 2): whether a two-owner file's
# subject is one module or the boundary between two is §1.1's question, it is put to a human,
# and mechanising it produced two wrong repairs in a row. Such a file is *reported* below and
# never decided.
say 'W2 — asking check:test-ownership which of this module'"'"'s backend tests are still here'
if ! LISTED=$(pnpm --filter backend exec tsx scripts/check-test-ownership.ts --list "$MODULE_ID" 2>/dev/null); then
  die "check:test-ownership could not answer for \`$MODULE_ID\`. It exits 2 when it cannot see the population it judges — a refusal, never an empty list — so W2 has no answer rather than a clean one. Run \`pnpm --filter backend exec tsx scripts/check-test-ownership.ts --list $MODULE_ID\` and read what it says."
fi

LEFTOVER=""
while IFS=' ' read -r tag f; do
  [ -z "${tag:-}" ] && continue
  case "$tag" in
    host)   say "  host file (D-252, expected): $f" ;;
    shared) say "  two-owner file (§1.1 — a judgement, not a predicate; disposition it by hand): $f" ;;
    *)      LEFTOVER="$LEFTOVER  $f"$'\n' ;;
  esac
done <<< "$LISTED"

say 'W2 — checking no admin test of this module is left under admin/test'
ADMIN_LEFTOVER=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  ADMIN_LEFTOVER="$ADMIN_LEFTOVER  $f"$'\n'
done < <(git grep -l -E "@endora-commerce/mod-${KEBAB}([^a-z0-9-]|\$)|packages/modules/${MODULE_ID}/" -- 'admin/test' | grep -E '\.test\.tsx?$' || true)

[ -n "$LEFTOVER" ] && die $'W2 is incomplete. `check:test-ownership` places these tests of this module inside its package:\n'"$LEFTOVER"$'A package extracted with its tests still here arrives in a repository that has no harness for them, in the merge request that is also moving the code, and the two failures are indistinguishable. Move them into packages/modules/'"$MODULE_ID"$'/src/** first (specs/109-backend-test-kit/ Phase 5).'

[ -n "$ADMIN_LEFTOVER" ] && die $'W2 is incomplete. These admin tests name this module by specifier:\n'"$ADMIN_LEFTOVER"$'Each is dispositioned by **subject** and not carried, moved wholesale or deleted (W2.2, D-262 clause 3): the module\'s declaration and its own source hygiene move into the package as co-located `.test.ts` under the existing `environment: \'node\'` config; the host-hygiene assertions about App.tsx, AppShell.tsx and modules.generated.ts stay here; the rendered off-state and permission cases are deleted only against a surviving free driver, named in the merge request (W2.3), with a `git show <sha>:<path>` recovery address for every deleted file.'

# W1. Deliberately narrow: a *specifier* naming the package, in a package that is not this one.
# A module id inside a comment is prose and is left in place (E9, D-247).
say 'W1 — checking no free package still resolves this module by specifier'
#
# Markdown is excluded because it is prose, whatever it quotes: 13 `packages/modules/*/CHANGELOG.md`
# files carry an old `import … from '@endora-commerce/mod-ksef/backend'` in fenced code and refused
# `ksef` here, while W1's own sentence is *"in code that runs"* (`research.md` D13 §7).
COUPLED=$(git grep -l -E "from '(@endora-commerce/mod-${KEBAB}|.*packages/modules/${MODULE_ID})" -- 'packages/*' ":(exclude)$PKG" ':(exclude)*.md' || true)
[ -n "$COUPLED" ] && die $'W1 is incomplete. These packages still resolve this module by specifier:\n'"$COUPLED"$'\nA free package naming a wave member in code that runs is W1\'s refusal verbatim.'

# W1, second gate: a composition root naming this module by its camelCase id — a value it
# registers, contributes or reads for a consumer that is about to live in another repository
# (contract W1.1, `research.md` D16 §5). No specifier is involved, so the gate above cannot see
# it. Scoped to the two roots on purpose; `scripts/lib/w1-root-names.sh` says why.
say 'W1 — checking no composition root names this module by its camelCase id'
# shellcheck source=lib/w1-root-names.sh
. "$REPO_ROOT/scripts/lib/w1-root-names.sh"
ROOT_NAMED=$(w1_root_name_hits "$MODULE_ID")
[ -n "$ROOT_NAMED" ] && die $'W1 is incomplete. A composition root names this module in code that runs:\n'"$ROOT_NAMED"$'\nMove the reader onto a module-agnostic platform value (`processRunsWorkers`, `resolvePublicApiBaseUrl()`), have the module register its own value, or have it supply its contribution from its own composition (contract W1.1) — then delete the root line. Removing a name the platform registers is a breaking platform release.'

# ---------------------------------------------------------------------------
# E3p — the path set, resolved over the history and never written down
# ---------------------------------------------------------------------------
#
# **The path set is resolved, never enumerated** (**E3p**, ruled by **D-263** on 2026-09-22;
# normative in `specs/134-paid-module-extraction/contracts/extraction-procedure.md`). This step
# named four roots and the vendor contract module until that day, and the enumeration was measured
# incomplete on **all fifteen** modules — the third root list this estate has measured incomplete,
# the third measurement being of the list written by the step that cites the second. Refusal 14
# now refuses an export taken from an enumerated list at all, which is why no root is named
# anywhere in this file.
#
# What made the shortfall invisible rather than merely present: `git log --diff-filter=R` **under
# a pathspec reports no inbound rename at all**, so the gap cannot be seen from inside the export,
# and the tip-level stray check below passes with it.
#
# `backend/scripts/derive-extraction-path-set.ts` is the whole of it — R1 over the manifests, R2
# over the rename closure, the ownership tie-break and the completeness refusal — and it prints
# what it resolved, what it refused and whose lineage it declined to carry. It runs **before** the
# dry-run exit, because the refusal is a precondition of the move and not a part of it.
#
# **E3p.2's reviewed per-path dispositions are passed unconditionally**, dry run or not, so that a
# green exploratory run cannot bypass the gate the real run enforces. The deriver validates every
# entry and prints each one it accepts; this file only names where they are.
say 'E3p — resolving the path set over the history'
command -v git-filter-repo >/dev/null 2>&1 || die 'git-filter-repo is not installed. `git subtree split` is the contract'"'"'s other option; a squashed import is refused (FR-015).'

# Outside the working tree on purpose: the file is a derived fact (D-100) and must never be
# committed, and a whole-tree walk that counted it would move a recorded read size.
PATHS_FILE=$(mktemp -t "endora-path-set-$MODULE_ID-XXXXXX")
DISPOSITIONS="$REPO_ROOT/specs/134-paid-module-extraction/e3p-historical-dispositions.json"
trap 'rm -f "$PATHS_FILE"' EXIT
if ! pnpm --filter backend exec tsx scripts/derive-extraction-path-set.ts "$MODULE_ID" \
  --ref HEAD --package "$PKG" --paths-file "$PATHS_FILE" --dispositions "$DISPOSITIONS"; then
  die $'E3p refused, and the paths are printed above. Each is a path of this history carrying `'"$MODULE_ID"$'` that the resolution did not carry and that no standing or reviewed disposition covers, or a reviewed disposition the deriver could not accept. Widen the resolution — for a live file, a rename-only move into the package (E3p.1) — or record the path as deliberately left through a reviewed entry in specs/134-paid-module-extraction/e3p-historical-dispositions.json (E3p.2). A note in the merge request no longer clears it: there is no default, because both answers are real and the wrong one is unrecoverable (E3p, refusal 14).'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  say 'dry run: the path set resolved and every refusal passed. Nothing was changed.'
  exit 0
fi

# ---------------------------------------------------------------------------
# E3 — the history, at the paid repository's path
# ---------------------------------------------------------------------------
say "E3 — exporting the package with its history into $OUT"
rm -rf "$OUT"
git clone --no-local --single-branch --branch "$(git branch --show-current)" . "$OUT" >/dev/null 2>&1
git -C "$OUT" filter-repo --force --paths-from-file "$PATHS_FILE" >/dev/null
say "E3 — $(git -C "$OUT" rev-list --count HEAD) commit(s), oldest $(git -C "$OUT" log --reverse --format=%ci HEAD | head -1)"
STRAY=$(git -C "$OUT" ls-tree -r --name-only HEAD | grep -v "^modules/$MODULE_ID/" || true)
[ -n "$STRAY" ] && die $'the export'"'"$'s tip holds files outside modules/'"$MODULE_ID"$'/:\n'"$STRAY"

# ---------------------------------------------------------------------------
# E4 — the ledger shards
# ---------------------------------------------------------------------------
#
# Two-way ledgers, so a shard left here after its subject goes fails the build as surely as an
# unledgered finding does. A shard whose entries describe the module's own code or its own pages
# travels; one whose entries describe a file under `backend/test/` does not, because that is not
# a concept in the repository it would travel to.
say 'E4 — the ledger shards'
mkdir -p "$OUT/modules/$MODULE_ID/ledgers"
for shard in backend/scripts/ledgers/*/"$MODULE_ID.ts"; do
  [ -f "$shard" ] || continue
  root=$(basename "$(dirname "$shard")")
  case "$root" in
    test-ownership)
      say "  $root: stays (its entries name files under backend/test/, which the paid repository has none of)"
      ;;
    *)
      cp "$shard" "$OUT/modules/$MODULE_ID/ledgers/$root.ts"
      say "  $root: carried to modules/$MODULE_ID/ledgers/$root.ts"
      ;;
  esac
  git rm -q "$shard"
done
rmdir "$OUT/modules/$MODULE_ID/ledgers" 2>/dev/null || true
if [ -d "$OUT/modules/$MODULE_ID/ledgers" ]; then
  say '  NOTE, and it is not automatable: each carried shard still imports a type from'
  say '  backend/scripts/, a path that does not exist there, and its entry keys still say'
  say '  packages/modules/. Inline the type and re-key before committing on the paid side.'
  git -C "$OUT" add -A
  git -C "$OUT" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
    commit -q -m "chore($MODULE_ID): E4 — the module's acknowledged debt travels with it"
fi

# ---------------------------------------------------------------------------
# E7 — drop the dependency, delete the package
# ---------------------------------------------------------------------------
say 'E7 — dropping the dependency and deleting the package'
for app in backend/package.json admin/package.json; do
  if grep -q "\"@endora-commerce/mod-$KEBAB\"" "$app"; then
    sed -i "/\"@endora-commerce\/mod-$KEBAB\": \"workspace:\*\",/d" "$app"
    say "  $app: dependency removed"
  fi
done
git rm -rq "$PKG"

# ---------------------------------------------------------------------------
# E8 — regenerate, do not edit
# ---------------------------------------------------------------------------
#
# `composer:generate` refuses a `module-reference/<id>.md` that no manifest renders, by design:
# *"a committed file this generator deleted is a change no reviewer asked for"*. So the page is
# removed here, before the generator runs, rather than swept by it.
say 'E8 — regenerating'
REFERENCE_PAGE="docs/docs/module-reference/$KEBAB.md"
[ -f "$REFERENCE_PAGE" ] && git rm -q "$REFERENCE_PAGE"
pnpm install >/dev/null
pnpm run build:packages >/dev/null
pnpm --filter backend run composer:generate >/dev/null
pnpm --filter backend run manifests:generate >/dev/null
pnpm install --lockfile-only >/dev/null
pnpm --filter backend run overlay:check >/dev/null || die 'overlay:check failed after regeneration. A generated artefact that is stale, missing, empty or `foreign` is a silent defect: an unregistered migration simply does not run.'
say 'E8 — regenerated, overlay:check green'

# ---------------------------------------------------------------------------
# What is left for a human
# ---------------------------------------------------------------------------
cat <<EOF

[extract:$MODULE_ID] done: E3, E4, E7, E8.

Still owed, and none of it is automatable (extraction-procedure.md §4):

  E1   commit the \`endora check\` baseline taken BEFORE this run —
       specs/134-paid-module-extraction/baselines/$MODULE_ID-endora-check.txt
  E2   read the module's ledger shards; a migration-foreign-writes shard is a STOP
  E5   the vendor contract module's consumers
  E9   classify every remaining occurrence of "$MODULE_ID" as prose or coupling:
         git grep -In '$MODULE_ID' | grep -v '^specs/'
  E10  re-derive what is derived about the tree — extraction-procedure.md names seven files,
       plus moved-module-tree.test.ts — and RE-MEASURE the read sizes on a pristine worktree
  E11  pnpm -r run typecheck && pnpm -r run lint, the targeted tests, check:naming,
       check:language, overlay:check, boot-gate
       ... and the CONTRACT and INTEGRATION trees, which no merge-request pipeline runs (D-198)
  ---  a changeset: this merge request changes what at least \`@endora-commerce/contracts\`
       publishes (specs/conventions/release-intent.md)

The history export is at $OUT. In the paid repository:

  git remote add $MODULE_ID-export $OUT
  git fetch $MODULE_ID-export
  git merge --allow-unrelated-histories $MODULE_ID-export/$(git -C "$OUT" branch --show-current)

EOF
