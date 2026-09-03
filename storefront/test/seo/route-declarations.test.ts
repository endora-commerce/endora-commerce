import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { canonicalPath } from '../../lib/seo/route-seo';
import { absoluteUrl, siteUrl } from '../../lib/seo/site-url';
import { SITEMAP_DYNAMIC_ROUTES, SITEMAP_STATIC_ROUTES } from '../../app/sitemap';
import robots from '../../app/robots';

/**
 * The two pure halves of the SEO declarations
 * (`specs/098-storefront-ssr-seo-a11y-suite/` Phase 2, FR-011/FR-012).
 *
 * `check:storefront-indexability` answers "does every route declare one, and do
 * the sitemap and the route table agree"; this file answers what that check
 * cannot, because it reads source text rather than running it: whether the
 * canonical a dynamic route *computes* is the path it should be, and whether
 * `robots.txt` and the sitemap point at the origin this deployment declares.
 */

const ORIGIN_KEYS = ['NEXT_PUBLIC_SITE_URL', 'STOREFRONT_URL'] as const;
const ORIGINAL = ORIGIN_KEYS.map((key) => [key, process.env[key]] as const);

afterEach(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('canonicalPath', () => {
  it('substitutes each segment shape Next\'s file tree produces', () => {
    expect(canonicalPath('/catalog', {})).toBe('/catalog');
    expect(canonicalPath('/c/[slug]', { slug: 'pumps' })).toBe('/c/pumps');
    expect(canonicalPath('/cms/[...slug]', { slug: ['about', 'us'] })).toBe('/cms/about/us');
    expect(canonicalPath('/blog/[[...slug]]', { slug: ['first-post'] })).toBe('/blog/first-post');
  });

  it('drops an optional catch-all nobody supplied — the blog index is `/blog`', () => {
    // This is why the sitemap can advertise `/blog` as a static URL while the
    // file that serves it is `blog/[[...slug]]/page.tsx`.
    expect(canonicalPath('/blog/[[...slug]]', {})).toBe('/blog');
    expect(canonicalPath('/', {})).toBe('/');
  });

  it('never emits an absolute URL, so `metadataBase` stays the single origin', () => {
    expect(canonicalPath('/p/[slug]', { slug: 'x' }).startsWith('/')).toBe(true);
  });
});

describe('the declared origin', () => {
  it('prefers `NEXT_PUBLIC_SITE_URL`, then `STOREFRONT_URL`', () => {
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example.com';
    process.env['STOREFRONT_URL'] = 'https://ignored.example.com';
    expect(siteUrl().origin).toBe('https://shop.example.com');
    delete process.env['NEXT_PUBLIC_SITE_URL'];
    expect(siteUrl().origin).toBe('https://ignored.example.com');
  });

  it('falls back rather than throwing on an origin that will not parse', () => {
    // `metadataBase` is read while the page is being rendered, so a `TypeError`
    // here takes the whole page down. An obviously wrong canonical is the
    // direction to be wrong in.
    process.env['NEXT_PUBLIC_SITE_URL'] = 'not a url';
    delete process.env['STOREFRONT_URL'];
    expect(siteUrl().origin).toBe('http://localhost:3000');
  });

  it('is the origin `robots.txt` publishes its sitemap at', () => {
    process.env['NEXT_PUBLIC_SITE_URL'] = 'https://shop.example.com';
    expect(robots().sitemap).toBe('https://shop.example.com/sitemap.xml');
    expect(absoluteUrl('/catalog')).toBe('https://shop.example.com/catalog');
  });
});

describe('the sitemap declaration', () => {
  it('advertises no route `robots.txt` disallows', () => {
    // Two files, one shop. A URL in the sitemap that `robots.txt` refuses is a
    // crawler being told to fetch something it is also told not to fetch, and
    // neither file can see the other.
    const rules = robots().rules;
    const disallowed = (Array.isArray(rules) ? rules : [rules]).flatMap((rule) => {
      const value = rule.disallow ?? [];
      return Array.isArray(value) ? value : [value];
    });
    for (const route of SITEMAP_STATIC_ROUTES) {
      for (const prefix of disallowed) {
        if (prefix === '/') continue;
        expect(route.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('is read by the check exactly as it is written here', () => {
    // The check parses this file's source text rather than importing it, so
    // that it needs no services. The two readings must not come apart.
    const source = readFileSync(
      fileURLToPath(new URL('../../app/sitemap.ts', import.meta.url)),
      'utf8',
    );
    for (const route of [...SITEMAP_STATIC_ROUTES, ...SITEMAP_DYNAMIC_ROUTES]) {
      expect(source).toContain(`'${route}'`);
    }
  });
});
