#!/usr/bin/env bash
# `perf:backend` / `perf:backend:heavy` — the backend benchmarks, one tier per
# invocation (issue #143, ruling D-64; capacity repair after pipeline 13444).
#
#   bash scripts/perf-backend.sh --weight fast    # every schedule
#   bash scripts/perf-backend.sh --weight heavy   # weekly-heavy only
#
# ## Why this is a script and not four lines of YAML
#
# It was four lines of YAML, and two of them were wrong:
#
#     SKIP_HEAVY="--exclude test/perf/product_feeds/generation-100k.test.ts \
#                 --exclude test/perf/pim_ergonode/import-throughput.test.ts"
#     if [ "$CI_SCHEDULE_KIND" = "weekly-heavy" ]; then SKIP_HEAVY=""; fi
#
# The first is a hand-written list of a derived fact (D-100). Three PIM
# integrations landed 10 000-record benchmarks after it was written and none was
# added, so on 2026-09-09 `pim_unopim/import-throughput.test.ts` alone ran for
# **43 minutes**, the runner's one-hour wall arrived mid-file, and three
# benchmarks never ran. No test failed and no budget was exceeded — the nightly
# simply cost an hour and reported on 14 of its 17 files. The selection is now
# derived from each benchmark's own declared weight, and a benchmark in neither
# tier is a refusal: see `backend/scripts/lib/perf-weights.ts`.
#
# The second is the one-branch `CI_SCHEDULE_KIND` test that cannot tell an unset
# variable from a typo — and the variable was unset, so its `weekly-heavy` branch
# had never once been reachable. `scripts/lib/schedule-kind.sh` carries that.
#
# ## The selection is positive
#
# The job names the files it runs. A skip list is wrong in silence when a
# benchmark arrives that nobody adds to it; a positive selection over declared
# weights cannot be short without the declaration being missing, which is the
# thing that is refused.
#
# Exit 0 = the tier ran and every benchmark is inside its budget.
# Exit 1 = a benchmark failed, or one is classified wrongly.
# Exit 2 = the run could not decide what to measure — an undeclared schedule
#          kind, an unrecognised one, a tier asked for on the wrong schedule, or
#          an empty selection. A green that could mean "not looking" is not a
#          green (issue #113).
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
PREFIX='[perf-backend]'

# shellcheck source=scripts/lib/schedule-kind.sh
. "$REPO_ROOT/scripts/lib/schedule-kind.sh"

say() { echo "$PREFIX $*"; }
die2() { echo "$PREFIX $*" >&2; exit 2; }

WEIGHT=
while [ $# -gt 0 ]; do
  case "$1" in
    --weight) WEIGHT=${2:-}; shift 2 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) die2 "unknown option: $1" ;;
  esac
done
[ -n "$WEIGHT" ] || die2 '--weight is required: fast (every schedule) or heavy (weekly-heavy only).'

# ---------------------------------------------------------------------------
# Which schedule is this, and does this tier belong on it?
# ---------------------------------------------------------------------------
KIND=$(resolve_schedule_kind "$PREFIX") || exit 2

case "$WEIGHT" in
  fast)
    # Every kind runs the fast tier: it is the regression detector, and a weekly
    # run that skipped it would be a week with no reading at all.
    ;;
  heavy)
    if [ "$KIND" != 'weekly-heavy' ]; then
      die2 "the heavy tier was asked for on a \`$KIND\` run. Multi-minute benchmarks have no place in a nightly, and this job's own \`rules:\` should not have created it here — that is the defect, not the schedule."
    fi
    ;;
  *)
    die2 "unknown weight: $WEIGHT"
    ;;
esac
say "schedule=$KIND weight=$WEIGHT"

# ---------------------------------------------------------------------------
# What to run — derived from the benchmarks themselves
# ---------------------------------------------------------------------------
SELECTION=$(pnpm --filter backend exec tsx scripts/perf-selection.ts --weight "$WEIGHT")
SELECTION_STATUS=$?
if [ "$SELECTION_STATUS" -ne 0 ]; then
  echo "$PREFIX the selection failed (exit $SELECTION_STATUS); the findings are above. Nothing was measured." >&2
  exit "$SELECTION_STATUS"
fi

# shellcheck disable=SC2206  # word splitting is the point: one path per line.
FILES=($SELECTION)
[ "${#FILES[@]}" -gt 0 ] || die2 'the selection is empty, and `perf-selection.ts` exited 0 saying so. That is a defect in the selection, not a tier with nothing in it.'
say "${#FILES[@]} benchmark(s): ${FILES[*]}"

# ---------------------------------------------------------------------------
# Measure
# ---------------------------------------------------------------------------
# `PERF_RUN` is each benchmark's own opt-in (`describe.skipIf`), set here rather
# than only in the job so that a developer running this script gets the same run
# CI gets. Without it every file collects, reports zero tests and passes.
export PERF_RUN=${PERF_RUN:-true}

cd "$REPO_ROOT" || die2 'the checkout moved under this run.'
pnpm --filter backend exec vitest run "${FILES[@]}"
exit $?
