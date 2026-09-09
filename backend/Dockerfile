# syntax=docker/dockerfile:1.7
# Backend — Fastify API with co-located BullMQ workers (BACKEND_ROLE defaults to "all").
#
# Build from the REPO ROOT so the pnpm workspace is visible:
#   docker build -f backend/Dockerfile -t backend .
#
# **The backend runs built output** (feature 080, D-165). It used to run through `tsx`, on
# the ground that this "mirrors how every backend script already executes and avoids an AOT
# bundling step the repository has never exercised". Both halves were true and neither
# survived measurement: `backend/package.json` has declared `"start": "node dist/index.js"`
# since it was written, four source files carry a `RUNNING_FROM_DIST` branch, and
# `static-registry.ts` explains in prose why production uses static imports — the tree was
# written for a compiled application and then never compiled. Measured on one machine,
# three runs each: boot to first request 11.9 s -> 5.3 s, resident 838–851 MB across five
# processes -> 480–486 MB in one. On a single-VPS deployment — the constraint that produced
# `check:pdfmake-footprint` — that is not decoration.
#
# What makes it safe to say so is `scripts/boot-gate.sh`, which builds this image, migrates
# a throwaway database, boots it and asserts the platform is what the source says. Two
# defects were *reproduced* on the half-built compiled path, not predicted: 45 of 45 modules
# installing no translations while the boot reported `installed=0 failed=0`, and every
# overlay module vanishing with no error. Both are invisible to a type-check and to every
# static check in the tree, because in all of those the tree is the source tree.
#
# Its workspace packages are the opposite case since feature 080 (T042): each `@endora-commerce/*`
# package resolves through its own `exports` map at `./dist`, so they are compiled below,
# before the source is anything the runtime can reach. **`@endora-commerce/platform` is one of
# them and carries the platform itself**, so `pnpm --filter "backend^..." run build` below is no
# longer only a convenience for the frontend component packages — the backend does not start
# without it.
#
# The build is split in two on purpose — manifests, install, then sources — so that editing a
# source file does not re-run the install. What that split must never become is a *list* of the
# manifests: which directories are workspace members is stated once, in `pnpm-workspace.yaml`,
# and a copy of that answer kept here goes stale silently. It did, twice —
# `packages/platform` was added by hand and `packages/modules/blog` was missed, so `blog` was
# not a member at install time, its `@mikro-orm/migrations` peer resolved to nothing, and the
# build failed 40 lines deep in a migration with `Property 'addSql' does not exist`. The
# `manifests` stage below derives the set instead; see its own comment.

FROM node:22.17-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# argon2 ships a native addon; these cover the case where no prebuilt binary
# matches the target platform/arch.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Workspace manifests, derived rather than listed ---
# The whole context goes into this stage, `scripts/collect-workspace-manifests.sh` asks pnpm
# which directories are members and keeps their `package.json` files, and everything else is
# dropped. What it costs: this stage's layer is invalidated by any source change, so every
# build pays one context copy plus one `pnpm ls` — about a second. What it buys: `COPY --from`
# is keyed on the *content* of what it copies, so the dependency layer below still changes only
# when a manifest, the lockfile or the workspace file does. That is the cache behaviour the
# hand-written list had, and the alternative — moving `COPY packages/` above the install —
# would have given it up on every source edit.
FROM base AS manifests
WORKDIR /ctx
COPY . .
RUN sh scripts/collect-workspace-manifests.sh /manifests

FROM base AS app
# --- Dependencies (layer cached until a manifest, the lockfile or the workspace file changes) ---
COPY --from=manifests /manifests/ ./
# Root base tsconfig — backend/tsconfig.json extends it; tsx reads it at runtime
# for `experimentalDecorators` (MikroORM entities break without it).
COPY tsconfig.base.json tsconfig.base.json
# `backend...` = backend plus its workspace dependencies. devDependencies are
# kept on purpose — tsx is the runtime, and the migrate/seed scripts need it too.
RUN pnpm install --frozen-lockfile --filter backend...

# --- Source ---
COPY packages/ packages/
COPY backend/ backend/
# A workspace package whose build runs a repository-root script — `tsc && node
# ../../../scripts/copy-package-assets.mjs` is the shape (criterion 8) — needs
# that script inside the build context, so `scripts/` is one of this image's
# inputs and not a developer convenience. **Which packages those are is a
# property of the build closure below**, derived from every member's manifest,
# and it moves without this file moving: `build:admin` of pipeline 13398 died on
# `Cannot find module '/app/scripts/copy-package-assets.mjs'` because a member of
# that image's closure had grown such a build step while its Dockerfile had not
# grown this line, which this one had carried for months. Nothing in a
# source-tree check sees an absent one — the boot gate builds *this* image, and
# `backend/test/unit/ci/image-root-script-supply.test.ts` is the rule over all
# three.
COPY scripts/ scripts/

# `backend^...` is the backend's workspace-dependency closure without the backend itself:
# the packages it imports, built in topological order. It has to come first: the backend's
# own build clears `paths` and resolves every `@endora-commerce/*` specifier through
# `node_modules` at each package's `./dist`, exactly as an installed consumer does.
RUN pnpm --filter "backend^..." run build

# The application itself. `build` is `tsc -p tsconfig.build.json` + `copy-runtime-assets`,
# and the second of those is not a convenience: `tsc` compiles `.ts` and copies nothing
# else, so without it the built tree holds every module's code and none of its data — which
# is D-165.3's first silence, and it is silent because an absent bundles directory reads as
# "this module ships no translatable strings". That step audits its own output against the
# registered manifests and fails the build.
#
# **It compiles the committed tree; it does not re-derive it.** `build` used to run
# `overlay:divergence` and `composer:generate` first, from the day feature 018 wrote the first
# generator — and both of them read the *whole* workspace, while this stage holds a strict
# subset of it. That went unnoticed for four months and then stopped the image dead: feature
# 091's fifth artefact is `admin/src/modules.generated.ts`, whose path is derived from the
# workspace member declaring the `"@/*"` tsconfig alias, and `admin/` is not copied here —
# so `composer:generate` raised `AdminLayoutUnresolvableError`, correctly, and `tsc` never
# ran. Tolerating the absence was rejected: `admin/package.json` *is* here (the manifests
# stage collects every member's), so from inside the image "the admin application was not
# copied" and "the admin application stopped declaring its alias" are the same observation,
# and a tolerance would have to guess. Copying `admin/` was rejected too — this is the final
# stage, so its sources would ship in the production image, and an admin-only commit would
# invalidate both `RUN … build` layers.
#
# Nothing is lost by leaving generation out. All five composer artefacts and every override
# manifest are committed, and `overlay:check` refuses a stale, non-deterministic or foreign
# one in the `quality` job — which carries no `changes:` filter, so it runs on every merge
# request and every push to the default branch. Re-deriving them here never *added* a
# defence: it wrote its answer into the image and not into the tree, so a build over a
# checkout whose artefacts were stale produced a working image and left the drift unreported.
#
# The heap is capped explicitly for the same reason `quality` caps it: Node sizes its
# default old-space from what it believes is available, and inside a memory-limited build
# container that is the limit rather than the host. Inline rather than `ENV`, so the cap
# belongs to the compile and does not follow the application into production.
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm --filter backend run build

# The one per-instance build input the backend image takes (feature 110, FR-009).
# It names the deployment whose overlay modules and `divergence.ts` this image
# composes, and it is baked rather than left to runtime so that an image *is* the
# deployment it was built for. Unset is bare core and stays byte-for-byte bare
# core: `selectedDeployment` reads a blank value as no deployment at all, which is
# what an unpassed `--build-arg` leaves behind. Compose may still override it at
# runtime — an operator moving one image between deployments is their decision,
# not something this line takes away.
ARG DEPLOYMENT
ENV DEPLOYMENT=$DEPLOYMENT

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app/backend
EXPOSE 3001

# Default process: HTTP API + co-located workers, from the built tree (D-165). Compose
# overrides `command` for the one-shot migrate job, which names `dist/db/migrate.js` for
# the same reason. `scripts/boot-gate.sh` refuses an image whose command is anything else:
# one that still ran the interpreter would pass every other assertion that gate makes while
# being precisely the thing this ruling exists to stop.
CMD ["node", "dist/index.js"]
