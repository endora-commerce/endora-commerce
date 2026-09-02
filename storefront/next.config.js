// Storefront — Next.js configuration.
// Per Principle VII (SEO, Performance & Discoverability): this app is deliberately configured for
// server-side rendering of catalog/category/product pages so that search engines and LLM crawlers
// see fully rendered content without JavaScript execution.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Cap the build's worker parallelism. `build:storefront` was killed by the
   * host's OOM killer on `master` (pipelines 11950 and 11951) even with
   * `resource_group: image-builds` giving it the machine to itself, so this is
   * the same "necessary and not sufficient" shape `.gitlab-ci.yml`'s Memory
   * block already records for the backend shards.
   *
   * Measured on one machine (16 cores), peak RSS of the whole process group:
   *
   *   default parallelism ................ 6144 MB
   *   `cpus: 2` .......................... 2722 MB
   *   `cpus: 1` .......................... 2777 MB
   *
   * Two workers cost the same as one and do more, so the jump is between two
   * and "as many as the host has cores" rather than being linear — which is
   * why a cap fixes this and a bigger box only postpones it.
   *
   * **A hypothesis measured and refuted, kept because it is the obvious one:**
   * `next build` re-runs the type-check and ESLint that `quality` has already
   * run over the whole tree, and disabling both looked like the lever. It is
   * not — 6334 MB without them against 6144 MB with, which is noise. The
   * duplication is real and is `build:admin`'s recorded reason for not running
   * `tsc`, but it is not what makes this build large.
   */
  experimental: { cpus: 2 },
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained production server (`.next/standalone/storefront/server.js`)
  // for a slim Docker runtime image — no full node_modules at runtime.
  output: 'standalone',
  // The app lives in a pnpm monorepo; trace from the repo root so the workspace
  // packages (@endora-commerce/*) are bundled into the standalone output.
  outputFileTracingRoot: path.join(dirname, '..'),
  // Enable typed Link and route typing — surfaces missing routes at build time.
  typedRoutes: true,
  // Workspace packages resolve at `./dist` since feature 080 (T042). They stay on this
  // list because they are still ESM emitted from this monorepo rather than a published
  // tarball: Next.js applies its own SWC pipeline (`"use client"` boundaries, the JSX
  // runtime) only to what it transpiles. `extensionAlias` below is the other half — the
  // NodeNext `.js` specifiers in their relative imports resolved to `.ts`/`.tsx` before
  // the build existed and now resolve to the emitted `.js`, so both spellings are listed.
  transpilePackages: ['@endora-commerce/cms-components', '@endora-commerce/page-builder-core', '@endora-commerce/api-client', '@endora-commerce/contracts'],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.tsx', '.ts', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    // CMS Page Builder client chunk is large (Puck + shared components). Dev HMR
    // otherwise times out with ChunkLoadError when navigating to /cms/*.
    config.output = {
      ...config.output,
      chunkLoadTimeout: 120_000,
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
