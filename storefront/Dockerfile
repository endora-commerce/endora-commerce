# syntax=docker/dockerfile:1.7
# Storefront — Next.js 15 (App Router, SSR). Standalone output → slim runtime.
#
# Build from the REPO ROOT (pnpm workspace must be visible):
#   docker build -f storefront/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com \
#     --build-arg NEXT_PUBLIC_SALES_CHANNEL_CODE=pl_default \
#     --build-arg NEXT_PUBLIC_DEFAULT_LOCALE=en-US \
#     -t storefront .
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so they
# must be passed as build args. The server-side fetcher reads BACKEND_BASE_URL at
# RUNTIME (set by compose to the internal http://backend:3001).

FROM node:22.17-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# --- Build ---
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json tsconfig.base.json
COPY backend/package.json backend/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/page-builder-core/package.json packages/page-builder-core/package.json
COPY packages/cms-components/package.json packages/cms-components/package.json
COPY storefront/package.json storefront/package.json
COPY admin/package.json admin/package.json
# `docs` is excluded by .dockerignore and unused by app builds.
RUN pnpm install --frozen-lockfile --filter storefront... --filter @b2b/cms-components

COPY packages/ packages/
COPY storefront/ storefront/

# cms-components exposes a prebuilt stylesheet via its "./styles.css" export.
RUN pnpm --filter @b2b/cms-components run build

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SALES_CHANNEL_CODE
ARG NEXT_PUBLIC_DEFAULT_LOCALE
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
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
