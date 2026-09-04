#!/usr/bin/env bash
# `conformance:storefront` — the storefront is booted, and the bytes it serves
# are asserted (specs/098-storefront-ssr-seo-a11y-suite/ Phase 4;
# contracts/accessibility-floor.md §4).
#
#   bash scripts/conformance-storefront.sh              # migrate, seed, boot, assert
#   bash scripts/conformance-storefront.sh --no-boot    # assert an already-running stack
#   bash scripts/conformance-storefront.sh --keep       # leave the stack standing
#
# ## Why this exists
#
# Phases 1–3 of this feature judge **source text**. Every claim they make about
# what a crawler receives is a claim about a file, and the only place those
# claims are decidable is the HTML a booted storefront actually serves. That is
# `scripts/boot-gate.sh`'s argument one application over, and this job copies
# its shape: build, migrate a throwaway database, seed it, boot, ask the running
# thing questions, and keep the judgement in a file that touches neither the
# network nor a browser (`storefront/test/conformance/assertions.ts`), so every
# finding it claims to make has a unit test that makes it.
#
# ## What it asserts
#
#   * one page per **indexable route type**, derived from Phase 2's own
#     per-route `seo.ts` declarations and reconciled against the framework's
#     `app-path-routes-manifest.json` — never a hand-written list (FR-033);
#   * of each: HTTP 200, one `<h1>`, a `<title>`, a meta description, a
#     canonical that is this page's, and the JSON-LD types the route declares
#     (FR-031), plus the primary domain content on the PDP and the category
#     page (FR-032). **A plain `fetch` is the no-JavaScript condition** and no
#     browser is introduced for it (FR-030);
#   * one **deliberately absent** URL per dynamic route type, at `404` and at
#     nothing else (specs/108-storefront-response-status/, FR-009…FR-013). The
#     URL is that same declaration filled with a token that cannot be a subject,
#     never a second page list; a run that planned probes and issued none is a
#     refusal rather than a pass;
#   * `@axe-core/playwright` over the same set, failing at `serious` and
#     `critical` against a two-way ledger (FR-040…FR-043);
#   * a keyboard traversal of the primary path and the skip link, and that a
#     page under `prefers-reduced-motion: reduce` runs no animation — the three
#     rules of `.claude/skills/ux-laws/SKILL.md` § 4 that are properties of
#     computed style and undecidable from markup.
#
# ## Why it does not build a Docker image
#
# `boot-gate` boots an **image**, because D-165's subject is the built image.
# This job's subject is the served HTML, and `next start` over a production
# `next build` is the same server the image wraps. Two things follow from
# building here instead: the browser is in this job's own container (with
# dind, a `-v` mount lands on the daemon's host and a `-p` publish is on the
# daemon's network), and `.next/app-path-routes-manifest.json` — the second
# author of the page set — is on disk rather than inside an image. The image
# is `build:storefront`'s subject and stays so.
#
# Exit 0 = the storefront serves what it declares and meets the floor.
# Exit 1 = a finding.
# Exit 2 = the run could not see what it judges — no route declaration, no
#          build manifest, a route type with no seeded subject, a dynamic route
#          type that produced no absent URL, a page set that disagrees with the
#          framework, no page served at all, no absent probe issued, or a
#          browser that evaluated no rule. A green that could mean "not looking"
#          is not a green.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
# The boot itself is `scripts/lib/storefront-stack.sh`, shared with
# `perf:storefront`: the question the two jobs ask differs, getting a
# storefront to the point of answering one does not.
STOREFRONT_STACK_PREFIX='[storefront-conformance]'
# shellcheck source=scripts/lib/storefront-stack.sh
. "$REPO_ROOT/scripts/lib/storefront-stack.sh"
BOOT=yes
KEEP=no
STOREFRONT_PORT=${STOREFRONT_PORT:-3000}
BACKEND_PORT=${BACKEND_PORT:-3001}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-boot) BOOT=no; shift ;;
    --keep) KEEP=yes; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "[storefront-conformance] unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { echo "[storefront-conformance] $*"; }
die2() { echo "[storefront-conformance] $*" >&2; exit 2; }

WORK=$(mktemp -d)
BACKEND_PID=
STOREFRONT_PID=

cleanup() {
  if [ "$KEEP" = yes ]; then
    say "--keep: backend pid ${BACKEND_PID:-none}, storefront pid ${STOREFRONT_PID:-none} left running."
    return
  fi
  storefront_stack_stop "$BACKEND_PID" "$STOREFRONT_PID"
  rm -rf "$WORK"
}
trap cleanup EXIT

export STOREFRONT_URL=${STOREFRONT_URL:-http://127.0.0.1:$STOREFRONT_PORT}
export PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL:-http://127.0.0.1:$BACKEND_PORT}
FINDINGS="$REPO_ROOT/storefront/test-results/conformance-findings.txt"
FIXTURES="$REPO_ROOT/storefront/test/conformance/fixtures.json"
export CONFORMANCE_FIXTURES="$FIXTURES"

# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
if [ "$BOOT" = yes ]; then
  storefront_stack_boot
fi

# ---------------------------------------------------------------------------
# Ask the running thing questions
# ---------------------------------------------------------------------------
rm -f "$FINDINGS"
say 'asserting…'
(cd "$REPO_ROOT" && pnpm --filter storefront run conformance)
RUNNER_STATUS=$?

# The verdict comes from the findings file rather than from the runner's own
# exit code, for `boot-gate`'s reason: a refusal and a finding are different
# answers and a test runner has one failure code for both. A runner that exited
# non-zero and wrote no file at all did not get as far as judging anything,
# which is itself exit 2.
if [ ! -f "$FINDINGS" ]; then
  echo "[storefront-conformance] the runner wrote no findings file (exit $RUNNER_STATUS). It did not reach the point of judging anything, so this is not a pass." >&2
  exit 2
fi

if grep -q '^refusal ' "$FINDINGS"; then
  echo '[storefront-conformance] this run could not see what it judges:' >&2
  sed 's/^/  /' "$FINDINGS" >&2
  exit 2
fi

FINDING_COUNT=$(grep -c '[^[:space:]]' "$FINDINGS")
if [ "$FINDING_COUNT" -gt 0 ]; then
  echo "[storefront-conformance] $FINDING_COUNT finding(s):" >&2
  sed 's/^/  /' "$FINDINGS" >&2
  exit 1
fi

if [ "$RUNNER_STATUS" -ne 0 ]; then
  echo "[storefront-conformance] the runner exited $RUNNER_STATUS with no finding recorded. That is the runner itself failing, not the storefront, and it is not a pass." >&2
  exit 2
fi

say 'the storefront serves what it declares, and meets the floor as far as this suite can see it.'
exit 0
