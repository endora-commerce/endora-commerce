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
# Source it, do not execute it:
#   source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/module-root.sh"

# Directories that are not this repository's source, and would either slow the
# walk to no purpose or answer with somebody else's copy of the index.
MODULE_ROOT_PRUNED_DIRECTORIES=(node_modules .git dist build .next .docusaurus)

# Every generated manifest index in the repository, one per line.
#
# Repo-wide rather than under a named source root on purpose: the layout move
# F4 performs is exactly the event this function exists for, and a search rooted
# at `backend/src` would answer "gone" for a tree that merely moved one level
# up. Measured at 28 ms on this repository with the prunes above.
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
