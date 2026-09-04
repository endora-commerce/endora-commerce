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
#          build manifest, a route type with no seeded subject, a page set that
#          disagrees with the framework, no page served at all, or a browser
#          that evaluated no rule. A green that could mean "not looking" is not
#          a green.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
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
  # The process group, not the pid: `pnpm exec tsx` is a chain of three
  # processes and killing the head leaves the one holding the port. A run that
  # left a listener behind is what makes the *next* run measure the previous
  # one's build, which is the shape the stale-port refusal above exists for.
  for pid in "$BACKEND_PID" "$STOREFRONT_PID"; do
    [ -n "$pid" ] || continue
    kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1
  done
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
  [ -n "${DATABASE_URL:-}" ] || die2 'DATABASE_URL is not set. This job migrates and seeds the database it is pointed at; it does not guess one.'

  # The same judgement `test/global-setup.ts` and the dev-seed guard make. This
  # job runs `seed:dev`, which DROPS business-data tables, so a mistyped DSN is
  # the difference between a test run and a data-loss incident. The seed's own
  # guard would refuse afterwards; refusing here means the migration never runs
  # either.
  case "$DATABASE_URL" in
    *[_/]test|*[_/]test[_?]*|*_test) : ;;
    *) die2 "DATABASE_URL names \"$DATABASE_URL\", whose database name does not follow the disposable \`(^|_)test(_|\$)\` convention. This job drops and reseeds business data; point it at a throwaway database." ;;
  esac

  # A port still held by a previous run is the worst possible state to measure
  # in: everything boots, nothing is what this run built, and the verdict is
  # about somebody else's storefront. `--keep` makes it easy to reach.
  for port in "$BACKEND_PORT" "$STOREFRONT_PORT"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      exec 3<&- 3>&-
      die2 "something is already listening on port $port. This run would boot nothing and measure whatever that is — stop it, or set BACKEND_PORT / STOREFRONT_PORT."
    fi
  done

  say 'migrating…'
  if ! (cd "$REPO_ROOT" && pnpm --filter backend exec tsx src/db/migrate.ts up) > "$WORK/migrate.log" 2>&1; then
    cat "$WORK/migrate.log" >&2
    die2 'the migration run failed. Nothing below was measured.'
  fi

  say 'seeding the catalogue…'
  if ! (cd "$REPO_ROOT" && pnpm --filter backend run seed:dev) > "$WORK/seed.log" 2>&1; then
    tail -40 "$WORK/seed.log" >&2
    die2 'the catalogue seed failed, so no route type has a subject.'
  fi

  say 'booting the backend…'
  setsid bash -c "cd '$REPO_ROOT/backend' && PORT=$BACKEND_PORT exec pnpm exec tsx src/index.ts" > "$WORK/backend.log" 2>&1 &
  BACKEND_PID=$!
  up=no
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$PUBLIC_API_BASE_URL/api/v1/storefront/module-presence"; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    tail -40 "$WORK/backend.log" >&2
    die2 'the backend never answered. Nothing below was measured.'
  fi

  # `NODE_ENV=production`, explicitly, and it is not tidiness. `next build`
  # under an exported `NODE_ENV=development` dies prerendering `/404` with
  # `<Html> should not be imported outside of pages/_document` — the pages
  # router's `_error` fallback, reported instead of whatever actually failed.
  # Measured here three times: identical trees, the only difference being this
  # variable. The backend keeps `development`, because a production composition
  # refuses to default values this job has no business supplying.
  # **After the first boot and before the second, and both halves are
  # load-bearing.** The settings rows this seed writes are created by the
  # platform's own boot, not by `seed:dev`, so a seed that ran first found
  # nothing to update and said nothing — measured, on a database created from
  # scratch, and it is why the home page reported its declared `Organization`
  # as unemitted after that ordering had already been "fixed" once. And the
  # platform reads settings through a cache it fills at boot and invalidates
  # from its own write path, so a row written straight to the database is
  # invisible to the process that was already running. One boot to create the
  # rows, the seed, then a fresh process to serve requests from what the seed
  # left behind.
  say 'seeding the conformance fixtures…'
  if ! (cd "$REPO_ROOT/backend" && pnpm exec tsx scripts/conformance/seed-storefront-fixtures.ts --out "$FIXTURES") \
       > "$WORK/fixtures.log" 2>&1; then
    cat "$WORK/fixtures.log" >&2
    die2 'the fixture seed failed, so the dynamic route types have no subject.'
  fi
  cat "$WORK/fixtures.log"

  say 'restarting the backend, so it serves what the seed left…'
  for pid in "$BACKEND_PID"; do
    [ -n "$pid" ] || continue
    kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1
  done
  BACKEND_PID=
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/$BACKEND_PORT") 2>/dev/null || break
    exec 3<&- 3>&-
    sleep 1
  done

  say 'booting the backend…'
  setsid bash -c "cd '$REPO_ROOT/backend' && PORT=$BACKEND_PORT exec pnpm exec tsx src/index.ts" > "$WORK/backend.log" 2>&1 &
  BACKEND_PID=$!
  up=no
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$PUBLIC_API_BASE_URL/api/v1/storefront/module-presence"; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    tail -40 "$WORK/backend.log" >&2
    die2 'the backend never answered. Nothing below was measured.'
  fi

  # `NODE_ENV=production`, explicitly, and it is not tidiness. `next build`
  # under an exported `NODE_ENV=development` dies prerendering `/404` with
  # `<Html> should not be imported outside of pages/_document` — the pages
  # router's `_error` fallback, reported instead of whatever actually failed.
  # Measured here three times: identical trees, the only difference being this
  # variable. The backend keeps `development`, because a production composition
  # refuses to default values this job has no business supplying.
  say 'building the storefront…'
  if ! (cd "$REPO_ROOT" && \
        NODE_ENV=production \
        NEXT_PUBLIC_API_BASE_URL="$PUBLIC_API_BASE_URL" \
        NEXT_PUBLIC_SITE_URL="$STOREFRONT_URL" \
        BACKEND_BASE_URL="$PUBLIC_API_BASE_URL" \
        pnpm --filter storefront run build) > "$WORK/build.log" 2>&1; then
    tail -60 "$WORK/build.log" >&2
    die2 'the storefront build failed. There is nothing to serve and no route manifest to read.'
  fi

  # `node .next/standalone/storefront/server.js`, which is what
  # `storefront/Dockerfile`'s `CMD` runs — **not** `next start`. The storefront
  # builds with `output: 'standalone'`, and Next says so itself on boot:
  # `"next start" does not work with "output: standalone"`. It is not a warning
  # that can be lived with. Measured: under `next start` the first request to a
  # fresh browser context renders correctly and the **second** returns Next's
  # `__next_error__` document — an empty body — so the keyboard traversal
  # reported every step of the primary path unreachable while the storefront was
  # fine. Booting what the image boots also removes a difference between what
  # this job measures and what a deployment serves.
  #
  # The standalone tree carries the server and its dependencies and neither the
  # static assets nor `public/`; the Dockerfile copies both into place and so
  # does this.
  say 'booting the storefront…'
  STANDALONE="$REPO_ROOT/storefront/.next/standalone/storefront"
  [ -f "$STANDALONE/server.js" ] || die2 "the build produced no standalone server at $STANDALONE/server.js — which is what \"output: 'standalone'\" makes next build emit."
  mkdir -p "$STANDALONE/.next"
  rm -rf "$STANDALONE/.next/static" "$STANDALONE/public"
  cp -r "$REPO_ROOT/storefront/.next/static" "$STANDALONE/.next/static"
  cp -r "$REPO_ROOT/storefront/public" "$STANDALONE/public"
  setsid env \
    NODE_ENV=production \
    PORT="$STOREFRONT_PORT" \
    HOSTNAME=127.0.0.1 \
    NEXT_PUBLIC_SITE_URL="$STOREFRONT_URL" \
    BACKEND_BASE_URL="$PUBLIC_API_BASE_URL" \
    node "$STANDALONE/server.js" > "$WORK/storefront.log" 2>&1 &
  STOREFRONT_PID=$!
  up=no
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$STOREFRONT_URL/"; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    tail -40 "$WORK/storefront.log" >&2
    die2 'the storefront never answered. Nothing below was measured.'
  fi
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
