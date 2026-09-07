#!/usr/bin/env bash
# The storefront stack, booted the way both jobs that measure it need it
# (specs/098-storefront-ssr-seo-a11y-suite/, Phases 4 and 5).
#
# **Sourced, never executed.** Two CI jobs ask a running storefront a question:
# `conformance:storefront` asks what bytes it serves, `perf:storefront` asks how
# fast it serves them. The question differs; getting to the point where either
# can be asked does not, and three of the steps below are measurements somebody
# paid for rather than obvious procedure:
#
#   * the backend is booted **twice**, because the settings rows the fixture
#     seed updates are created by the platform's own boot and read through a
#     cache that boot fills;
#   * `next build` runs under an explicit `NODE_ENV=production`, because under
#     `development` it dies prerendering `/404` with a pages-router error that
#     names nothing real;
#   * the storefront is served by `node .next/standalone/storefront/server.js`,
#     not `next start`, which Next refuses to run over an `output: 'standalone'`
#     build — and refuses in a way whose *second* request returns an empty
#     `__next_error__` document rather than an error.
#
# A second copy of those three facts is a second place for the next correction
# to miss, which is why this is a library and not a paragraph telling the next
# author to read the other script.
#
# ## Contract
#
# The caller sets, before sourcing or before calling `storefront_stack_boot`:
#
#   STOREFRONT_STACK_PREFIX   the log prefix, e.g. `[storefront-conformance]`
#   REPO_ROOT                 the checkout
#   BACKEND_PORT              where the backend listens
#   STOREFRONT_PORT           where the storefront listens
#   PUBLIC_API_BASE_URL       exported; the storefront's view of the backend
#   STOREFRONT_URL            exported; the storefront's own origin
#   WORK                      a temp directory for the boot's logs
#   FIXTURES                  where the fixture manifest is written
#
# and owns the EXIT trap. `storefront_stack_boot` sets `BACKEND_PID` and
# `STOREFRONT_PID` for it to reap through `storefront_stack_stop`.
#
# Every refusal here is exit **2**: a run that could not boot measured nothing,
# and a green that could mean "not looking" is not a green.

storefront_stack_say() { echo "${STOREFRONT_STACK_PREFIX} $*"; }
storefront_stack_die2() { echo "${STOREFRONT_STACK_PREFIX} $*" >&2; exit 2; }

# The process group, not the pid: `pnpm exec tsx` is a chain of three processes
# and killing the head leaves the one holding the port. A run that left a
# listener behind is what makes the *next* run measure the previous one's build,
# which is the shape the stale-port refusal below exists for.
storefront_stack_stop() {
  for pid in "$@"; do
    [ -n "$pid" ] || continue
    kill -- "-$pid" >/dev/null 2>&1 || kill "$pid" >/dev/null 2>&1
  done
}

# The same judgement `test/global-setup.ts` and the dev-seed guard make. The
# boot runs `seed:dev`, which DROPS business-data tables, so a mistyped DSN is
# the difference between a test run and a data-loss incident. The seed's own
# guard would refuse afterwards; refusing here means the migration never runs
# either.
storefront_stack_require_disposable_database() {
  [ -n "${DATABASE_URL:-}" ] || storefront_stack_die2 'DATABASE_URL is not set. This job migrates and seeds the database it is pointed at; it does not guess one.'
  case "$DATABASE_URL" in
    *[_/]test|*[_/]test[_?]*|*_test) : ;;
    *) storefront_stack_die2 "DATABASE_URL names \"$DATABASE_URL\", whose database name does not follow the disposable \`(^|_)test(_|\$)\` convention. This job drops and reseeds business data; point it at a throwaway database." ;;
  esac
}

# A port still held by a previous run is the worst possible state to measure in:
# everything boots, nothing is what this run built, and the verdict is about
# somebody else's storefront.
storefront_stack_require_free_ports() {
  for port in "$BACKEND_PORT" "$STOREFRONT_PORT"; do
    if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
      exec 3<&- 3>&-
      storefront_stack_die2 "something is already listening on port $port. This run would boot nothing and measure whatever that is — stop it, or set BACKEND_PORT / STOREFRONT_PORT."
    fi
  done
}

storefront_stack_boot_backend() {
  storefront_stack_say 'booting the backend…'
  setsid bash -c "cd '$REPO_ROOT/backend' && PORT=$BACKEND_PORT exec pnpm exec tsx src/index.ts" > "$WORK/backend.log" 2>&1 &
  BACKEND_PID=$!
  local up=no
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$PUBLIC_API_BASE_URL/api/v1/storefront/module-presence"; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    tail -40 "$WORK/backend.log" >&2
    storefront_stack_die2 'the backend never answered. Nothing below was measured.'
  fi
}

storefront_stack_boot() {
  storefront_stack_require_disposable_database
  storefront_stack_require_free_ports

  storefront_stack_say 'migrating…'
  if ! (cd "$REPO_ROOT" && pnpm --filter backend exec tsx src/db/migrate.ts up) > "$WORK/migrate.log" 2>&1; then
    cat "$WORK/migrate.log" >&2
    storefront_stack_die2 'the migration run failed. Nothing below was measured.'
  fi

  storefront_stack_say 'seeding the catalogue…'
  if ! (cd "$REPO_ROOT" && pnpm --filter backend run seed:dev) > "$WORK/seed.log" 2>&1; then
    tail -40 "$WORK/seed.log" >&2
    storefront_stack_die2 'the catalogue seed failed, so no route type has a subject.'
  fi

  storefront_stack_boot_backend

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
  storefront_stack_say 'seeding the storefront fixtures…'
  if ! (cd "$REPO_ROOT/backend" && pnpm exec tsx scripts/conformance/seed-storefront-fixtures.ts --out "$FIXTURES") \
       > "$WORK/fixtures.log" 2>&1; then
    cat "$WORK/fixtures.log" >&2
    storefront_stack_die2 'the fixture seed failed, so the dynamic route types have no subject.'
  fi
  cat "$WORK/fixtures.log"

  storefront_stack_say 'restarting the backend, so it serves what the seed left…'
  storefront_stack_stop "$BACKEND_PID"
  BACKEND_PID=
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/$BACKEND_PORT") 2>/dev/null || break
    exec 3<&- 3>&-
    sleep 1
  done

  storefront_stack_boot_backend

  # `NODE_ENV=production`, explicitly, and it is not tidiness. `next build`
  # under an exported `NODE_ENV=development` dies prerendering `/404` with
  # `<Html> should not be imported outside of pages/_document` — the pages
  # router's `_error` fallback, reported instead of whatever actually failed.
  # Measured three times: identical trees, the only difference being this
  # variable. The backend keeps `development`, because a production composition
  # refuses to default values these jobs have no business supplying.
  #
  # `--max-old-space-size=1024`, on this invocation and on nothing else. It is
  # the second half of the repair `storefront/next.config.js`'
  # `webpackBuildWorker: true` is the first half of, and it only became
  # available with it: until the compile moved into a worker there was nothing
  # for a heap cap to reach, measured — with the compile in the parent, a 1024
  # cap took the parent from 1959 MB to 1905 MB, which is noise, because that
  # process's footprint is webpack's native memory and not V8's old space.
  # Inside the build worker the same cap is real. Peak summed RSS of the whole
  # process group, `webpackBuildWorker: true` throughout:
  #
  #   uncapped .................. 2153 MB    98 s
  #   `--max-old-space-size=768`  1631 MB   100 s
  #   ... 1024 .................. 1788 MB   102 s
  #   ... 512 ................... FAILS
  #
  # So the requirement sits between 512 and 768, and 1024 is chosen above it
  # with the same margin `.gitlab-ci.yml`'s `quality` block chose 2560 over a
  # 2048–2080 requirement.
  #
  # **What it buys beyond the 365 MB is the failure mode**, which is the reason
  # to keep it even on a machine where the memory is not tight. Uncapped, Node
  # sizes the old space from `os.totalmem()` — the *host's*, since a docker
  # executor's container does not change `/proc/meminfo` — so this build's
  # demand is a function of whichever machine runs it: 4192 MB of default heap
  # on a 64 GB developer box against roughly 2 GB on the 7.9 GB runner, where
  # the compile worker's measured 1922 MB is already at the ceiling. Pinning it
  # makes the demand a constant. And the 512 run above did not print `Killed`:
  # it printed `FATAL ERROR: Ineffective mark-compacts near heap limit -
  # JavaScript heap out of memory`, which says which process ran out of what.
  # `Killed` and exit 137 — pipeline 13121, job 43732 — says neither.
  #
  # It is **here** and not in the job's `variables:` because a job-level
  # `NODE_OPTIONS` reaches every node this script starts: the backend under
  # `tsx`, the seed, and the standalone storefront server the conformance sweep
  # then measures. Capping those is a different decision with no measurement
  # behind it. It is not in `next.config.js` either — a client's build has its
  # own machine and its own budget, and this number is ours.
  storefront_stack_say 'building the storefront…'
  if ! (cd "$REPO_ROOT" && \
        NODE_ENV=production \
        NODE_OPTIONS=--max-old-space-size=1024 \
        NEXT_PUBLIC_API_BASE_URL="$PUBLIC_API_BASE_URL" \
        NEXT_PUBLIC_SITE_URL="$STOREFRONT_URL" \
        BACKEND_BASE_URL="$PUBLIC_API_BASE_URL" \
        pnpm --filter storefront run build) > "$WORK/build.log" 2>&1; then
    tail -60 "$WORK/build.log" >&2
    storefront_stack_die2 'the storefront build failed. There is nothing to serve and no route manifest to read.'
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
  # these jobs measure and what a deployment serves.
  #
  # The standalone tree carries the server and its dependencies and neither the
  # static assets nor `public/`; the Dockerfile copies both into place and so
  # does this.
  storefront_stack_say 'booting the storefront…'
  local standalone="$REPO_ROOT/storefront/.next/standalone/storefront"
  [ -f "$standalone/server.js" ] || storefront_stack_die2 "the build produced no standalone server at $standalone/server.js — which is what \"output: 'standalone'\" makes next build emit."
  mkdir -p "$standalone/.next"
  rm -rf "$standalone/.next/static" "$standalone/public"
  cp -r "$REPO_ROOT/storefront/.next/static" "$standalone/.next/static"
  cp -r "$REPO_ROOT/storefront/public" "$standalone/public"
  setsid env \
    NODE_ENV=production \
    PORT="$STOREFRONT_PORT" \
    HOSTNAME=127.0.0.1 \
    NEXT_PUBLIC_SITE_URL="$STOREFRONT_URL" \
    BACKEND_BASE_URL="$PUBLIC_API_BASE_URL" \
    node "$standalone/server.js" > "$WORK/storefront.log" 2>&1 &
  STOREFRONT_PID=$!
  local up=no
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "$STOREFRONT_URL/"; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    tail -40 "$WORK/storefront.log" >&2
    storefront_stack_die2 'the storefront never answered. Nothing below was measured.'
  fi
}
