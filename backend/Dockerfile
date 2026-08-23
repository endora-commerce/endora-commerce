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

# --- Dependencies (layer cached until any manifest changes) ---
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Root base tsconfig — backend/tsconfig.json extends it; tsx reads it at runtime
# for `experimentalDecorators` (MikroORM entities break without it).
COPY tsconfig.base.json tsconfig.base.json
COPY backend/package.json backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/page-builder-core/package.json packages/page-builder-core/package.json
COPY packages/cms-components/package.json packages/cms-components/package.json
COPY packages/email-components/package.json packages/email-components/package.json
# The host package. It is `backend`'s dependency and holds the platform itself —
# `kernel`, `http`, `tenancy`, `commands`, `events` — so without this line
# `--filter backend...` resolves no member for it and the install fails. It was
# absent while the package compiled `backend/src`: nothing depended on it, and
# the image built the platform as part of the backend's own sources.
COPY packages/platform/package.json packages/platform/package.json
COPY storefront/package.json storefront/package.json
COPY admin/package.json admin/package.json
# Note: the `docs` workspace package is excluded from the build context by
# .dockerignore and is not needed by any app build.
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
