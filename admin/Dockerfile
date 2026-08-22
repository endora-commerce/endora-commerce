# syntax=docker/dockerfile:1.7
# Admin — Vite + React SPA. Built to static assets, served by nginx.
#
# Build from the REPO ROOT (pnpm workspace must be visible):
#   docker build -f admin/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.com -t admin .
#
# VITE_API_BASE_URL is inlined into the bundle at BUILD time (host only, no
# /api/v1 suffix — the api-client appends the path).

FROM node:22.17-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json tsconfig.base.json
COPY backend/package.json backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/page-builder-core/package.json packages/page-builder-core/package.json
COPY packages/cms-components/package.json packages/cms-components/package.json
COPY packages/email-components/package.json packages/email-components/package.json
COPY storefront/package.json storefront/package.json
COPY admin/package.json admin/package.json
# `docs` is excluded by .dockerignore and unused by app builds.
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
