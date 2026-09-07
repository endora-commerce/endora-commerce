import { describe, expect, it } from 'vitest';

import {
  checkStorefrontIndexability,
  readReservedSegments,
  readSitemapDeclaration,
  routePatternOf,
  topLevelSegmentsOf,
  vacuousReason,
  readStatusDecisions,
  boundariesAbove,
  type RouteFile,
  type SegmentWalk,
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

/**
 * `storefront/app/reserved-segments.ts` as the check reads it: one string array
 * (feature 105, FR-034).
 */
function reservedText(segments: readonly string[]): string {
  return [
    `export const RESERVED_TOP_LEVEL_SEGMENTS: readonly string[] = [`,
    ...segments.map((segment) => `  '${segment}',`),
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

/**
 * A page that decides a response status on the document render path.
 *
 * Source text with the import in it, because the five calls are bound through
 * `next/navigation` and not by spelling — a fixture writing only `notFound()`
 * would prove nothing about the binding.
 */
const DECIDING_BODY = `import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
export const metadata: Metadata = { robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const row = await load(slug);
  if (!row) notFound();
  return null;
}
`;

/**
 * The same decision, inside a server action.
 *
 * §2.3, and the discrimination the whole classifier turns on: 224 of this
 * tree's 292 such calls live in a shape like this one, measured correct with a
 * boundary standing, and 33 of them are the authentication guards a classifier
 * blind to the directive would report.
 */
const ACTION_BODY = `import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
export const metadata: Metadata = { robots: { index: false, follow: false } };
async function save(form: FormData) {
  'use server';
  await persist(form);
  redirect('/thanks');
}
export default function Page() {
  return <form action={save} />;
}
`;

/** A boundary walk that found the named files and could read every directory. */
function boundaries(...files: readonly string[]): SegmentWalk {
  return { boundaries: files.map((file) => `${APP_ROOT}${file}`), unreadable: [] };
}

/**
 * A run over these routes.
 *
 * `reserved` defaults to exactly the segments the fixture's own routes produce,
 * so a proof about indexability is never accidentally also a proof about
 * feature 105's reconciliation — the two reds have to be asked for.
 */
function run(
  routes: readonly RouteFile[],
  staticRoutes: readonly string[] = ['/catalog'],
  dynamicRoutes: readonly string[] = [],
  segments: SegmentWalk = { boundaries: [], unreadable: [] },
  reserved?: { readonly segments?: readonly string[]; readonly handlerPaths?: readonly string[] },
): StorefrontIndexabilityResult {
  const handlerPaths = reserved?.handlerPaths ?? [];
  return checkStorefrontIndexability({
    appRoot: APP_ROOT,
    routes,
    handlerPaths,
    sitemapText: sitemapText(staticRoutes, dynamicRoutes),
    reservedSegmentsText: reservedText(
      reserved?.segments ??
        topLevelSegmentsOf([...routes.map((route) => route.path), ...handlerPaths], APP_ROOT),
    ),
    segments,
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

describe('check-storefront-indexability — a status decision under a boundary', () => {
  /**
   * `specs/108-storefront-response-status/contracts/response-status.md` §5, and
   * every case below is a conjunction: the page decides *and* a boundary sits
   * above it. Both halves have their own discrimination, because getting either
   * wrong makes the check useless in a different direction — a classifier blind
   * to `'use server'` reports 33 correct authentication guards, and one blind to
   * ancestry reports the one shape this tree actually had as clean.
   */
  const deciding = page('/wholesale/[slug]/page.tsx', DECIDING_BODY);

  it('reports a boundary in the page\'s own segment', () => {
    // Measured on a real build: with the root `loading.tsx` removed and one
    // added at the page's own segment, `/p/missing` went back to 200 while a
    // sibling route with no boundary of its own kept its 308.
    const result = run(
      [CLEAN_CATALOG, deciding],
      ['/catalog'],
      [],
      boundaries('/wholesale/[slug]/loading.tsx'),
    );
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual(['/wholesale/[slug]']);
  });

  it('reports a boundary in an ancestor segment, route groups included', () => {
    // The shape this tree had: one `app/loading.tsx`, three directories above
    // the nearest of the 68 call sites it defeated. The chain is *directories*
    // and not route segments — a route group contributes no URL segment and
    // does contribute a directory Next reads a `loading.tsx` out of.
    for (const boundary of ['/loading.tsx', '/wholesale/loading.tsx']) {
      const result = run([CLEAN_CATALOG, deciding], ['/catalog'], [], boundaries(boundary));
      expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual(['/wholesale/[slug]']);
    }
    const grouped = page('/(shop)/wholesale/page.tsx', DECIDING_BODY);
    const result = run([CLEAN_CATALOG, grouped], ['/catalog'], [], boundaries('/(shop)/loading.tsx'));
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual(['/wholesale']);
  });

  it('reads `template.tsx` as the same boundary', () => {
    const result = run(
      [CLEAN_CATALOG, deciding],
      ['/catalog'],
      [],
      boundaries('/wholesale/template.tsx'),
    );
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual(['/wholesale/[slug]']);
  });

  it('says nothing about a deciding page with no boundary above it', () => {
    const result = run([CLEAN_CATALOG, deciding]);
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual([]);
  });

  it('says nothing about a boundary over a page that decides nothing', () => {
    // `/catalog` is this: it keeps its `loading.tsx` because it decides no
    // status, and a rule that reported it would be a rule asking the storefront
    // to give up every skeleton it has.
    const result = run(
      [CLEAN_CATALOG, deciding],
      ['/catalog'],
      [],
      boundaries('/(catalog)/catalog/loading.tsx'),
    );
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual([]);
  });

  it('says nothing about a boundary in a sibling segment', () => {
    const result = run([CLEAN_CATALOG, deciding], ['/catalog'], [], boundaries('/other/loading.tsx'));
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual([]);
  });

  it('says nothing about a `\'use server\'` decision under a boundary', () => {
    // §5.4 — the one that must not fire. The finding here would be reported
    // against a call that is measured correct: an action redirect answers 303
    // with `x-action-redirect` while the boundary stands, because an action's
    // result is never the document shell.
    const action = page('/checkout/page.tsx', ACTION_BODY);
    const result = run([CLEAN_CATALOG, action, deciding], ['/catalog'], [], boundaries('/loading.tsx'));
    expect(findingsOf(result, 'status-decision-under-a-boundary')).toEqual(['/wholesale/[slug]']);
  });
});

describe('check-storefront-indexability — reading the decision itself', () => {
  it('reads the five calls, and only through their `next/navigation` binding', () => {
    const read = (body: string): readonly string[] =>
      readStatusDecisions(body, 'storefront/app/x/page.tsx').map((one) => one.call);

    expect(
      read(
        "import { notFound, redirect, permanentRedirect } from 'next/navigation';\n" +
          'export default function Page() { notFound(); redirect("/a"); permanentRedirect("/b"); }\n',
      ),
    ).toEqual(['notFound', 'redirect', 'permanentRedirect']);

    // `authInterrupts`, which nothing in this tree uses yet — and the refactor
    // this feature makes attractive is exactly the one that reaches for them.
    expect(
      read(
        "import { forbidden, unauthorized } from 'next/navigation';\n" +
          'export default function Page() { forbidden(); unauthorized(); }\n',
      ),
    ).toEqual(['forbidden', 'unauthorized']);

    // A page's own helper of the same name decides nothing. Spelling would
    // report it; the import binding does not.
    expect(read('function redirect(to) {}\nexport default function Page() { redirect("/a"); }\n')).toEqual(
      [],
    );

    // An alias is followed, because the call is the same call.
    expect(
      read(
        "import { notFound as missing } from 'next/navigation';\n" +
          'export default function Page() { missing(); }\n',
      ),
    ).toEqual(['notFound']);

    // And so is a namespace import.
    expect(
      read(
        "import * as nav from 'next/navigation';\n" +
          'export default function Page() { nav.notFound(); }\n',
      ),
    ).toEqual(['notFound']);
  });

  it('reads a file-level `\'use server\'` as making every call in it an action', () => {
    expect(
      readStatusDecisions(
        "'use server';\nimport { redirect } from 'next/navigation';\n" +
          'export async function go() { redirect("/a"); }\n',
        'storefront/app/x/actions.ts',
      ),
    ).toEqual([]);
  });

  it('carries the directive into everything nested inside the action', () => {
    // A callback inside a `'use server'` function is still inside the action,
    // and a decision after it in the same file is not.
    const decisions = readStatusDecisions(
      "import { redirect, notFound } from 'next/navigation';\n" +
        'async function save() {\n' +
        "  'use server';\n" +
        '  await items.forEach(() => { redirect("/a"); });\n' +
        '}\n' +
        'export default function Page() { notFound(); }\n',
      'storefront/app/x/page.tsx',
    );
    expect(decisions.map((one) => one.call)).toEqual(['notFound']);
  });

  it('names the line, so the finding points at something a reader can open', () => {
    const [first] = readStatusDecisions(
      "import { notFound } from 'next/navigation';\n\nexport default function Page() {\n  notFound();\n}\n",
      'storefront/app/x/page.tsx',
    );
    expect(first?.line).toBe(4);
  });
});

describe('check-storefront-indexability — the boundary chain', () => {
  it('walks directories up to the app root and stops there', () => {
    const found = [
      'storefront/app/loading.tsx',
      'storefront/app/(catalog)/loading.tsx',
      'storefront/app/(catalog)/p/[slug]/loading.tsx',
      'storefront/app/(catalog)/catalog/loading.tsx',
      'storefront/other/loading.tsx',
    ];
    expect(boundariesAbove('storefront/app/(catalog)/p/[slug]/page.tsx', found, APP_ROOT)).toEqual([
      'storefront/app/loading.tsx',
      'storefront/app/(catalog)/loading.tsx',
      'storefront/app/(catalog)/p/[slug]/loading.tsx',
    ]);
    // A boundary outside the app root is somebody else's file, and a sibling
    // segment's is not above this page.
    expect(boundariesAbove('storefront/app/page.tsx', found, APP_ROOT)).toEqual([
      'storefront/app/loading.tsx',
    ]);
  });
});

describe('check-storefront-indexability — when it may not report at all', () => {
  it('refuses a run with no page file — a moved `storefront/app` (issue #215)', () => {
    const result = checkStorefrontIndexability({
      appRoot: APP_ROOT,
      routes: [],
      handlerPaths: [],
      sitemapText: sitemapText(['/catalog']),
      reservedSegmentsText: reservedText(['catalog']),
      segments: { boundaries: [], unreadable: [] },
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
        handlerPaths: [],
        sitemapText: text,
        reservedSegmentsText: reservedText(['catalog']),
        segments: { boundaries: [], unreadable: [] },
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

  it('refuses a segment directory it could not enumerate', () => {
    // Exit 2 rather than 1, and it is the direction that matters: a directory
    // the walk was refused may hold the `loading.tsx` that defeats every page
    // under it, and reporting those pages clean is the one verdict this run may
    // not give about a directory it could not read.
    const result = checkStorefrontIndexability({
      appRoot: APP_ROOT,
      routes: [CLEAN_CATALOG, page('/wholesale/page.tsx', DECIDING_BODY)],
      handlerPaths: [],
      sitemapText: sitemapText(['/catalog']),
      reservedSegmentsText: reservedText(['catalog', 'wholesale']),
      segments: { boundaries: [], unreadable: [`${APP_ROOT}/(catalog)`] },
    });
    expect(vacuousReason(result)?.kind).toBe('unenumerable-segment');
    expect(vacuousReason(result)?.message).toContain('(catalog)');
  });

  it('refuses a run in which no page was read as deciding a status', () => {
    // The boundary predicate is a conjunction, so a call reader that stopped
    // resolving prints `findings=0` honestly — over a storefront in which no
    // dynamic route can 404.
    const result = run([CLEAN_CATALOG]);
    expect(vacuousReason(result)?.kind).toBe('nothing-decided');
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

describe('check-storefront-indexability — what this storefront reserves (feature 105)', () => {
  /**
   * FR-034 / `contracts/cms-page-url.md` §5.3.1.
   *
   * A CMS page is served at the site root, so every top-level path this
   * storefront owns is a path a page can be silently lost to. The deployment
   * copies its `cms.reserved_slug_segments` value from
   * `RESERVED_TOP_LEVEL_SEGMENTS`, so what these cases defend is that the
   * published list and the route tree cannot come apart.
   *
   * The two directions are separate findings on purpose. They fail differently:
   * an unreserved segment is fail-**open** — the original defect returning —
   * and a stale entry is fail-**safe**, refusing a slug that is free.
   */
  it('reports a top-level path the storefront serves and does not publish', () => {
    const result = run(
      [CLEAN_CATALOG, page('/wholesale/page.tsx', NOINDEX_BODY)],
      ['/catalog'],
      [],
      { boundaries: [], unreadable: [] },
      { segments: ['catalog'] },
    );
    expect(findingsOf(result, 'unreserved-top-level-segment')).toEqual(['/wholesale']);
    expect(findingsOf(result, 'stale-reserved-segment')).toEqual([]);
  });

  it('reports a published segment no route file serves', () => {
    const result = run([CLEAN_CATALOG], ['/catalog'], [], { boundaries: [], unreadable: [] }, {
      segments: ['catalog', 'wholesale'],
    });
    expect(findingsOf(result, 'stale-reserved-segment')).toEqual(['/wholesale']);
    expect(findingsOf(result, 'unreserved-top-level-segment')).toEqual([]);
  });

  it('counts a `route.ts` handler, which owns a segment and emits no document', () => {
    // `/api`, `/pwa` and `/manifest.webmanifest` are route handlers in this
    // tree. A page slugged into one of them is shadowed exactly as it would be
    // by a page, and a reconciliation blind to handlers would call all three
    // stale entries — or, with them absent from the list, say nothing at all.
    const result = run([CLEAN_CATALOG], ['/catalog'], [], { boundaries: [], unreadable: [] }, {
      segments: ['catalog'],
      handlerPaths: [`${APP_ROOT}/api/revalidate/route.ts`],
    });
    expect(findingsOf(result, 'unreserved-top-level-segment')).toEqual(['/api']);
  });

  it('does not ask a dynamic first segment to be reserved', () => {
    // `/[...slug]` is the CMS catch-all itself: reserving it would be the
    // storefront reserving the thing a page slug *is*. Nor does the root page,
    // which owns no segment.
    const result = run(
      [CLEAN_CATALOG, page('/(content)/[...slug]/page.tsx', NOINDEX_BODY), page('/page.tsx', NOINDEX_BODY)],
      ['/catalog'],
      [],
      { boundaries: [], unreadable: [] },
      { segments: ['catalog'] },
    );
    expect(findingsOf(result, 'unreserved-top-level-segment')).toEqual([]);
    expect(findingsOf(result, 'stale-reserved-segment')).toEqual([]);
  });

  it('reads route groups and nesting the way every other question here does', () => {
    // Through `routePatternOf`, so a route group contributes no segment, a
    // nested page contributes only its first, the root page contributes none,
    // and a handler contributes its own. Deduplicated and sorted, because the
    // comparison on both sides is a set.
    expect(
      topLevelSegmentsOf(
        [
          `${APP_ROOT}/(account)/account/orders/page.tsx`,
          `${APP_ROOT}/(account)/account/page.tsx`,
          `${APP_ROOT}/(catalog)/p/[slug]/page.tsx`,
          `${APP_ROOT}/page.tsx`,
          `${APP_ROOT}/pwa/config/route.ts`,
        ],
        APP_ROOT,
      ),
    ).toEqual(['account', 'p', 'pwa']);
  });

  it('refuses a run whose reserved declaration it could not read', () => {
    for (const text of [null, 'export const RESERVED_TOP_LEVEL_SEGMENTS = SEGMENTS;']) {
      const result = checkStorefrontIndexability({
        appRoot: APP_ROOT,
        routes: [CLEAN_CATALOG, page('/wholesale/page.tsx', DECIDING_BODY)],
        handlerPaths: [],
        sitemapText: sitemapText(['/catalog']),
        reservedSegmentsText: text,
        segments: { boundaries: [], unreadable: [] },
      });
      expect(vacuousReason(result)?.kind).toBe('unreadable-reserved-segments');
    }
  });

  it('refuses a run that produced no top-level segment at all', () => {
    // Both directions are set comparisons, so an empty side reports the other
    // side's whole contents and nothing about the tree.
    const result = checkStorefrontIndexability({
      appRoot: APP_ROOT,
      // A root page and nothing else: classified, deciding a status, so the
      // three refusals above are all satisfied and this one is what is left.
      routes: [page('/page.tsx', DECIDING_BODY)],
      handlerPaths: [],
      sitemapText: sitemapText(['/']),
      reservedSegmentsText: reservedText(['cart', 'catalog']),
      segments: { boundaries: [], unreadable: [] },
    });
    expect(vacuousReason(result)?.kind).toBe('no-top-level-segment');
  });

  it('reads the declared array and refuses an element it cannot resolve', () => {
    expect(readReservedSegments(reservedText(['cart', 'catalog']))).toEqual(['cart', 'catalog']);
    expect(
      readReservedSegments(
        `export const RESERVED_TOP_LEVEL_SEGMENTS: readonly string[] = ['cart', CHECKOUT];`,
      ),
    ).toBeNull();
    expect(readReservedSegments('export const SOMETHING_ELSE = [];')).toBeNull();
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
