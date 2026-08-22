// Storefront — Next.js configuration.
// Per Principle VII (SEO, Performance & Discoverability): this app is deliberately configured for
// server-side rendering of catalog/category/product pages so that search engines and LLM crawlers
// see fully rendered content without JavaScript execution.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
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
