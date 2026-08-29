#!/usr/bin/env bash
# The boot gate — CI builds the image, migrates a throwaway database, boots it,
# and asserts the platform is what the source says (feature 080, D-165 step F).
#
#   bash scripts/boot-gate.sh                     # build, boot, assert
#   bash scripts/boot-gate.sh --image <tag>       # assert an image already built
#   bash scripts/boot-gate.sh --with-negatives    # …and prove the gate can go red
#
# ## Why this exists, and why nothing cheaper will do
#
# D-165 moves production off `tsx src/index.ts` and onto `node dist/index.js`,
# and D-165.3 makes this step the *condition* of that ruling rather than a
# follow-up, because two defects were **reproduced** on the half-built compiled
# path — not predicted:
#
#   1. 45 of 45 modules install no translations while the boot reports
#      `installed=0 skipped=21 failed=0`. Green.
#   2. Every overlay module vanishes. No error, no warning.
#
# Both are this repository's signature defect class: a reader that treats an
# absent path as an absent *feature*. Neither is visible to a type-check, to a
# unit test, or to any static check in the tree, because in every one of those
# the tree is the source tree. The only thing that can see them is a real image,
# booted.
#
# !905 delivered steps A–C and could not assert the end-to-end boot without
# building the image. It considered three ways to fake that assertion and
# rejected all three. This script is the assertion.
#
# ## What it asserts
#
#   * the built image boots and answers `/api/v1/_health` with 200;
#   * the boot installed translations, `failed=0`, and `installed + skipped`
#     accounts for **every** module the running platform composes — the
#     arithmetic is what catches silence 1, because `installed > 0` alone is
#     satisfied by the six modules that are packages and carry their bundles
#     inside `node_modules`;
#   * every overlay module the deployment declares is composed and present.
#
# The expected overlay ids are derived from the deployment's own `modules/`
# directory and the module count from the running platform's own enumeration;
# neither is written down here (D-100).
#
# ## `--with-negatives`: the gate is run red, in every pipeline
#
# A boot gate that has never been red is a boot gate nobody has tested. So the
# gate derives two images from the one under test — one with every `i18n`
# directory removed from the built tree, one with the deployment's overlay
# directory removed — boots each, and **requires** the matching finding. They
# run the same boot path and the same judgement as the positive case; there is
# no second code path for them to pass through, which is the whole point.
#
# ## The observations, and where the judgement lives
#
# Three: the container's log, the HTTP status of the health endpoint, and the
# body of `/api/v1/storefront/module-presence` — a public, contract-validated
# enumeration of every composed module and its effective presence. Turning them
# into findings is `scripts/lib/boot-gate-assert.sh`, which touches neither
# docker nor the network, so `backend/test/unit/ci/boot-gate.test.ts` can spawn
# each function over fixture text and prove every finding can be made.
#
# HTTP is spoken from a throwaway container on the gate's own docker network,
# using the image's own node. That is deliberate: it needs no published port, no
# `curl`, no `jq` and no host toolchain, so the gate behaves identically on a
# laptop and inside `docker:27-dind`, where a published port is on the daemon's
# host and not the job's.
#
# Exit 0 = the compiled application is what the source says.
# Exit 1 = a finding (or, under `--with-negatives`, a gate that stayed green
#          over a deliberately broken image).
# Exit 2 = nothing was read — no deployment overlay module to expect, an image
#          that would not build, a platform that enumerated no module. A green
#          that could mean "not looking" is not a green.
set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/lib/boot-gate-assert.sh
. "$REPO_ROOT/scripts/lib/boot-gate-assert.sh"

DEPLOYMENT=example
IMAGE=
BUILD=auto
WITH_NEGATIVES=no
KEEP=no
HEALTH_PATH=/api/v1/_health
PRESENCE_PATH=/api/v1/storefront/module-presence
export BOOT_GATE_HEALTH_PATH="$HEALTH_PATH"

while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE=$2; BUILD=no; shift 2 ;;
    --build) BUILD=yes; shift ;;
    --deployment) DEPLOYMENT=$2; shift 2 ;;
    --with-negatives) WITH_NEGATIVES=yes; shift ;;
    --keep) KEEP=yes; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "[boot-gate] unknown option: $1" >&2; exit 2 ;;
  esac
done

STAMP=$(date +%s)-$$
NET=boot-gate-$STAMP
PG=boot-gate-pg-$STAMP
REDIS=boot-gate-redis-$STAMP
MEILI=boot-gate-meili-$STAMP
APP=boot-gate-app-$STAMP
TEMPLATE_DB=b2b_boot_gate_template_test
WORK=$(mktemp -d)
DERIVED_IMAGES=

cleanup() {
  [ "$KEEP" = yes ] && { echo "[boot-gate] --keep: leaving network $NET and its containers standing."; return; }
  docker rm -f "$APP" "$PG" "$REDIS" "$MEILI" >/dev/null 2>&1
  for img in $DERIVED_IMAGES; do docker rmi -f "$img" >/dev/null 2>&1; done
  docker network rm "$NET" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

say() { echo "[boot-gate] $*"; }
die2() { echo "[boot-gate] $*" >&2; exit 2; }

# ---------------------------------------------------------------------------
# What this deployment is expected to contribute — derived, never listed
# ---------------------------------------------------------------------------
OVERLAY_ROOT="$REPO_ROOT/backend/src/apps/$DEPLOYMENT/modules"
EXPECTED_OVERLAYS=
if [ -d "$OVERLAY_ROOT" ]; then
  for manifest in "$OVERLAY_ROOT"/*/manifest.ts; do
    [ -f "$manifest" ] || continue
    EXPECTED_OVERLAYS="$EXPECTED_OVERLAYS $(basename "$(dirname "$manifest")")"
  done
fi
# shellcheck disable=SC2086
set -- $EXPECTED_OVERLAYS
OVERLAY_COUNT=$#
if [ "$OVERLAY_COUNT" -eq 0 ]; then
  die2 "deployment \"$DEPLOYMENT\" declares no overlay module under backend/src/apps/$DEPLOYMENT/modules/, so the half of this gate that exists to catch a vanished overlay would pass over an empty population. Point --deployment at a deployment that ships one."
fi

command -v docker >/dev/null 2>&1 || die2 'docker is not on PATH. This gate builds and boots a real image; there is no mode in which it simulates one.'

# ---------------------------------------------------------------------------
# The image under test
# ---------------------------------------------------------------------------
if [ "$BUILD" != no ]; then
  IMAGE=endora-boot-gate:$STAMP
  say "building $IMAGE from backend/Dockerfile…"
  docker build -f "$REPO_ROOT/backend/Dockerfile" -t "$IMAGE" "$REPO_ROOT" \
    || die2 "the image did not build. Nothing below was measured."
  DERIVED_IMAGES="$DERIVED_IMAGES $IMAGE"
fi
docker image inspect "$IMAGE" >/dev/null 2>&1 || die2 "no such image: $IMAGE"

# The whole ruling is that production runs built output. An image whose command
# still names the interpreter would pass every assertion below and be the thing
# D-165 exists to stop.
IMAGE_CMD=$(docker image inspect --format '{{json .Config.Cmd}}' "$IMAGE")
case "$IMAGE_CMD" in
  *dist/index.js*) : ;;
  *) echo "compiled-entry-point: $IMAGE runs $IMAGE_CMD. D-165 moves production onto built output; an image whose command is not dist/index.js is not the application this gate was written to measure." >&2
     exit 1 ;;
esac

# ---------------------------------------------------------------------------
# Infrastructure, on a network of this run's own
# ---------------------------------------------------------------------------
docker network create "$NET" >/dev/null || die2 "could not create docker network $NET"
docker run -d --name "$PG" --network "$NET" --network-alias postgres \
  -e POSTGRES_USER=b2b -e POSTGRES_PASSWORD=b2b -e POSTGRES_DB=b2b \
  postgres:16-alpine >/dev/null || die2 'postgres did not start'
docker run -d --name "$REDIS" --network "$NET" --network-alias redis \
  redis:7-alpine >/dev/null || die2 'redis did not start'
docker run -d --name "$MEILI" --network "$NET" --network-alias meilisearch \
  -e MEILI_MASTER_KEY=devMasterKeyChangeMe -e MEILI_ENV=development -e MEILI_NO_ANALYTICS=true \
  getmeili/meilisearch:v1.11 >/dev/null || die2 'meilisearch did not start'

say 'waiting for postgres…'
ready=no
for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U b2b -d b2b >/dev/null 2>&1; then ready=yes; break; fi
  sleep 1
done
[ "$ready" = yes ] || die2 'postgres never became ready'

# `2>/dev/null` swallows only postgres' NOTICE chatter; every caller redirects
# stdout and tests the exit status, which the redirect leaves alone.
psql() { docker exec "$PG" psql -U b2b -d postgres -tAc "$1" 2>/dev/null; }

app_env() {
  printf -- '-e DATABASE_URL=postgresql://b2b:b2b@postgres:5432/%s ' "$1"
  printf -- '-e REDIS_URL=redis://redis:6379 '
  printf -- '-e MEILISEARCH_URL=http://meilisearch:7700 -e MEILISEARCH_API_KEY=devMasterKeyChangeMe '
  printf -- '-e DEPLOYMENT=%s -e NODE_ENV=production -e PORT=3001 ' "$DEPLOYMENT"
  # Two values a production composition refuses to default, each with its own
  # reason in the code that refuses it. They are set here rather than made
  # optional: booting under `NODE_ENV=development` to avoid them would measure a
  # different application from the one the image serves.
  printf -- '-e SESSION_COOKIE_SECRET=boot-gate-secret-not-a-real-deployment '
  printf -- '-e PUBLIC_API_BASE_URL=https://boot-gate.invalid '
}

# The migration set is applied once, into a template every case is cloned from.
# `create database … template` is ~1 s; re-migrating per case is ~25 s, and the
# translation assertion genuinely needs a database that has never had this boot
# run against it — `installed` counts the modules whose bundles produced rows on
# *this* boot.
say "migrating $TEMPLATE_DB…"
psql "drop database if exists $TEMPLATE_DB" >/dev/null
psql "create database $TEMPLATE_DB" >/dev/null
# shellcheck disable=SC2046
docker run --rm --network "$NET" $(app_env "$TEMPLATE_DB") "$IMAGE" \
  node dist/db/migrate.js up > "$WORK/migrate.log" 2>&1 || {
  echo "[boot-gate] the migration run failed. Its output:" >&2
  cat "$WORK/migrate.log" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# One case = one database, one container, three observations, one verdict
# ---------------------------------------------------------------------------
CASE_INDEX=0
LAST_MODULE_COUNT=0

# probe <path> — prints "<status>\n<body>".
#
# Spoken from a throwaway container on this run's network, using the node inside
# the image **under test's own base**, which is always `$IMAGE` and never the
# broken derivative: a negative case breaks the application, not the tooling, and
# a probe that could not run would report `000` for the wrong reason.
probe() {
  docker run --rm --network "$NET" "$IMAGE" node -e "
    fetch('http://$APP:3001$1')
      .then(async (r) => { console.log(r.status); console.log(await r.text()); })
      .catch(() => { console.log('000'); console.log(''); });
  " 2>/dev/null
}

# run_case <label> <image> — prints findings on stdout; sets LAST_MODULE_COUNT.
run_case() {
  local label=$1 image=$2 db status body
  CASE_INDEX=$((CASE_INDEX + 1))
  db="b2b_boot_gate_${CASE_INDEX}_test"
  psql "drop database if exists $db" >/dev/null
  psql "create database $db template $TEMPLATE_DB" >/dev/null

  docker rm -f "$APP" >/dev/null 2>&1
  # shellcheck disable=SC2046
  docker run -d --name "$APP" --network "$NET" --network-alias "$APP" \
    $(app_env "$db") "$image" >/dev/null || { echo "container-did-not-start: $label"; return 0; }

  local up=no
  for _ in $(seq 1 180); do
    if docker logs "$APP" 2>&1 | grep -q 'backend listening'; then up=yes; break; fi
    if [ "$(docker inspect -f '{{.State.Running}}' "$APP" 2>/dev/null)" = false ]; then break; fi
    sleep 1
  done
  docker logs "$APP" > "$WORK/$label.log" 2>&1

  if [ "$up" != yes ]; then
    # One line on stdout, because the caller counts findings by line; the log
    # itself goes to stderr, where it is read rather than counted.
    printf 'did-not-boot: the "%s" container never logged "backend listening" — its last lines are on stderr above.\n' "$label"
    echo "[boot-gate] last 25 lines of the \"$label\" container:" >&2
    tail -25 "$WORK/$label.log" | sed 's/^/  /' >&2
    docker rm -f "$APP" >/dev/null 2>&1
    return 0
  fi

  probe "$HEALTH_PATH" > "$WORK/$label.health" 2>/dev/null
  status=$(head -1 "$WORK/$label.health")
  probe "$PRESENCE_PATH" > "$WORK/$label.presence.raw" 2>/dev/null
  tail -n +2 "$WORK/$label.presence.raw" > "$WORK/$label.presence"
  body=$(boot_gate_module_ids "$WORK/$label.presence" | grep -c '[^[:space:]]')
  LAST_MODULE_COUNT=$body

  boot_gate_health_findings "$status"
  if [ "$body" -eq 0 ]; then
    printf 'no-module-enumeration: %s returned no module at all, so both assertions below it would pass over an empty population.\n' "$PRESENCE_PATH"
  else
    boot_gate_translation_findings "$WORK/$label.log" "$body"
    # shellcheck disable=SC2086
    boot_gate_overlay_findings "$WORK/$label.presence" $EXPECTED_OVERLAYS
  fi
  docker rm -f "$APP" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# The positive case
# ---------------------------------------------------------------------------
say "booting $IMAGE with DEPLOYMENT=$DEPLOYMENT…"
run_case positive "$IMAGE" > "$WORK/positive.findings"
FINDINGS=$(grep -c '[^[:space:]]' "$WORK/positive.findings")
MODULE_COUNT=$LAST_MODULE_COUNT

# ---------------------------------------------------------------------------
# The negative cases — the gate, run red, over the two silences it exists for
# ---------------------------------------------------------------------------
NEGATIVE_FAILURES=0
NEGATIVE_CASES=0

expect_finding() {
  # expect_finding <label> <kind> <RUN line>
  #
  # The breakage lives in a *derived image*, never in this script: a `--break`
  # flag would be a code path the positive run does not take, which is exactly
  # the shape !905 refused when it declined to fake this assertion.
  local label=$1 kind=$2 run=$3 tag findings
  NEGATIVE_CASES=$((NEGATIVE_CASES + 1))
  tag="$IMAGE-broken-$label"
  printf 'FROM %s\n%s\n' "$IMAGE" "$run" > "$WORK/Dockerfile.$label"
  if ! docker build -q -f "$WORK/Dockerfile.$label" -t "$tag" "$WORK" >/dev/null; then
    echo "[boot-gate] could not derive the broken image for \"$label\"." >&2
    NEGATIVE_FAILURES=$((NEGATIVE_FAILURES + 1))
    return 0
  fi
  DERIVED_IMAGES="$DERIVED_IMAGES $tag"

  say "negative case \"$label\": booting an image with — $run"
  run_case "$label" "$tag" > "$WORK/$label.findings"
  findings=$(grep -c '[^[:space:]]' "$WORK/$label.findings")

  if [ "$findings" -eq 0 ]; then
    echo "[boot-gate] NEGATIVE CASE STAYED GREEN: \"$label\". The gate reported nothing over an image that is deliberately broken, so its green says nothing." >&2
    NEGATIVE_FAILURES=$((NEGATIVE_FAILURES + 1))
    return 0
  fi
  if ! grep -q "^$kind:" "$WORK/$label.findings"; then
    echo "[boot-gate] NEGATIVE CASE WENT RED FOR THE WRONG REASON: \"$label\" expected \"$kind\" and got:" >&2
    sed 's/^/  /' "$WORK/$label.findings" >&2
    NEGATIVE_FAILURES=$((NEGATIVE_FAILURES + 1))
    return 0
  fi
  say "negative case \"$label\": red, as it must be —"
  sed 's/^/    /' "$WORK/$label.findings"
}

if [ "$WITH_NEGATIVES" = yes ]; then
  # Exactly the tree a build without its asset-copy step produces: `tsc`
  # compiles `.ts` and emits `.js`, `.d.ts` and `.map`, so removing every `.json`
  # and `.txt` from the built trees removes the assets and nothing else. A
  # coarser breakage was tried first — `find -type d -name i18n -exec rm -rf` —
  # and it took `dist/kernel/i18n/`, a *code* directory of that name, with it:
  # the container then died on `ERR_MODULE_NOT_FOUND`, which is a loud failure
  # and therefore not the silence this case exists to reproduce.
  #
  # **The deletion moved out of `backend/dist`, and it had to** (feature 080,
  # D-160.11's second half). Every module is a package now, and a package's
  # bundles are in its own directory — `_lifecycle` was the last one whose
  # bundles the backend build copied, and it moved into
  # `@endora-commerce/platform`. So a deletion aimed at `backend/dist` removed
  # nothing any module reads, every module installed its translations, and this
  # case reported a cheerful green over an image that was not broken at all.
  #
  # **There are two cases because there are two assertions, and the wide one
  # cannot prove the narrow one's.** Dropping the *platform package's* assets is
  # exactly the tree a platform build without `copy-package-assets` produces: one
  # module loses its bundles, installs nothing, throws nothing, and lands in
  # none of the reconciler's three counts — which only the **arithmetic**
  # assertion can see, and which `installed > 0` reports as a cheerful non-zero.
  # Dropping every package's assets is the other end: nothing installs at all,
  # and the `installed == 0` branch is what fires. Run only the wide case and
  # the arithmetic goes unproven, which is the assertion this gate exists for.
  #
  # `package.json` is spared by name: deleting one breaks module *resolution*,
  # which is a loud crash and not the silence these cases are about.
  expect_finding drop-platform-bundles unaccounted-modules \
    "RUN find /app/packages/platform/dist \\( -name '*.json' -o -name '*.txt' \\) -delete"
  expect_finding drop-every-bundle no-translations-installed \
    "RUN find /app/backend/dist /app/packages \\( -name '*.json' -o -name '*.txt' \\) -not -name 'package.json' -delete"
  expect_finding drop-overlays overlay-missing \
    "RUN rm -rf /app/backend/dist/apps"
fi

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
say "read: cases=$((1 + NEGATIVE_CASES)) modules=$MODULE_COUNT overlays=$OVERLAY_COUNT sources=deployment-modules:$OVERLAY_COUNT/$OVERLAY_COUNT,module-presence:$MODULE_COUNT"

# Exit 2 is "nothing was read", and that is one specific case: the application
# came up and enumerated no module, so every assertion below the enumeration
# would pass over an empty population. A container that never booted is a
# *finding* and exits 1 — it is the loudest answer this gate can give, and
# calling it "nothing was read" would file the worst outcome under the mildest
# verdict.
if grep -q '^no-module-enumeration:' "$WORK/positive.findings"; then
  echo "[boot-gate] the running platform enumerated no module. Every assertion this gate makes is over that population, so this is exit 2 and not a pass." >&2
  sed 's/^/  /' "$WORK/positive.findings" >&2
  exit 2
fi

if [ "$FINDINGS" -gt 0 ]; then
  echo "[boot-gate] $FINDINGS finding(s) against $IMAGE:" >&2
  sed 's/^/  /' "$WORK/positive.findings" >&2
  exit 1
fi

if [ "$NEGATIVE_FAILURES" -gt 0 ]; then
  echo "[boot-gate] $NEGATIVE_FAILURES of $NEGATIVE_CASES negative case(s) did not go red. A gate that cannot fail is not a gate." >&2
  exit 1
fi

say "the compiled application boots, installs translations for every module it composes, and keeps its $OVERLAY_COUNT overlay module(s)."
exit 0
