import { describe, expect, it } from 'vitest';

import {
  checkStorefrontIndexability,
  readSitemapDeclaration,
  routePatternOf,
  vacuousReason,
  type RouteFile,
  type StorefrontIndexabilityFindingKind,
  type StorefrontIndexabilityResult,
} from '../../../scripts/check-storefront-indexability.js';
import { readSizeRefusal } from '../../../scripts/lib/read-size.js';

/**
 * Companion test for `check-storefront-indexability`
 * (`specs/098-storefront-ssr-seo-a11y-suite/contracts/seo-declarations.md`).
 *
 * Every proof enters at the **top** of the analysis, over route **source text**
 * and the sitemap's own source text — the two inputs a real run reads (issue
 * #130). A fixture handing in a per-route classification would prove the
 * reporter and leave the classifier, which is the whole analysis, unproven; the
 * classifier is a TypeScript AST walk over `export const metadata` and every
 * `return` of `generateMetadata`, and it is where every one of these findings
 * is decided.
 *
 * The discriminations are asserted beside the reds, because each of them is a
 * shape that a careless narrowing would turn into a finding: a route declaring
 * a canonical only in one branch of `generateMetadata` and a bare
 * `{ title: 'Not found' }` in another is **correct** and must stay clean, and a
 * route declaring `robots` in one branch and `alternates` in another is not
 * contradictory — `contradictory-indexability` is per metadata **object**,
 * because "this page does not resolve, do not index it; otherwise here is its
 * canonical" is the shape four of the nine indexable routes in this tree ship.
 */

const APP_ROOT = 'storefront/app';

/** The sitemap this tree ships, as the check reads it: two string arrays. */
function sitemapText(
  staticRoutes: readonly string[],
  dynamicRoutes: readonly string[] = [],
): string {
  return [
    `export const SITEMAP_STATIC_ROUTES: readonly string[] = [`,
    ...staticRoutes.map((route) => `  '${route}',`),
    `];`,
    `export const SITEMAP_DYNAMIC_ROUTES: readonly string[] = [`,
    ...dynamicRoutes.map((route) => `  '${route}',`),
    `];`,
  ].join('\n');
}

function page(path: string, body: string, seoText: string | null = null): RouteFile {
  return { path: `${APP_ROOT}${path}`, text: body, seoText };
}

/** The declaration an indexable route ships beside its `page.tsx`. */
const SEO_DECLARATION = `export const seo: RouteSeo = { route: '/catalog', jsonLd: ['BreadcrumbList'] };`;

const INDEXABLE_BODY = `import type { Metadata } from 'next';
import { seo } from './seo';
export const metadata: Metadata = { alternates: { canonical: seo.route } };
export default function Page() { return null; }
`;

const NOINDEX_BODY = `import type { Metadata } from 'next';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default function Page() { return null; }
`;

/**
 * The control every proof runs beside: an indexable route the sitemap
 * advertises, with its structured-data declaration. Without it a run holding
 * only the violation would be refused for classifying nothing, and the proof
 * would assert the refusal rather than the finding.
 */
const CLEAN_CATALOG = page('/(catalog)/catalog/page.tsx', INDEXABLE_BODY, SEO_DECLARATION);

function run(
  routes: readonly RouteFile[],
  staticRoutes: readonly string[] = ['/catalog'],
  dynamicRoutes: readonly string[] = [],
): StorefrontIndexabilityResult {
  return checkStorefrontIndexability({
    appRoot: APP_ROOT,
    routes,
    sitemapText: sitemapText(staticRoutes, dynamicRoutes),
  });
}

function findingsOf(
  result: StorefrontIndexabilityResult,
  kind: StorefrontIndexabilityFindingKind,
): readonly string[] {
  return result.findings
    .filter((finding) => finding.kind === kind)
    .map((finding) => finding.subject);
}

describe('check-storefront-indexability — the route pattern', () => {
  it('strips route groups, keeps dynamic segments, and answers `/` for the root page', () => {
    // The pattern is the vocabulary the sitemap speaks, so it is derived once
    // and every reconciliation below rests on it.
    expect(routePatternOf('storefront/app/page.tsx', APP_ROOT)).toBe('/');
    expect(routePatternOf('storefront/app/(catalog)/catalog/page.tsx', APP_ROOT)).toBe('/catalog');
    expect(routePatternOf('storefront/app/(catalog)/c/[slug]/page.tsx', APP_ROOT)).toBe('/c/[slug]');
    expect(routePatternOf('storefront/app/(content)/[...slug]/page.tsx', APP_ROOT)).toBe(
      '/[...slug]',
    );
    expect(routePatternOf('storefront/app/blog/[[...slug]]/page.tsx', APP_ROOT)).toBe(
      '/blog/[[...slug]]',
    );
  });
});

describe('check-storefront-indexability — what it refuses', () => {
  it('reports a route that declares neither indexability nor a canonical', () => {
    const result = run([
      CLEAN_CATALOG,
      page('/wholesale/page.tsx', 'export default function Page() { return null; }\n'),
    ]);
    expect(findingsOf(result, 'undeclared-indexability')).toEqual(['/wholesale']);
  });

  it('reports a route whose one metadata object declares both `noindex` and a canonical', () => {
    const result = run([
      CLEAN_CATALOG,
      page(
        '/wholesale/page.tsx',
        `export const metadata = {
           robots: { index: false, follow: false },
           alternates: { canonical: '/wholesale' },
         };
         export default function Page() { return null; }
        `,
      ),
    ]);
    expect(findingsOf(result, 'contradictory-indexability')).toEqual(['/wholesale']);
  });

  it('reports a route whose declaration it cannot read — never a skip (issue #113)', () => {
    // A computed `robots` value. Taken for "indexable" it agrees with
    // everything; taken for "non-indexable" it excuses everything.
    const result = run([
      CLEAN_CATALOG,
      page(
        '/wholesale/page.tsx',
        `import { CRAWLER_POLICY } from '../../lib/policy';
         export const metadata = { robots: CRAWLER_POLICY };
         export default function Page() { return null; }
        `,
      ),
    ]);
    expect(findingsOf(result, 'unresolvable-indexability')).toEqual(['/wholesale']);
  });

  it('reports a route the sitemap advertises that declares no canonical', () => {
    const result = run(
      [CLEAN_CATALOG, page('/wholesale/page.tsx', 'export default function Page() { return null; }\n')],
      ['/catalog', '/wholesale'],
    );
    expect(findingsOf(result, 'missing-canonical')).toEqual(['/wholesale']);
    // And it is not *also* reported as undeclared: the sitemap classified it,
    // so the route owes a canonical rather than a classification.
    expect(findingsOf(result, 'undeclared-indexability')).toEqual([]);
  });

  it('reports an indexable route the sitemap does not advertise', () => {
    const result = run(
      [CLEAN_CATALOG, page('/wholesale/page.tsx', INDEXABLE_BODY, SEO_DECLARATION)],
      ['/catalog'],
    );
    expect(findingsOf(result, 'sitemap-orphan-route')).toEqual(['/wholesale']);
  });

  it('reports a sitemap entry that matches no route file', () => {
    const result = run([CLEAN_CATALOG], ['/catalog', '/wholesale']);
    expect(findingsOf(result, 'orphan-sitemap-entry')).toEqual(['/wholesale']);
  });

  it('reports an indexable route that declares no structured-data types', () => {
    // The declaration is what Phase 4 asserts the served HTML against, so an
    // indexable route without one is a route whose JSON-LD nothing can check.
    const result = run([page('/(catalog)/catalog/page.tsx', INDEXABLE_BODY, null)]);
    expect(findingsOf(result, 'undeclared-structured-data')).toEqual(['/catalog']);
  });
});

describe('check-storefront-indexability — what it must not report', () => {
  it('clears a route that declares a canonical in one branch and a bare title in another', () => {
    // Four of the nine indexable routes in this tree are exactly this shape.
    const result = run([
      page(
        '/(catalog)/catalog/page.tsx',
        `export async function generateMetadata() {
           const page = await load();
           if (!page) return { title: 'Not found' };
           return { title: page.name, alternates: { canonical: '/catalog' } };
         }
         export default function Page() { return null; }
        `,
        SEO_DECLARATION,
      ),
    ]);
    expect(result.findings).toEqual([]);
    expect(result.indexable).toEqual(['/catalog']);
  });

  it('clears a route whose `noindex` and canonical are in different metadata objects', () => {
    // "This page does not resolve, do not index it; otherwise here is its
    // canonical" is correct, and per-file contradiction detection would report
    // every dynamic route in the tree.
    const result = run([
      page(
        '/(catalog)/catalog/page.tsx',
        `export async function generateMetadata() {
           const page = await load();
           if (!page) return { title: 'Not found', robots: { index: false, follow: false } };
           return { alternates: { canonical: '/catalog' } };
         }
         export default function Page() { return null; }
        `,
        SEO_DECLARATION,
      ),
    ]);
    expect(result.findings).toEqual([]);
  });

  it('clears a non-indexable route, and does not ask it for a canonical or a sitemap entry', () => {
    const result = run([CLEAN_CATALOG, page('/account/page.tsx', NOINDEX_BODY)]);
    expect(result.findings).toEqual([]);
    expect(result.nonIndexable).toContain('/account');
  });

  it('matches an optional catch-all against the static URL its empty case serves', () => {
    // `/blog` is a URL; `/blog/[[...slug]]` is the file that serves it.
    const result = run(
      [page('/blog/[[...slug]]/page.tsx', INDEXABLE_BODY, SEO_DECLARATION)],
      ['/blog'],
    );
    expect(result.findings).toEqual([]);
  });

  it('prefers the most specific route when a catch-all could also match', () => {
    // `/[...slug]` matches `/catalog` too. Reporting `/catalog` as served by
    // the CMS catch-all would make the reconciliation agree with the wrong file.
    const result = run(
      [CLEAN_CATALOG, page('/(content)/[...slug]/page.tsx', INDEXABLE_BODY, SEO_DECLARATION)],
      ['/catalog'],
      ['/[...slug]'],
    );
    expect(findingsOf(result, 'orphan-sitemap-entry')).toEqual([]);
    expect(findingsOf(result, 'sitemap-orphan-route')).toEqual([]);
  });
});

describe('check-storefront-indexability — when it may not report at all', () => {
  it('refuses a run with no page file — a moved `storefront/app` (issue #215)', () => {
    const result = checkStorefrontIndexability({
      appRoot: APP_ROOT,
      routes: [],
      sitemapText: sitemapText(['/catalog']),
    });
    expect(vacuousReason(result)?.kind).toBe('no-page-file');
  });

  it('refuses a run whose sitemap it could not read — the second author is gone', () => {
    for (const text of [
      null,
      'export const SITEMAP_STATIC_ROUTES = ROUTES;',
      sitemapText([], []),
    ]) {
      const result = checkStorefrontIndexability({
        appRoot: APP_ROOT,
        routes: [CLEAN_CATALOG],
        sitemapText: text,
      });
      expect(vacuousReason(result)?.kind).toBe('unreadable-sitemap');
    }
  });

  it('refuses a run in which nothing was classified either way', () => {
    const result = run([
      page('/a/page.tsx', 'export default function Page() { return null; }\n'),
      page('/b/page.tsx', 'export default function Page() { return null; }\n'),
    ]);
    expect(vacuousReason(result)?.kind).toBe('nothing-classified');
  });

  it('refuses a partially moved tree through the sitemap coverage floor', () => {
    // #215's predicate is not "the walk came back empty" — it is "the walk
    // disagreed with an independent second author about how much there was to
    // read". Half the routes gone leaves the other half readable and clean.
    const result = run([CLEAN_CATALOG], ['/catalog', '/kontakt', '/blog']);
    expect(
      readSizeRefusal({
        prefix: '[storefront-indexability]',
        files: result.filesRead.length,
        sites: result.classified.length,
        coverage: [
          { source: 'sitemap', expected: result.sitemapExpected, covered: result.sitemapCovered },
        ],
      })?.kind,
    ).toBe('short-walk');
  });
});

describe('check-storefront-indexability — the sitemap reader', () => {
  it('reads both declared arrays and refuses an element it cannot resolve', () => {
    expect(readSitemapDeclaration(sitemapText(['/', '/catalog'], ['/p/[slug]']))).toEqual({
      staticRoutes: ['/', '/catalog'],
      dynamicRoutes: ['/p/[slug]'],
    });
    // A computed entry makes the whole set unreadable rather than shorter: a
    // second author that answers about part of itself is not a second author.
    expect(
      readSitemapDeclaration(
        `export const SITEMAP_STATIC_ROUTES: readonly string[] = ['/', HOME_ALIAS];
         export const SITEMAP_DYNAMIC_ROUTES: readonly string[] = [];`,
      ),
    ).toBeNull();
  });
});
