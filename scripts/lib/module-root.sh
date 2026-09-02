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
# What it derives from is the generated manifest index. The generator emits one
# and every other check already takes its expected population from it, so it is
# the one artefact that answers "which modules exist" wherever they live. A
# repository that holds no index, or two of them, is refused rather than judged:
# an ambiguous root would silently narrow the scan to whichever one sorted first.
#
# **It answers with a list of module directories, not with one root** (feature
# 080, T040a). Two things changed under it and neither is cosmetic. The index is
# found by **name** rather than at `<root>/_lifecycle/manifest-index.generated.ts`,
# because the owner's ruling of 2026-08-22 moves it to the host's own source root
# once modules are packages — it is bare core by D-104 and it enumerates its
# siblings, and a publishable package naming all of them is a cycle waiting to be
# declared. And the root is no longer the index's grandparent, because under
# `packages/modules/<id>/src/` that grandparent is **one module** rather than the
# tree. So each module's own directory is resolved instead: the ancestor of a
# `manifest.ts` whose name is a registered id. A caller that wants "every module
# folder" iterates the list; a caller that wants "the tree" no longer has a
# single answer to want, which is the whole of what T040a establishes.
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
    -type f -name 'manifest-index.generated.ts' -print 2>/dev/null |
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

# Every module id the generated index registers, one per line.
#
# Read off the entry array — `{ id: 'orders', manifest: manifest42 },` — rather
# than off the import specifiers above it. The specifiers are relative today and
# become bare package names the moment a module ships as one, so a reader keyed
# on them answers "no module" for exactly the layout this file exists to follow.
# The entry array is what the generator emits in both cases.
module_root_registered_ids() {
  local index="$1"
  [ -f "$index" ] || return 1
  perl -ne "print \"\$1\n\" if m{\{\s*id:\s*'([A-Za-z0-9_]+)'\s*,\s*manifest:}" "$index" |
    sort -u
}

# Every module's **own directory**, one per line, repository-relative.
#
# A module directory is the ancestor of a `manifest.ts` whose name is a
# registered id: `backend/src/modules/orders` today, `packages/modules/blog` for
# one that has become a package. Both halves of the predicate are load-bearing.
# The id filter is what keeps a per-deployment overlay module out — an overlay is
# discovered at runtime and is absent from the bare-core index (D-104), and these
# rules are about the shared core tree. It also keeps the test fixtures'
# module-shaped directories out. The `manifest.ts` anchor is what keeps a
# directory that merely shares a module's name out; `backend/test/unit/orders` is
# not a module.
#
# One walk of the whole repository, pruned and with nested checkouts dropped, for
# the same reason `module_root_indexes` walks it: the layout move is the event
# this file exists for, and a search rooted at a named directory answers "gone"
# for a tree that merely moved.
module_root_module_directories() {
  local index="$1"
  local ids source_root prune=() directory
  ids="$(module_root_registered_ids "$index")" || return 1
  [ -n "$ids" ] || return 1
  source_root="$(module_root_source_root "$index")" || return 1
  for directory in "${MODULE_ROOT_PRUNED_DIRECTORIES[@]}"; do
    prune+=(-name "$directory" -o)
  done
  unset 'prune[${#prune[@]}-1]'
  find . \( "${prune[@]}" \) -prune -o -type f -name 'manifest.ts' -print 2>/dev/null |
    sed 's|^\./||' |
    module_root_drop_nested_checkouts |
    awk -v ids="$ids" '
      BEGIN { total = split(ids, id, "\n"); for (i = 1; i <= total; i++) registered[id[i]] = 1 }
      {
        depth = split($0, segment, "/")
        # The file itself is the last segment; a module directory is one of the
        # directories above it, and the outermost match wins, so a module whose
        # own sources hold a directory named after another module cannot
        # re-attribute it.
        for (i = 1; i < depth; i++) {
          if (!(segment[i] in registered)) continue
          path = segment[1]
          for (j = 2; j <= i; j++) path = path "/" segment[j]
          print path
          break
        }
      }
    ' |
    sort -u |
    while IFS= read -r directory; do
      # Two admissible homes, and nothing else. Under the application's own
      # source root, which is where a core module lives; or holding a
      # `package.json`, which is a workspace member and therefore a module that
      # has become a package. Everything else that carries a `<id>/manifest.ts`
      # is a fixture — `backend/test/fixtures/manifests/basic-graph/blog` is
      # three of them — and judging one means reporting a verdict about a
      # deliberately malformed tree as if it were this repository's.
      case "$directory" in
        "$source_root"/*)
          printf '%s\n' "$directory"
          ;;
        *)
          if [ -f "$directory/package.json" ]; then
            printf '%s\n' "$directory"
          fi
          ;;
      esac
    done
  # The second pass: a module whose sources a **workspace member** owns
  # directly, rather than a modules root or a package of its own (feature 080,
  # T040b and D-160.11). `_lifecycle` is one, and it is the only one: it is the
  # platform's operator half, so it never became `@endora-commerce/mod-lifecycle`
  # the way the other 66 modules did. Its directory is deliberately not named
  # after its module id, because a directory named after a registered id
  # directly under a source root would make that source root itself a module
  # root and every file beside it — `kernel`, `db`, `http` — a module's. So the
  # id is read out of the manifest instead of off the directory, which is the
  # same thing `scripts/lib/module-roots.ts` does.
  #
  # **Every member's `src/`, not only the application's.** D-160.11's second
  # half moved `_lifecycle` from `backend/src/lifecycle/` into
  # `packages/platform/src/lifecycle/`, and a pass rooted at the application
  # alone stopped finding it — not loudly: the expected population fell from 67
  # to 66 and the coverage token went on reading `66/66`, which is a module
  # leaving every shell rule with nothing to say about it and a green tick over
  # the remainder. That is issue #215's silence one layer in, so the root is
  # derived from the workspace rather than from the index's own location.
  # A member is recognised by its `package.json`, the file that makes a
  # directory a workspace member; the `src/*/manifest.ts` shape is what keeps a
  # module package's own `src/manifest.ts` and every fixture tree out.
  local member
  while IFS= read -r member; do
    for candidate in "$member"/src/*/manifest.ts; do
      [ -f "$candidate" ] || continue
      directory="$(dirname "$candidate")"
      declared="$(perl -0777 -ne "print \$1 if m{defineModuleManifest\(\{[\s\S]*?\bid:\s*'([A-Za-z0-9_]+)'}" "$candidate")"
      [ -n "$declared" ] || continue
      printf '%s\n' "$ids" | grep -qx "$declared" || continue
      # Already listed by the id-named pass above? Then it is an ordinary module.
      [ "$(basename "$directory")" = "$declared" ] && continue
      printf '%s\n' "$directory"
    done
  done <<EOF
$(module_root_workspace_members)
EOF
  return 0
}

# Every workspace member's directory, one per line, repository-relative.
#
# Derived the same way `module_root_source_root` recognises the application's:
# a `package.json` is what makes a directory a workspace member, and it is the
# only marker that travels with the layout. `pnpm-workspace.yaml` is the other
# candidate and was not taken — its globs need expanding, a flow-style list
# reads as none, and this library may not assume a node toolchain.
module_root_workspace_members() {
  local prune=() directory
  for directory in "${MODULE_ROOT_PRUNED_DIRECTORIES[@]}"; do
    prune+=(-name "$directory" -o)
  done
  unset 'prune[${#prune[@]}-1]'
  find . \( "${prune[@]}" \) -prune -o -type f -name 'package.json' -print 2>/dev/null |
    sed 's|^\./||; s|/package\.json$||' |
    grep -v '^package\.json$' |
    module_root_drop_nested_checkouts |
    sort -u
}

# Every directory that sits **where a module sits**, one per line.
#
# The module-folder rule judges names, so its population cannot be "the modules
# the index registers": a folder that is misnamed, or that has not been through
# `composer:generate` yet, is exactly the one the rule exists to catch and is
# exactly the one the index does not list. So the roots are derived from the
# resolved module directories — each one's parent — and every immediate child of
# a root is a candidate, registered or not. On a tree with one root that is
# `backend/src/modules/*`, which is what the rule always iterated; on a split
# tree it is that plus each package root's own children.
module_root_module_folders() {
  local index="$1"
  local dirs ids roots root
  dirs="$(module_root_module_directories "$index")" || return 1
  [ -n "$dirs" ] || return 1
  ids="$(module_root_registered_ids "$index")" || return 1
  # Only a directory **named** after a registered module contributes a root.
  # A host-resident module's is not (feature 080, T040b), and taking its parent
  # would make the application's source root a module root: every directory
  # beside it — `kernel`, `db`, `http`, `apps` — would then be judged as a
  # module folder name by a rule that is about module folders.
  roots="$(printf '%s\n' "$dirs" |
    while IFS= read -r directory; do
      printf '%s\n' "$ids" | grep -qx "$(basename "$directory")" || continue
      dirname "$directory"
    done | sort -u)"
  printf '%s\n' "$roots" | while IFS= read -r root; do
    [ -d "$root" ] || continue
    find "$root" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sed 's|^\./||'
  done | sort -u
}

# The application's source root — where the index sits, one level below the
# workspace member holding it.
#
# `backend/src/modules/_lifecycle/manifest-index.generated.ts` and
# `backend/src/manifest-index.generated.ts` both answer `backend/src`, which is
# what makes the owner's ruling about where the index lives a change this
# derivation does not have to be told about. The member is recognised by its
# `package.json` rather than by a name: that is the file that makes a directory
# a workspace member, and it is the only marker that travels with the layout.
module_root_source_root() {
  local index="$1"
  local cursor parent
  cursor="$(dirname "$index")"
  while [ "$cursor" != "." ] && [ "$cursor" != "/" ]; do
    parent="$(dirname "$cursor")"
    if [ -f "$parent/package.json" ]; then
      printf '%s\n' "$cursor"
      return 0
    fi
    cursor="$parent"
  done
  return 1
}
