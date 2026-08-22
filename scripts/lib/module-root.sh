#!/usr/bin/env bash
# "Where does this repository keep its backend modules?" — one derivation, in
# shell (issue #215; feature 080, T012).
#
# `backend/scripts/lib/module-population.ts` is the same question for the
# fourteen tsx checks. This is the half `quality:static` can run: bash, grep,
# perl and POSIX awk, no `pnpm install`, no node toolchain — the same constraint
# `lib/read-size.sh` is written under, and the same house pattern.
#
# The root is **derived, never spelled**. `scripts/check-naming.sh` used to
# write `backend/src/modules` in eight places and to treat the directory not
# being there as an empty listing, which is precisely the shape issue #215
# measured: 93% of the tree lives under that path, so a module tree that moves
# leaves the other rules reading the residue and the script printing a green
# tick over a repository whose modules it never found.
#
# What it derives from is the generated manifest index. That file lives *inside*
# the module tree (`<root>/_lifecycle/manifest-index.generated.ts`), the
# generator emits it there and nowhere else, and every other check already takes
# its expected population from it — so the tree cannot move without taking the
# index along, and the root is the index's grandparent. A repository that holds
# no index, or two of them, is refused rather than judged: an ambiguous root
# would silently narrow the scan to whichever one sorted first.
#
# "In this repository" excludes a nested checkout — see the block below, which
# is what keeps that refusal from firing on every local run of a project whose
# agents work in `git worktree`s created inside the repository directory.
#
# Source it, do not execute it:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/module-root.sh"

# Directories that are not this repository's source, and would either slow the
# walk to no purpose or answer with somebody else's copy of the index.
MODULE_ROOT_PRUNED_DIRECTORIES=(node_modules .git dist build .next .docusaurus)

# ── Nested checkouts ──────────────────────────────────────────────────────
#
# A directory that is itself the root of a git checkout is **not** this
# repository's source, and everything under it is dropped from every walk here.
#
# Why it has to be: this project runs its agents in `git worktree`s created
# *inside* the repository directory, so on any machine where work is happening
# the repo-wide walk below finds one index per worktree plus the checkout's own
# — eleven of them when this was measured — and the refusal further down fired
# on every local run. The refusal is right; the population was not. A nested
# work tree is another commit of this same repository, so scanning it means
# judging another branch's tree and reporting the verdict as this one's, which
# is precisely the harm the refusal names. Pruning it therefore *removes* an
# ambiguity rather than resolving one by guessing, and two genuine module roots
# in one checkout are refused exactly as before.
#
# **The discriminator is the `.git` entry, not a path name.** A rule keyed on
# `.claude/worktrees` would be a derived fact written down (D-100) and would
# stop working the moment somebody put a worktree elsewhere. The alternative
# signal was `git worktree list --porcelain`, git's own registry, and it was
# rejected for three reasons: the walk sees *files*, and the `.git` marker
# travels with them while the registry can disagree with the filesystem in both
# directions — a worktree whose administrative directory has been swept still
# has its marker and its files, and would come back as an ambiguity; the
# registry knows only worktrees, so a nested clone or a submodule would still
# be scanned; and it needs `git` on `PATH`, which a library sourced by any
# script cannot assume. `.git` is also the thing git itself keys on: a nested
# checkout carrying it is reported by `git ls-files --others` as one directory
# entry rather than as its contents.
#
# **What it cannot see**, stated rather than discovered later: a checkout whose
# marker is somewhere else — `GIT_DIR` in the environment, a `--separate-git-dir`
# whose gitfile has been removed, a tree exported without its `.git` — reads as
# ordinary source and is walked. That is the direction to be wrong in: such a
# tree is indistinguishable from a copied directory, and treating it as source
# reports an ambiguity rather than silently narrowing the scan.

# The root of every nested checkout, one per line, repository-relative.
#
# `.git` stays in the prune list for the index walk and is taken out of this
# one: pruning it there is what keeps the object store out of the search, and
# printing it here is the whole point. The checkout's *own* `.git` is stepped
# over by name — the repository root is where the walk starts, so its marker
# says nothing about a nested tree.
module_root_scan_nested_checkouts() {
  local prune=()
  local directory
  for directory in "${MODULE_ROOT_PRUNED_DIRECTORIES[@]}"; do
    if [ "$directory" = ".git" ]; then
      continue
    fi
    prune+=(-name "$directory" -o)
  done
  unset 'prune[${#prune[@]}-1]'
  find . -path ./.git -prune -o \( "${prune[@]}" \) -prune -o \
    -name .git -print -prune 2>/dev/null |
    sed 's|^\./||; s|/\.git$||' |
    sort -u
}

# The same answer, resolved once.
#
# A pipeline stage runs in a subshell, so a memo written inside the filter below
# would not survive to its next caller. A script that walks more than once calls
# this at its own top level instead; one that does not gets the scan on demand
# and pays for it twice, which is a slower run rather than a different answer.
module_root_resolve_nested_checkouts() {
  MODULE_ROOT_NESTED_CHECKOUTS="$(module_root_scan_nested_checkouts)"
}

module_root_nested_checkouts() {
  if [ "${MODULE_ROOT_NESTED_CHECKOUTS+set}" = set ]; then
    printf '%s\n' "$MODULE_ROOT_NESTED_CHECKOUTS"
    return 0
  fi
  module_root_scan_nested_checkouts
}

# Drops every stdin line that names a path inside a nested checkout.
#
# POSIX awk with `index(…) == 1` rather than `grep`: the roots are literal
# paths, and a regex built from one would need every `.` escaped — the one that
# got away would match more than it was asked to. The trailing separator is what
# makes `vendor/fork` not match `vendor/fork-of-ours`, and what lets a listing's
# bare directory entry (`vendor/fork/`) match its own root.
module_root_drop_nested_checkouts() {
  local roots
  roots="$(module_root_nested_checkouts)"
  if [ -z "$roots" ]; then
    cat
    return 0
  fi
  awk -v roots="$roots" '
    BEGIN { total = split(roots, root, "\n") }
    {
      for (i = 1; i <= total; i++) {
        if (length(root[i]) > 0 && index($0, root[i] "/") == 1) next
      }
      print
    }
  '
}

# Every generated manifest index this repository owns, one per line.
#
# Repo-wide rather than under a named source root on purpose: the layout move
# F4 performs is exactly the event this function exists for, and a search rooted
# at `backend/src` would answer "gone" for a tree that merely moved one level
# up. Measured at 28 ms on a clean checkout with the prunes above, 154 ms on a
# working machine holding ten nested work trees.
module_root_indexes() {
  local prune=()
  local directory
  for directory in "${MODULE_ROOT_PRUNED_DIRECTORIES[@]}"; do
    prune+=(-name "$directory" -o)
  done
  # Drop the trailing `-o`, then wrap the alternation for `-prune`.
  unset 'prune[${#prune[@]}-1]'
  find . \( "${prune[@]}" \) -prune -o \
    -type f -name 'manifest-index.generated.ts' -path '*/_lifecycle/*' -print 2>/dev/null |
    sed 's|^\./||' |
    module_root_drop_nested_checkouts |
    sort
}

# The generated manifest index, or a refusal.
#
#   stdout — the path, relative to the repository root
#   exit 0 — exactly one index resolved
#   exit 1 — none: the module tree is not where anything can find it
#   exit 2 — more than one: the root is ambiguous, and picking one narrows the
#            scan to it without saying so
#
# The caller turns 1 and 2 into `exit 2` with a message of its own, in the idiom
# `read_size_registered_modules` uses: a library that exits cannot be tested,
# and a refusal without a sentence cannot be acted on.
module_root_manifest_index() {
  local found count
  found="$(module_root_indexes)"
  count="$(printf '%s\n' "$found" | grep -c '[^[:space:]]' || true)"
  if [ "$count" -eq 0 ]; then
    return 1
  fi
  if [ "$count" -gt 1 ]; then
    printf '%s\n' "$found"
    return 2
  fi
  printf '%s\n' "$found"
}

# The module root itself: the index's grandparent, e.g. `backend/src/modules`.
#
# Takes the index path so the caller resolves it once and uses both halves —
# the root for its walks, the index for the population it reconciles them
# against. Two resolutions would be two chances to disagree.
module_root_of_index() {
  local index="$1"
  local modules_dir
  modules_dir="$(dirname "$(dirname "$index")")"
  printf '%s\n' "${modules_dir#./}"
}
