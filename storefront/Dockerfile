# syntax=docker/dockerfile:1.7
# Storefront — Next.js 15 (App Router, SSR). Standalone output → slim runtime.
#
# Build from the REPO ROOT (pnpm workspace must be visible):
#   docker build -f storefront/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://example.com \
#     --build-arg NEXT_PUBLIC_SALES_CHANNEL_CODE=pl_default \
#     --build-arg NEXT_PUBLIC_DEFAULT_LOCALE=en-US \
#     -t storefront .
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they
# must be passed as build args. The server-side fetcher reads BACKEND_BASE_URL at
# RUNTIME (set by compose to the internal http://backend:3001).
#
# NEXT_PUBLIC_SITE_URL is this shop's own PUBLIC origin and is not an address of
# the backend. It is what every canonical link, the sitemap and robots.txt name.
# Build without it and the image serves `http://localhost:3000` in all three —
# the fallback in storefront/lib/seo/site-url.ts — with nothing to say so, which
# is what every image this repository built did until 2026-09-06. It cannot be
# repaired on a running container: measured on this tree, `next build` inlines
# the value and drops the variable's name from `.next/server` entirely, and
# `/robots.txt` is prerendered, so its `Sitemap:` line is a static file here.

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

# --- Build ---
FROM base AS build
# Manifests only, so this layer and the install below stay cached until a manifest, the
# lockfile or the workspace file changes — not on every source edit.
COPY --from=manifests /manifests/ ./
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm install --frozen-lockfile --filter storefront... --filter @endora-commerce/cms-components

COPY packages/ packages/
COPY storefront/ storefront/
# `next build` runs ESLint, and `storefront/eslint.config.js` extends the
# repository-root one — which is outside this image's build context without
# this line. It failed non-fatally (`⨯ ESLint: Cannot find module
# '/app/eslint.config.js'`) so the build carried on and the lint step silently
# checked nothing. Same shape as `backend/Dockerfile`'s missing `scripts/`:
# a Dockerfile copying a subset while a build step needs a repo-root file.
COPY eslint.config.js eslint.config.js

# Every `@endora-commerce/*` package resolves through its own `exports` map at `./dist` (feature 080,
# T042), so all of the storefront's workspace dependencies are built, not just the one
# that ships a stylesheet. `storefront^...` is that dependency closure *without* the
# storefront itself — its own build has to run after the NEXT_PUBLIC_* args are set.
RUN pnpm --filter "storefront^..." run build

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SALES_CHANNEL_CODE
ARG NEXT_PUBLIC_DEFAULT_LOCALE
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SALES_CHANNEL_CODE=$NEXT_PUBLIC_SALES_CHANNEL_CODE \
    NEXT_PUBLIC_DEFAULT_LOCALE=$NEXT_PUBLIC_DEFAULT_LOCALE \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter storefront run build

# --- Runtime ---
FROM base AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
# Standalone bundle reproduces the monorepo layout (outputFileTracingRoot=repo root):
#   .next/standalone/storefront/server.js + .next/standalone/node_modules
COPY --from=build /app/storefront/.next/standalone ./
COPY --from=build /app/storefront/.next/static ./storefront/.next/static
COPY --from=build /app/storefront/public ./storefront/public
EXPOSE 3000
CMD ["node", "storefront/server.js"]
