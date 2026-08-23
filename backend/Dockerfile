# syntax=docker/dockerfile:1.7
# Backend — Fastify API with co-located BullMQ workers (BACKEND_ROLE defaults to "all").
#
# Build from the REPO ROOT so the pnpm workspace is visible:
#   docker build -f backend/Dockerfile -t backend .
#
# The backend itself runs through `tsx` rather than a pre-compiled dist/. This mirrors
# how every backend script (dev, migrate, seed, admin:create) already executes and avoids
# an AOT bundling step the repository has never exercised.
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

# `backend^...` is the backend's workspace-dependency closure without the backend itself:
# the packages it imports, built in topological order. The backend has a `build` script of
# its own and it is deliberately not run — `tsx` is the runtime here.
RUN pnpm --filter "backend^..." run build

ENV NODE_ENV=production
ENV PORT=3001
WORKDIR /app/backend
EXPOSE 3001

# Default process: HTTP API + co-located workers. Compose overrides `command`
# for the one-shot migrate/seed jobs.
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
