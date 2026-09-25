#!/usr/bin/env bash
#
# Make an already-transferred documentation release the live one.
#
# Shipped to the VPS by `publish:docs` in `.gitlab-ci.yml` and run there, after
# the job has rsynced the gated `docs/build` artefact into
# `$DOCS_DEPLOY_PATH/releases/$CI_COMMIT_SHA/`. It performs the three steps that
# have to happen on the host and nothing else — the flip, the record and the
# prune. It never builds, never fetches and never touches the application stack
# (`specs/133-docs-site-publication/contracts/publication-pipeline.md` §3;
# FR-023–FR-026).
#
#   $DOCS_DEPLOY_PATH/
#   ├── releases/<CI_COMMIT_SHA>/   one build, one commit
#   ├── current -> releases/<sha>   the symlink nginx serves as `root`
#   ├── .published                  the commit timestamp currently live
#   └── publish-docs.sh             this file
#
# Inputs are environment variables, because ssh carries none of the job's:
# DOCS_DEPLOY_PATH, CI_COMMIT_SHA, CI_COMMIT_TIMESTAMP.
#
# ## The three things this script has to get right
#
# **The flip is `ln -sfn … current.tmp && mv -Tf current.tmp current`, never a
# bare `ln -sfn … current`.** `ln -sfn` onto an existing symlink *to a
# directory* is not one operation, and where the name resolves to a directory it
# creates the link **inside** that directory rather than replacing it — so the
# abbreviated form can leave `current/releases` behind and the document root
# untouched. `mv -Tf` is a single `rename(2)` over the symlink itself: a reader
# sees the old release or the new one, never a missing document root (FR-024).
#
# **A stale pipeline exits 0.** When `.published` holds a timestamp newer than
# the incoming one, a later commit is already live and this build must not
# replace it (FR-026). Refusing with a non-zero status would red a pipeline for
# doing exactly the right thing, and that red would be indistinguishable from a
# transfer that failed — so the refusal is a printed reason and exit 0.
#
# **The prune keeps five releases**, which is what makes the rollback in
# `deploy/README.md` possible: the same flip form, pointed at an older release.
# The live release is never pruned even if it falls outside the window.
#
# GNU `date -d` and `mv -T` are used deliberately: the target is the project's
# Debian VPS, not the `alpine:3.20` container the job itself runs in (which only
# ever runs ssh, scp and rsync).
set -euo pipefail

# How many release directories survive a publication, newest first.
RELEASES_KEPT=5

fail() {
  printf 'publish-docs: %s\n' "$1" >&2
  exit 1
}

[ -n "${DOCS_DEPLOY_PATH:-}" ] || fail \
  'DOCS_DEPLOY_PATH is unset. It is this feature'\''s own CI/CD variable and names the documentation root on the host; the application stack'\''s DEPLOY_PATH is a different directory and must not be reused.'
[ -n "${CI_COMMIT_SHA:-}" ] || fail 'CI_COMMIT_SHA is unset, so there is no release directory to publish.'
[ -n "${CI_COMMIT_TIMESTAMP:-}" ] || fail \
  'CI_COMMIT_TIMESTAMP is unset. It is what orders two overlapping publications, and without it a stale pipeline could not be recognised as stale.'

cd "$DOCS_DEPLOY_PATH" || fail "DOCS_DEPLOY_PATH ($DOCS_DEPLOY_PATH) is not a directory on this host."

release="releases/$CI_COMMIT_SHA"
[ -d "$release" ] || fail \
  "$release does not exist under $DOCS_DEPLOY_PATH. The transfer is the rsync step of the job that ships this script, and it has to have succeeded before this runs; flipping onto a missing tree would take the site down."

incoming=$(date -u -d "$CI_COMMIT_TIMESTAMP" +%s 2>/dev/null) ||
  fail "CI_COMMIT_TIMESTAMP ($CI_COMMIT_TIMESTAMP) could not be read as a date."

# The ordering guard (FR-026). `-gt` and not `-ge`: a re-run of the same commit
# carries the same timestamp and is allowed to complete, which is what makes a
# retried pipeline idempotent rather than refused.
if [ -f .published ]; then
  live_stamp=$(head -n 1 .published)
  live_seconds=$(date -u -d "$live_stamp" +%s 2>/dev/null || true)
  if [ -n "$live_seconds" ] && [ "$live_seconds" -gt "$incoming" ]; then
    printf 'publish-docs: declining to publish %s (%s) — the live site was built from a later commit (%s). The later commit wins regardless of the order two pipelines finish in, so this is a success, not a failure.\n' \
      "$CI_COMMIT_SHA" "$CI_COMMIT_TIMESTAMP" "$live_stamp"
    exit 0
  fi
fi

ln -sfn "$release" current.tmp
mv -Tf current.tmp current
printf '%s\n' "$CI_COMMIT_TIMESTAMP" > .published

live_target=$(readlink current || true)
kept=0
pruned=0
while IFS= read -r candidate; do
  [ -n "$candidate" ] || continue
  candidate=${candidate%/}
  kept=$((kept + 1))
  [ "$kept" -gt "$RELEASES_KEPT" ] || continue
  # Never prune what is being served, however old it sorts — a rollback leaves
  # an older release live and the next publication must not delete it underneath
  # a reader.
  [ "$candidate" != "$live_target" ] || continue
  rm -rf -- "$candidate"
  pruned=$((pruned + 1))
done <<EOF
$(ls -1dt releases/*/ 2>/dev/null || true)
EOF

printf 'publish-docs: published %s (%s); releases=%s pruned=%s\n' \
  "$CI_COMMIT_SHA" "$CI_COMMIT_TIMESTAMP" "$((kept - pruned))" "$pruned"
