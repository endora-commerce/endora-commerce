// Storefront — Next.js configuration.
// Per Principle VII (SEO, Performance & Discoverability): this app is deliberately configured for
// server-side rendering of catalog/category/product pages so that search engines and LLM crawlers
// see fully rendered content without JavaScript execution.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Enable typed Link and route typing — surfaces missing routes at build time.
    typedRoutes: true,
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
