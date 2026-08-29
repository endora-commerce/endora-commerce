# syntax=docker/dockerfile:1.7
# Admin — Vite + React SPA. Built to static assets, served by nginx.
#
# Build from the REPO ROOT (pnpm workspace must be visible):
#   docker build -f admin/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.com -t admin .
#
# VITE_API_BASE_URL is inlined into the bundle at BUILD time (host only, no
# /api/v1 suffix — the api-client appends the path).

FROM node:22.17-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Workspace manifests, derived rather than listed ---
# Which directories are workspace members is stated once, in `pnpm-workspace.yaml`; this stage
# asks pnpm instead of keeping a second copy of the answer here. The list this replaced had
# already drifted twice in `backend/Dockerfile` and was missing two members here, and 63 more
# module packages are coming. See `scripts/collect-workspace-manifests.sh`.
FROM base AS manifests
WORKDIR /ctx
COPY . .
RUN sh scripts/collect-workspace-manifests.sh /manifests

FROM base AS build
# Manifests only, so this layer and the install below stay cached until a manifest, the
# lockfile or the workspace file changes — not on every source edit.
COPY --from=manifests /manifests/ ./
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm install --frozen-lockfile --filter admin... --filter @endora-commerce/cms-components

COPY packages/ packages/
COPY admin/ admin/

# Every `@endora-commerce/*` package resolves through its own `exports` map at `./dist` (feature 080,
# T042), so all of admin's workspace dependencies are built, not just the one that ships a
# stylesheet. `admin^...` is admin's dependency closure *without* admin itself — running
# `admin`'s own build here would be `vite build` before the API base URL is set.
RUN pnpm --filter "admin^..." run build

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter admin run build

# --- Runtime: static files behind nginx ---
FROM nginx:1.27-alpine AS run
COPY admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/admin/dist /usr/share/nginx/html
EXPOSE 80
