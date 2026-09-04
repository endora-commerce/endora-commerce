import { describe, expect, it } from 'vitest';

import {
  buildConformancePlan,
  fillRoute,
  planRefusal,
  ROUTE_TYPES_WITHOUT_A_SUBJECT,
  SUBJECT_KIND_BY_ROUTE,
  type ConformancePlanInput,
  type FixtureManifest,
  type FixtureSubject,
  type RouteDeclaration,
  type SubjectKind,
} from './plan';

/**
 * The representative page set, and the five states in which this job refuses to
 * report on it (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-033;
 * `contracts/accessibility-floor.md` §4.3 and §4.5).
 *
 * Every fixture below is the **input a real run reads** — the `seo` values the
 * route declarations export, the framework's own route manifest, and the
 * seeded subjects — never a pre-computed page set (issue #130). The whole
 * subject of this file is the derivation, so a fixture entering below it would
 * prove the reporter and leave the derivation unproven.
 */

const DECLARATION_SOURCE = 'storefront/app/(catalog)/p/[slug]/seo.ts';

function declaration(
  route: string,
  jsonLd: readonly string[] = [],
  source = `storefront/app${route === '/' ? '' : route}/seo.ts`,
): RouteDeclaration {
  return { source, route, jsonLd };
}

/** Every subject a seeded platform supplies, minus the ones a case withholds. */
function fixtures(without: readonly SubjectKind[] = []): FixtureManifest {
  const all = {
    product: { kind: 'product', segments: ['pump-01'], name: 'Pump 01' },
    category: { kind: 'category', segments: ['pumps'], name: 'Pumps' },
    blogPost: { kind: 'blogPost', segments: ['hello'], name: 'Hello' },
    cmsPage: { kind: 'cmsPage', segments: ['about'], name: 'About' },
    contentPage: { kind: 'contentPage', segments: ['terms'], name: 'Terms' },
  } as const satisfies Record<SubjectKind, { kind: SubjectKind; segments: string[]; name: string }>;
  const subjects: FixtureManifest['subjects'] = {};
  for (const [kind, subject] of Object.entries(all) as [SubjectKind, FixtureSubject][]) {
    if (without.includes(kind)) continue;
    subjects[kind] = subject;
  }
  return { channel: { code: 'pl_default', currency: 'PLN', language: 'en-US' }, subjects };
}

/** A manifest that carries every declared route, as `next build` writes it. */
function manifestFor(declarations: readonly RouteDeclaration[]): Record<string, string> {
  const entries: Record<string, string> = {};
  for (const one of declarations) {
    entries[`${one.source.replace(/^storefront\/app/u, '').replace(/\/seo\.ts$/u, '')}/page`] =
      one.route;
  }
  return entries;
}

function input(overrides: Partial<ConformancePlanInput> = {}): ConformancePlanInput {
  const declarations = overrides.declarations ?? [
    declaration('/', ['Organization'], 'storefront/app/seo.ts'),
    declaration('/catalog', ['BreadcrumbList'], 'storefront/app/(catalog)/catalog/seo.ts'),
    declaration('/p/[slug]', ['Product', 'Offer'], DECLARATION_SOURCE),
  ];
  return {
    appRoot: 'storefront/app',
    declarations,
    manifest: manifestFor(declarations),
    fixtures: fixtures(),
    ...overrides,
  };
}

describe('fillRoute', () => {
  it('substitutes every dynamic segment shape the file tree produces', () => {
    expect(fillRoute('/catalog', [])).toBe('/catalog');
    expect(fillRoute('/c/[slug]', ['pumps'])).toBe('/c/pumps');
    expect(fillRoute('/cms/[...slug]', ['about', 'us'])).toBe('/cms/about/us');
    expect(fillRoute('/blog/[[...slug]]', ['hello'])).toBe('/blog/hello');
    expect(fillRoute('/', [])).toBe('/');
  });
});

describe('the representative page set', () => {
  it('is one page per declared route, with the seeded subject filling its segments', () => {
    const plan = buildConformancePlan(input());

    expect(plan.pages.map((page) => page.url)).toEqual(['/', '/catalog', '/p/pump-01']);
    expect(plan.pages.map((page) => page.route)).toEqual(['/', '/catalog', '/p/[slug]']);
    expect(plan.pages[2]?.subject?.name).toBe('Pump 01');
    expect(plan.pages[0]?.jsonLd).toEqual(['Organization']);
  });

  it('carries the declaration each page came from, so a finding names a file', () => {
    const plan = buildConformancePlan(input());
    expect(plan.pages[2]?.declaredIn).toBe(DECLARATION_SOURCE);
  });

  it('counts manifest coverage as the `sources=next-manifest:<n>/<n>` token', () => {
    const plan = buildConformancePlan(input());
    expect(plan.coverage).toEqual({ covered: 3, expected: 3 });
  });
});

describe('the refusals', () => {
  it('refuses a run with no route declaration at all — the classification is gone', () => {
    const refusal = planRefusal(
      buildConformancePlan(input({ declarations: [], manifest: {}, fixtures: fixtures() })),
    );
    expect(refusal?.kind).toBe('no-declaration');
  });

  it('refuses a run with no route manifest — the storefront was never built', () => {
    const refusal = planRefusal(buildConformancePlan(input({ manifest: null })));
    expect(refusal?.kind).toBe('no-manifest');
  });

  it('refuses a declared route the framework did not build', () => {
    const declarations = [declaration('/kontakt', ['BreadcrumbList'])];
    const refusal = planRefusal(
      buildConformancePlan(input({ declarations, manifest: { '/page': '/' } })),
    );
    expect(refusal?.kind).toBe('manifest-disagreement');
    expect(refusal?.message).toContain('/kontakt');
  });

  it('refuses a declaration whose `route` is not the pattern its own file serves', () => {
    // The strong direction: the manifest answers for *this file*, so a
    // copy-pasted `seo.route` is caught even though the pattern it names is a
    // route that genuinely exists.
    const declarations = [declaration('/catalog', [], 'storefront/app/(catalog)/c/[slug]/seo.ts')];
    const refusal = planRefusal(
      buildConformancePlan(
        input({
          declarations,
          manifest: { '/(catalog)/c/[slug]/page': '/c/[slug]', '/(catalog)/catalog/page': '/catalog' },
        }),
      ),
    );
    expect(refusal?.kind).toBe('manifest-disagreement');
    expect(refusal?.message).toContain('/c/[slug]');
  });

  it('refuses a dynamic route type the seed produced no subject for', () => {
    const declarations = [declaration('/c/[slug]', [], 'storefront/app/(catalog)/c/[slug]/seo.ts')];
    const refusal = planRefusal(
      buildConformancePlan(
        input({
          declarations,
          manifest: manifestFor(declarations),
          fixtures: fixtures(['category']),
        }),
      ),
    );
    expect(refusal?.kind).toBe('no-subject');
    expect(refusal?.message).toContain('/c/[slug]');
  });

  it('refuses a run whose plan produced no page', () => {
    // Distinct from `no-declaration`: declarations were read and every one of
    // them dropped out, which is the state a green would report as nine clean
    // pages over nothing.
    const plan = buildConformancePlan(
      input({ declarations: [declaration('/[...slug]', [], 'storefront/app/(content)/[...slug]/seo.ts')] , manifest: { '/(content)/[...slug]/page': '/[...slug]' } }),
    );
    expect(plan.pages).toHaveLength(0);
    expect(planRefusal(plan)?.kind).toBe('no-page-planned');
  });

  it('refuses a ledger entry over a route type that is no longer declared', () => {
    const declarations = [declaration('/catalog', [], 'storefront/app/(catalog)/catalog/seo.ts')];
    const plan = buildConformancePlan(
      input({ declarations, manifest: manifestFor(declarations) }),
    );
    // `/[...slug]` is ledgered and this tree declares it nowhere.
    expect(planRefusal(plan)?.kind).toBe('stale-subjectless-entry');
  });
});

describe('the subjectless-route ledger', () => {
  it('excludes a ledgered route type from the page set rather than failing it', () => {
    const declarations = [
      declaration('/catalog', [], 'storefront/app/(catalog)/catalog/seo.ts'),
      declaration('/[...slug]', [], 'storefront/app/(content)/[...slug]/seo.ts'),
    ];
    const plan = buildConformancePlan(
      input({
        declarations,
        manifest: manifestFor(declarations),
        fixtures: fixtures(['contentPage']),
      }),
    );
    expect(plan.pages.map((page) => page.route)).toEqual(['/catalog']);
    expect(plan.excluded.map((one) => one.route)).toEqual(['/[...slug]']);
    expect(planRefusal(plan)).toBeNull();
  });

  it('every entry names a route the subject table knows and carries a retiring condition', () => {
    for (const [route, entry] of Object.entries(ROUTE_TYPES_WITHOUT_A_SUBJECT)) {
      expect(SUBJECT_KIND_BY_ROUTE[route]).toBeDefined();
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.retiredBy.length).toBeGreaterThan(20);
    }
  });
});
