#!/usr/bin/env bash
#
# Stand a `git worktree` of this repository up so that it measures **itself**
# (issue #255).
#
# Every package under `packages/` resolves through its own `exports` map at
# `./dist`, built from the checkout it lives in — and *which* checkout is decided
# by `backend/node_modules/@endora-commerce/contracts -> ../../../packages/contracts`, a
# **relative** link. Symlink a workspace's `node_modules` at another checkout
# and every one of those links re-roots there: `vitest` then compiles and runs
# the other branch while the run claims to be about this one. Measured: 16 of
# 16 links, silently, with `pnpm ls` still reporting this worktree's path.
#
# Two wirings, both correct, and the default is the boring one:
#
#   bash scripts/setup-worktree.sh            # pnpm install --frozen-lockfile
#   bash scripts/setup-worktree.sh --link     # share the source checkout's store
#
# **Prefer the default.** On a worktree that sits on the same filesystem as the
# pnpm store it takes about 4 s and costs almost no disk, because every file in
# `node_modules/.pnpm` is a hard link into that store — measured on this
# repository: 2055 packages, `Done in 4s`, the same inode as the main tree's
# copy. "A full install is slow" is why worktrees got symlinked here, and on
# this machine it is not true.
#
# `--link` is for the case where it *is* true: a worktree on a different
# filesystem from the store (a tmpfs scratchpad, a container mount), where pnpm
# cannot hard-link and an install materialises 1.3 GB. It symlinks the **root**
# `node_modules` — which holds only third-party packages, identical on every
# branch — and copies each workspace's own `node_modules` with `cp -a`, so the
# relative `@endora-commerce/*` links inside them re-root *here*. About 0.2 s.
#
# Two things `--link` borrows that it cannot verify, both stated here rather
# than discovered later. It refuses a `pnpm-lock.yaml` that differs from the
# source checkout's, but a lockfile is not an install: the source's
# `node_modules` can be *behind its own lockfile*, and the symptom is a binary
# that is simply not in `node_modules/.bin` (`changeset`, on this machine,
# today). And with the root `node_modules` symlinked, **`pnpm install` run in
# this worktree writes into the source checkout** — so when something is
# missing, delete the symlink first and re-run this script without `--link`.
#
# Either way the script finishes by asking the guard in
# `scripts/workspace-resolution.ts` whether the wiring worked, so it cannot
# report success over a tree it did not actually fix.

set -euo pipefail

MODE="install"
case "${1:-}" in
  "") ;;
  --link) MODE="link" ;;
  --install) MODE="install" ;;
  -h | --help)
    sed -n '2,40p' "$0"
    exit 0
    ;;
  *)
    echo "setup-worktree: unknown argument '$1' (expected --install or --link)" >&2
    exit 2
    ;;
esac

# The worktree we are wiring: the checkout this script belongs to, not $PWD.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -f "$HERE/pnpm-workspace.yaml" ]; then
  echo "setup-worktree: $HERE is not a checkout of this repository." >&2
  exit 2
fi

# The workspaces whose `node_modules` carries `@endora-commerce/*` links. Derived from the
# tree, so a sixth package needs no edit here.
workspaces() {
  local dir
  for dir in "$HERE"/*/ "$HERE"/packages/*/; do
    [ -f "${dir}package.json" ] || continue
    printf '%s\n' "${dir%/}"
  done
}

if [ "$MODE" = "install" ]; then
  echo "setup-worktree: pnpm install --frozen-lockfile in $HERE"
  (cd "$HERE" && pnpm install --frozen-lockfile)
else
  # The checkout that owns the shared `.git` — the main worktree, and the one
  # whose `node_modules` a `git worktree` here can borrow.
  COMMON_DIR="$(cd "$HERE" && git rev-parse --path-format=absolute --git-common-dir)"
  SOURCE="$(dirname "$COMMON_DIR")"

  if [ "$SOURCE" = "$HERE" ]; then
    echo "setup-worktree: $HERE is the main checkout — there is nothing to link from." >&2
    echo "setup-worktree: run without --link." >&2
    exit 2
  fi
  if [ ! -d "$SOURCE/node_modules/.pnpm" ]; then
    echo "setup-worktree: $SOURCE has no installed store to share." >&2
    echo "setup-worktree: install there first, or run this without --link." >&2
    exit 2
  fi
  if ! cmp -s "$HERE/pnpm-lock.yaml" "$SOURCE/pnpm-lock.yaml"; then
    echo "setup-worktree: pnpm-lock.yaml differs from $SOURCE — sharing its store would" >&2
    echo "setup-worktree: give this branch another branch's dependency versions." >&2
    echo "setup-worktree: run without --link." >&2
    exit 2
  fi

  echo "setup-worktree: sharing the store at $SOURCE"
  ln -sfn "$SOURCE/node_modules" "$HERE/node_modules"
  while read -r dir; do
    name="${dir#"$HERE"/}"
    [ -d "$SOURCE/$name/node_modules" ] || continue
    rm -rf "${dir:?}/node_modules"
    # `cp -a` keeps every link a link. That is the whole trick: the `@endora-commerce/*`
    # entries are relative, so copied here they point at *this* worktree's
    # `packages/`, while the third-party entries keep pointing at the shared
    # root store.
    cp -a "$SOURCE/$name/node_modules" "$dir/node_modules"
  done < <(workspaces)
fi

# The guard below resolves through `@endora-commerce/cli`'s **`dist`**
# (`scripts/workspace-resolution.ts` -> `backend/scripts/lib/workspace-packages.ts` ->
# `export * from '@endora-commerce/cli/lib/workspace-packages.js'`), and a fresh checkout has no
# `dist` at all until something builds it. Without this line the script died with a bare
# `ERR_MODULE_NOT_FOUND` stack trace **after a completely successful install** — exit 1 over a tree
# it had just set up correctly, which is the inverse of the property its own header claims. It is
# the documented one-command onboarding step, so every worktree in this project started with a
# failure nobody could act on, and a caller chaining `setup-worktree.sh && …` silently skipped
# whatever came next.
#
# Only the CLI's own dependency chain is built, not `build:packages`: 9 s against the better part
# of ten minutes, measured, and the guard needs nothing else. **The worktree is still unbuilt** —
# `pnpm run build:packages` remains the first thing to run before a test, `tsx`, `vite` or `next`,
# exactly as AGENTS.md says.
if ! (cd "$HERE" && pnpm --filter '@endora-commerce/cli...' run build); then
  echo "setup-worktree: could not build @endora-commerce/cli, which the resolution guard below" >&2
  echo "  imports. The install succeeded; this is a build failure, not a wiring one. Fix the" >&2
  echo "  build, then re-run this script — the guard has not been asked yet, so nothing about" >&2
  echo "  this worktree's links has been verified." >&2
  exit 1
fi

# Not "it probably worked": the same analysis the test suite refuses on.
"$HERE/backend/node_modules/.bin/tsx" "$HERE/scripts/workspace-resolution.ts"
