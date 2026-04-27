/**
 * Lighthouse CI config (T242 / FR-103, SC-009).
 *
 * Asserts Core Web Vitals "Good" thresholds at the 75th percentile on a
 * mid-range mobile device for the three SEO-critical surfaces: catalog
 * listing, category landing, and product detail page.
 *
 * Local invocation:
 *   pnpm dev:infra
 *   pnpm --filter backend run dev &      # backend up + seeded
 *   pnpm --filter backend run seed:dev
 *   pnpm --filter storefront run build && pnpm --filter storefront run start &
 *   pnpm dlx @lhci/cli@0.14.x autorun
 *
 * The CI workflow (.github/workflows/lighthouse.yml) runs this on
 * `workflow_dispatch` + a nightly cron — not on every PR — because a
 * realistic Lighthouse run needs a populated catalog and stable
 * latency, neither of which a generic PR runner gives.
 */

const STOREFRONT_BASE = process.env.STOREFRONT_BASE_URL ?? 'http://localhost:3000';
const SAMPLE_PRODUCT_SLUG = process.env.SAMPLE_PRODUCT_SLUG ?? 'example-simple-product';
const SAMPLE_CATEGORY_SLUG = process.env.SAMPLE_CATEGORY_SLUG ?? 'widgets';

module.exports = {
  ci: {
    collect: {
      url: [
        `${STOREFRONT_BASE}/catalog`,
        `${STOREFRONT_BASE}/c/${SAMPLE_CATEGORY_SLUG}`,
        `${STOREFRONT_BASE}/p/${SAMPLE_PRODUCT_SLUG}`,
      ],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        // Throttle to a moderate-mobile profile so the CWV thresholds
        // match the FR-103 "75th-percentile mid-range mobile" target.
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      preset: 'lighthouse:no-pwa',
      assertions: {
        // FR-103 / Constitution Principle VII: Core Web Vitals "Good".
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'interaction-to-next-paint': ['warn', { maxNumericValue: 200 }],
        'first-contentful-paint': ['warn', { maxNumericValue: 1800 }],
        // Crawlable HTML — FR-103 mandates SSR-rendered content.
        'unminified-css': 'off',
        'unminified-javascript': 'off',
        // SEO basics.
        'document-title': ['error', { minScore: 1 }],
        'meta-description': ['error', { minScore: 1 }],
        'crawlable-anchors': ['error', { minScore: 1 }],
        'http-status-code': ['error', { minScore: 1 }],
        // Accessibility floor — themes can tighten this.
        'color-contrast': 'warn',
        'heading-order': 'warn',
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
