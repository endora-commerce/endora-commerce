import type { MetadataRoute } from 'next';

import { absoluteUrl } from '../lib/seo/site-url';

/**
 * What a crawler may fetch (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-011).
 *
 * The disallow list is the **route-group** answer, one prefix per family of
 * pages that must not be indexed, and it is deliberately a coarse mirror of the
 * per-route `robots: { index: false }` declarations rather than a second
 * statement of them: `robots.txt` governs *fetching*, page metadata governs
 * *indexing*, and the two are different instruments. The per-route declaration
 * is the one `check:storefront-indexability` reads; this file keeps a crawler
 * from spending its budget on 48 pages it will be told not to index anyway.
 *
 * `/api/` is here because `storefront/app/api/` holds five route handlers that
 * emit no document at all.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/account',
          '/addresses',
          '/orders',
          '/organization',
          '/preferences',
          '/quick-order',
          '/quote-request',
          '/quote-requests',
          '/returns',
          '/shopping-lists',
          '/newsletter',
          '/compare',
          '/cart',
          '/checkout',
          '/login',
          '/register',
          '/register-customer',
          '/password-reset',
          '/verify',
          '/auth/',
          '/invitations/',
          '/offline',
        ],
      },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
