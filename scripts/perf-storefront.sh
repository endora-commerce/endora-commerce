#!/usr/bin/env bash
# `perf:storefront` — the storefront is booted, and `.lighthouserc.js`'s budget
# is measured against it (specs/098-storefront-ssr-seo-a11y-suite/ Phase 5,
# T501/T504; FR-050).
#
#   bash scripts/perf-storefront.sh              # boot, measure, assert
#   bash scripts/perf-storefront.sh --record     # boot, measure, print, assert nothing
#   bash scripts/perf-storefront.sh --no-boot    # measure an already-running stack
#   bash scripts/perf-storefront.sh --keep       # leave the stack standing
#
# ## Why this exists
#
# `.lighthouserc.js` has been in this repository since T242 and has had no
# runner since `5b0bfb5dd` deleted the GitHub Actions workflows: `lhci` was a
# dependency of nothing, the file said so in its own header, and Core Web Vitals
# (Constitution VII) were therefore asserted by a developer remembering. This is
# the runner, and it is `perf:backend`'s shape one application over — a
# scheduled pipeline, alone on the host, never a merge-request gate, because a
# p95 measured beside two live shards measures contention.
#
# ## What it measures against
#
# The stack is `scripts/lib/storefront-stack.sh`', the same boot
# `conformance:storefront` uses, for the reasons that file carries. **The two
# dynamic URLs take their slugs from the fixture manifest that boot writes**,
# never from a slug written into a config: a Lighthouse run over three 404 pages
# is fast, green on every metric this file cares about, and a measurement of
# nothing. A manifest naming no product or no category is exit 2 rather than a
# fallback, for the same reason.
#
# ## Recording runs
#
# `--record` collects and prints and asserts nothing. D-65's rule for
# `perf:backend` applies here unchanged: the first runs on a given runner are
# **recording** runs, and the committed thresholds are re-based from what that
# runner measures. A threshold carried over from another machine is a number
# with no error bar. The summary below prints every run's value and the median
# Lighthouse itself reports on, so a re-base has the spread in front of it.
#
# Exit 0 = the storefront is inside its budget.
# Exit 1 = an assertion failed.
# Exit 2 = the run could not measure — no Chrome, no subject for a dynamic
#          route, no report written at all. A green that could mean "not
#          looking" is not a green.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
STOREFRONT_STACK_PREFIX='[storefront-perf]'
# shellcheck source=scripts/lib/storefront-stack.sh
. "$REPO_ROOT/scripts/lib/storefront-stack.sh"
# shellcheck source=scripts/lib/schedule-kind.sh
. "$REPO_ROOT/scripts/lib/schedule-kind.sh"

BOOT=yes
KEEP=no
RECORD=no
STOREFRONT_PORT=${STOREFRONT_PORT:-3000}
BACKEND_PORT=${BACKEND_PORT:-3001}
# Pinned, and deliberately not a declared dependency: this is the only job that
# runs it, so a `dlx` fetch costs this job and adds nothing to
# `pnpm install --frozen-lockfile` in the other twelve (plan.md § Complexity
# Tracking). The pin is what makes two nightlies comparable.
LHCI=${LHCI_SPEC:-@lhci/cli@0.14.x}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-boot) BOOT=no; shift ;;
    --keep) KEEP=yes; shift ;;
    --record) RECORD=yes; shift ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "[storefront-perf] unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { echo "[storefront-perf] $*"; }
die2() { echo "[storefront-perf] $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# How many samples
# ---------------------------------------------------------------------------
# Three per URL on the nightly, five on `weekly-heavy`: a drift smaller than the
# run-to-run spread is invisible at three samples on a 4 vCPU box, and six extra
# Lighthouse runs have no place in a nightly.
#
# `.gitlab-ci.yml` used to pick this with `if [ "$CI_SCHEDULE_KIND" = ... ]`,
# one branch over three inputs: an unset variable and a typo both fell through
# to the same silent else. The variable was in fact unset on the schedule, so
# the five-sample branch had never once been reachable. The resolver refuses
# both states and says which one it is.
#
# An explicit `LHCI_NUMBER_OF_RUNS` still wins, because a developer measuring
# something by hand is not on a schedule and should not have to invent one.
if [ -z "${LHCI_NUMBER_OF_RUNS:-}" ]; then
  SCHEDULE_KIND=$(resolve_schedule_kind '[storefront-perf]') || exit 2
  case "$SCHEDULE_KIND" in
    weekly-heavy) LHCI_NUMBER_OF_RUNS=5 ;;
    *) LHCI_NUMBER_OF_RUNS=3 ;;
  esac
  say "schedule=$SCHEDULE_KIND runs-per-url=$LHCI_NUMBER_OF_RUNS"
else
  say "runs-per-url=$LHCI_NUMBER_OF_RUNS (LHCI_NUMBER_OF_RUNS was set)"
fi
export LHCI_NUMBER_OF_RUNS

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
export STOREFRONT_BASE_URL="$STOREFRONT_URL"
FIXTURES=${CONFORMANCE_FIXTURES:-$REPO_ROOT/storefront/test/conformance/fixtures.json}
REPORTS="$REPO_ROOT/storefront/test-results/lighthouse"

if [ "$BOOT" = yes ]; then
  storefront_stack_boot
fi

# ---------------------------------------------------------------------------
# The subjects
# ---------------------------------------------------------------------------
# The same manifest `conformance:storefront` reads, written by the fixture seed
# against the same seeded platform: *"here is a product"* is a fact about the
# database and belongs to whoever seeded it, not to a config file.
[ -f "$FIXTURES" ] || die2 "no fixture manifest at $FIXTURES. The two dynamic URLs would be guesses, and Lighthouse would happily measure two 404 pages."

subject() {
  node -e '
    const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const subject = manifest?.subjects?.[process.argv[2]];
    const segments = subject?.segments;
    if (!Array.isArray(segments) || segments.length === 0) process.exit(3);
    process.stdout.write(segments.join("/"));
  ' "$FIXTURES" "$1"
}

SAMPLE_PRODUCT_SLUG=$(subject product) || die2 'the fixture manifest names no product, so the product-detail URL has no subject. That is a finding about the seed, not about the storefront.'
SAMPLE_CATEGORY_SLUG=$(subject category) || die2 'the fixture manifest names no category, so the category URL has no subject. That is a finding about the seed, not about the storefront.'
export SAMPLE_PRODUCT_SLUG SAMPLE_CATEGORY_SLUG
say "subjects: product=$SAMPLE_PRODUCT_SLUG category=$SAMPLE_CATEGORY_SLUG"

# ---------------------------------------------------------------------------
# Chrome
# ---------------------------------------------------------------------------
# Derived from `@playwright/test`, which `storefront` already declares and
# `conformance:storefront` already runs, so this repository drives **one**
# browser rather than one per job. `chrome-launcher`'s own search covers a
# developer machine with Chrome installed and finds nothing in the Playwright
# image, where the browser is under `/ms-playwright`.
if [ -z "${CHROME_PATH:-}" ]; then
  CHROME_PATH=$(cd "$REPO_ROOT/storefront" && node -e 'process.stdout.write(require("@playwright/test").chromium.executablePath())' 2>/dev/null)
fi
[ -n "$CHROME_PATH" ] && [ -x "$CHROME_PATH" ] || die2 "no Chrome to measure with (CHROME_PATH=\"${CHROME_PATH:-}\"). Lighthouse needs a browser; a run without one measures nothing."
# An executable Chrome is not a Chrome that starts. In pipeline 13444 this check
# passed and the launcher then got `ECONNREFUSED` because Chrome refuses to run
# as root without `--no-sandbox`. The flag lives in `.lighthouserc.js`, derived
# from the process's own uid — see the comment above `CHROME_FLAGS` there for
# why it is safe in a job container and bad advice anywhere else. It is not set
# here, because a second place to spell it is a second place for the next
# correction to miss.
export CHROME_PATH
say "chrome: $CHROME_PATH"

# ---------------------------------------------------------------------------
# Measure
# ---------------------------------------------------------------------------
rm -rf "$REPO_ROOT/.lighthouseci" "$REPORTS"
cd "$REPO_ROOT" || die2 'the checkout moved under this run.'

if [ "$RECORD" = yes ]; then
  say "collecting (recording run — nothing is asserted)…"
  pnpm dlx "$LHCI" collect
  COLLECT_STATUS=$?
else
  say 'collecting and asserting…'
  pnpm dlx "$LHCI" autorun
  LHCI_STATUS=$?
  COLLECT_STATUS=0
fi

# The verdict comes from the reports rather than from the exit code alone, for
# `boot-gate`'s reason: a refusal and a finding are different answers and one
# process has one non-zero code for both. A run that produced no report did not
# get as far as measuring anything, whatever it exited.
REPORT_COUNT=$(find "$REPO_ROOT/.lighthouseci" -name 'lhr-*.json' 2>/dev/null | wc -l)
if [ "$REPORT_COUNT" -eq 0 ]; then
  die2 "Lighthouse wrote no report (collect exited ${COLLECT_STATUS}${LHCI_STATUS:+, autorun exited $LHCI_STATUS}). Nothing was measured, so this is not a pass."
fi

cat > "$WORK/summarise.mjs" <<'NODE'
// What this run measured, per URL and per metric: every run's value and the
// median Lighthouse asserts on. A re-base needs the spread, not one number.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const METRICS = [
  'largest-contentful-paint',
  'cumulative-layout-shift',
  'total-blocking-time',
  'first-contentful-paint',
  'speed-index',
];
const byUrl = new Map();
for (const name of readdirSync(dir).filter((f) => f.startsWith('lhr-') && f.endsWith('.json'))) {
  const lhr = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const url = lhr.finalDisplayedUrl ?? lhr.requestedUrl;
  if (!byUrl.has(url)) byUrl.set(url, new Map());
  const metrics = byUrl.get(url);
  for (const id of METRICS) {
    const value = lhr.audits?.[id]?.numericValue;
    if (typeof value !== 'number') continue;
    if (!metrics.has(id)) metrics.set(id, []);
    metrics.get(id).push(value);
  }
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const round = (id, v) => (id === 'cumulative-layout-shift' ? v.toFixed(3) : String(Math.round(v)));
for (const [url, metrics] of byUrl) {
  console.log(`[storefront-perf] ${url}`);
  for (const [id, values] of metrics) {
    const runs = values.map((v) => round(id, v)).join(' ');
    console.log(`[storefront-perf]   ${id}=${round(id, median(values))} (runs: ${runs})`);
  }
}
NODE
node "$WORK/summarise.mjs" "$REPO_ROOT/.lighthouseci" || die2 'the reports could not be read.'

# Keep them: on the runner this directory is the job's artifact, and
# `.lighthouseci` is one the next run deletes. `.lighthouserc.js`' `upload`
# target writes here too, and this copy is not redundant with it: `autorun`
# uploads *after* asserting, so a failing budget — the run whose report is worth
# reading — uploads nothing, and `--record` never reaches the upload step at
# all.
mkdir -p "$REPORTS"
cp "$REPO_ROOT/.lighthouseci/"* "$REPORTS/" 2>/dev/null || true

if [ "$RECORD" = yes ]; then
  if [ "$COLLECT_STATUS" -ne 0 ]; then
    die2 "the collection exited $COLLECT_STATUS. The numbers above, if any, are from an incomplete run."
  fi
  say "$REPORT_COUNT report(s) recorded. Nothing was asserted; re-base .lighthouserc.js from the medians above."
  exit 0
fi

if [ "$LHCI_STATUS" -ne 0 ]; then
  echo "[storefront-perf] the budget in .lighthouserc.js is not met (lhci exited $LHCI_STATUS); the failing assertions are above." >&2
  exit 1
fi

say "the storefront is inside its budget over $REPORT_COUNT report(s)."
exit 0
