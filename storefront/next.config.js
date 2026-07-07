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
  // packages (@b2b/*) are bundled into the standalone output.
  outputFileTracingRoot: path.join(dirname, '..'),
  // Enable typed Link and route typing — surfaces missing routes at build time.
  typedRoutes: true,
  // Workspace packages publish TypeScript source (main: "./src/index.ts") and use the
  // NodeNext convention of `.js` extensions in relative imports that resolve to `.tsx`/`.ts`
  // sources. Next.js needs both to be told to compile the source AND to rewrite extensions.
  transpilePackages: ['@b2b/cms-components', '@b2b/page-builder-core', '@b2b/api-client', '@b2b/contracts'],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.tsx', '.ts', '.js'],
      '.jsx': ['.tsx', '.jsx'],
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
