#!/usr/bin/env sh
# Copy the workspace description — `pnpm-workspace.yaml`, `pnpm-lock.yaml` and every member's
# `package.json` — into a destination directory, preserving paths.
#
# Usage: sh scripts/collect-workspace-manifests.sh <destination>   (run from the repo root)
#
# ## Why this exists
#
# A Dockerfile installs before it copies sources, so that editing a source file does not
# re-run the install. That split needs the manifests, and only the manifests, in the image
# before `pnpm install` — which the three Dockerfiles used to arrange by naming seven of them
# one `COPY` line at a time. That list is a hand-kept copy of a derived fact: which directories
# are workspace members is stated once, in `pnpm-workspace.yaml`. It drifted twice —
# `packages/platform` added by hand, `packages/modules/blog` missed — and the second drift is
# what took `build:backend` down: `blog` was not a member at install time, so it received no
# `node_modules`, its `@mikro-orm/migrations` peer dependency resolved to nothing, and `tsc`
# reported `Property 'addSql' does not exist` forty lines into a migration. With 63 more module
# packages to come, an eighth `COPY` line buys one merge request.
#
# ## Why `pnpm ls`
#
# `pnpm ls --recursive --depth -1` answers "which directories are members of this workspace"
# from `pnpm-workspace.yaml` and the manifests alone: no install, no `node_modules`, nothing
# built. That is the question pnpm is authoritative for. It is *not* the way to find out which
# checkout a `node_modules` symlink points into — a different question, and the one AGENTS.md
# warns against using `pnpm ls` for.
#
# A member the caller has put out of reach (a `.dockerignore` entry, as `docs` is) is not
# listed, because its directory is not there to be walked. That is the correct answer: its
# sources will not arrive either.
#
# Needs GNU `cp --parents`, which both callers have: the images are `node:22.18-slim` and the
# test that runs this script runs on Linux.
set -eu

destination="${1:-}"
if [ -z "$destination" ]; then
  echo 'usage: collect-workspace-manifests.sh <destination>' >&2
  exit 64
fi

root="$(pwd)"

for required in pnpm-workspace.yaml pnpm-lock.yaml; do
  if [ ! -f "$root/$required" ]; then
    echo "no $required in $root: this is not a workspace root" >&2
    exit 2
  fi
done

# `grep '^/'` keeps the absolute paths and drops anything else pnpm decides to print (the
# update notice, a warning); `|| true` keeps `set -e` from turning "grep matched nothing" into
# an exit before the emptiness check below can say what actually went wrong. The paths are
# matched against `$root` by `case` in the loop rather than by a second grep, because a
# checkout path is not a regular expression and this one routinely holds a `.`.
members="$(pnpm ls --recursive --depth -1 --parseable | grep '^/' || true)"
if [ -z "$members" ]; then
  echo "pnpm listed no workspace member under $root" >&2
  exit 2
fi

mkdir -p "$destination"
cp --parents pnpm-workspace.yaml pnpm-lock.yaml "$destination/"

# Read from a here-document rather than a pipe: a pipeline runs its `while` in a subshell, and
# `count` would come back zero however many manifests were copied.
count=0
while IFS= read -r member; do
  [ -n "$member" ] || continue
  case "$member" in
    "$root") ;;
    "$root"/*) ;;
    *)
      echo "pnpm listed $member, which is outside $root" >&2
      exit 2
      ;;
  esac
  relative="${member#"$root"}"
  relative="${relative#/}"
  cp --parents "${relative:+$relative/}package.json" "$destination/"
  count=$((count + 1))
done <<MEMBERS
$members
MEMBERS

echo "[workspace-manifests] collected: members=$count root=$root destination=$destination"
