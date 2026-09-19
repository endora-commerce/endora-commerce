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
#   * **W2**: a test of this module still under `backend/test/` or `admin/test/` that is NOT
#     server-bound. A server-bound file is the **host's** under **D-252** — it composes from the
#     host's install — so its presence is expected and is not a W2 failure; it is the operator's
#     job to move it to the paid repository's `host/backend/test/modules/<id>/`. Anything else is
#     a test with no harness in the repository it is about to land in, in the merge request that
#     is also moving the code, and the two failures are indistinguishable
#   * **W1**: a *free* package still naming this module in code that runs. Comments are prose and
#     are left in place deliberately (E9, D-247); a specifier is coupling
#   * a `migration-foreign-writes` shard for this module (E2 / W7: a paid module writing a free
#     module's table after the split is a cross-repository schema dependency with no owner)
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
    -h|--help) sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# W2, with D-252's carve-out. `composesServer` is read as a literal call node, which is the
# predicate `check:test-ownership`, `check:harness-teardown` and `check:fixture-substitution`
# already key on — so the two sides of the boundary cannot disagree.
say 'W2 — checking no harness-free test of this module is left under backend/test or admin/test'
LEFTOVER=""
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if grep -q 'setupBackendServer(\|composeTestServer(' "$f"; then
    say "  host file (D-252, expected): $f"
  else
    LEFTOVER="$LEFTOVER  $f"$'\n'
  fi
done < <(git ls-files 'backend/test' 'admin/test' | grep -E "/(${MODULE_ID}|${MODULE_ID//_/-})/.*\.test\.tsx?$" || true)

[ -n "$LEFTOVER" ] && die $'W2 is incomplete. These are harness-free tests of this module still under the application test trees:\n'"$LEFTOVER"$'A package extracted with its tests still here arrives in a repository that has no harness for them, in the merge request that is also moving the code, and the two failures are indistinguishable. Move them into packages/modules/'"$MODULE_ID"$'/src/** first (specs/109-backend-test-kit/ Phase 5).'

# W1. Deliberately narrow: a *specifier* naming the package, in a package that is not this one.
# A module id inside a comment is prose and is left in place (E9, D-247).
say 'W1 — checking no free package still resolves this module by specifier'
KEBAB=${MODULE_ID//_/-}
COUPLED=$(git grep -l -E "from '(@endora-commerce/mod-${KEBAB}|.*packages/modules/${MODULE_ID})" -- 'packages/*' ":(exclude)$PKG" || true)
[ -n "$COUPLED" ] && die $'W1 is incomplete. These packages still resolve this module by specifier:\n'"$COUPLED"$'\nA free package naming a wave member in code that runs is W1\'s refusal verbatim.'

if [ "$DRY_RUN" -eq 1 ]; then
  say 'dry run: every refusal passed. Nothing was changed.'
  exit 0
fi

# ---------------------------------------------------------------------------
# E3 — the history, at the paid repository's path
# ---------------------------------------------------------------------------
#
# **Four roots are derived, not one.** `--path packages/modules/<id>/` alone carries only the
# history since the packaging migration, because that migration moved these modules by
# **rename** and a single-path filter does not follow one. `inpost` measured 50 commits that way,
# oldest eight days after the module was written. The roots below are derived the way §3 derives
# the publication filter's: over the history, never over the tip.
say "E3 — exporting the package with its history into $OUT"
command -v git-filter-repo >/dev/null 2>&1 || die 'git-filter-repo is not installed. `git subtree split` is the contract'"'"'s other option; a squashed import is refused (FR-015).'

HISTORICAL_ROOTS=()
for root in \
  "$PKG/" \
  "backend/src/modules/$MODULE_ID/" \
  "admin/src/modules/$MODULE_ID/" \
  "admin/src/modules/$KEBAB/"
do
  if git log --oneline --all -1 -- "$root" | grep -q .; then HISTORICAL_ROOTS+=("$root"); fi
done
VENDOR_CONTRACTS=""
for candidate in "packages/contracts/src/$MODULE_ID.ts" "packages/contracts/src/$KEBAB.ts"; do
  if git log --oneline --all -1 -- "$candidate" | grep -q .; then VENDOR_CONTRACTS="$candidate"; fi
done

FILTER_ARGS=()
for root in "${HISTORICAL_ROOTS[@]}"; do FILTER_ARGS+=(--path "$root"); done
[ -n "$VENDOR_CONTRACTS" ] && FILTER_ARGS+=(--path "$VENDOR_CONTRACTS")
# `--path-rename` is order-sensitive: the longest source first, or a shorter prefix eats it.
[ -n "$VENDOR_CONTRACTS" ] && FILTER_ARGS+=(--path-rename "$VENDOR_CONTRACTS:modules/$MODULE_ID/src/contracts/index.ts")
FILTER_ARGS+=(--path-rename "admin/src/modules/$MODULE_ID/:modules/$MODULE_ID/src/admin/")
FILTER_ARGS+=(--path-rename "admin/src/modules/$KEBAB/:modules/$MODULE_ID/src/admin/")
FILTER_ARGS+=(--path-rename "backend/src/modules/$MODULE_ID/:modules/$MODULE_ID/")
FILTER_ARGS+=(--path-rename "$PKG/:modules/$MODULE_ID/")

rm -rf "$OUT"
git clone --no-local --single-branch --branch "$(git branch --show-current)" . "$OUT" >/dev/null 2>&1
git -C "$OUT" filter-repo --force "${FILTER_ARGS[@]}" >/dev/null
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
