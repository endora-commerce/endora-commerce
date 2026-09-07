import ts from 'typescript';

/**
 * The representative page set the conformance job measures, derived
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-033;
 * `contracts/accessibility-floor.md` §4.3).
 *
 * ## One author, and it is Phase 2's
 *
 * The set is **one page per indexable route type**, and which route types those
 * are is not decided here. Every indexable route ships a `seo.ts` beside its
 * `page.tsx` — that is what `check:storefront-indexability` refuses a route for
 * not having (`undeclared-structured-data`), and what it reconciles against
 * `app/sitemap.ts` in both directions. So this job **reads that declaration**
 * and derives nothing of its own: it does not re-read a `page.tsx`'s metadata,
 * it does not consult the sitemap, and it holds no list of routes. A second
 * derivation of the classification would be a second author for a fact Phase 2
 * already has two authors for, which is two answers waiting to disagree.
 *
 * `storefront/test/visual/_helpers.ts`'s `PAGES` is the shape being replaced
 * (FR-033) — hand-written, missing `/kontakt` and both catch-alls, and carrying
 * two `noindex` surfaces. Nothing here reads it.
 *
 * ## The second author is the framework's own route manifest
 *
 * `.next/app-path-routes-manifest.json` is what `next build` wrote: the map
 * from every built app path to the route pattern it serves. The job has a built
 * storefront, so it can afford an author a static check could not. Two
 * directions, both refusals rather than findings, because either one means the
 * population is not what either author says:
 *
 *   * a declared route the manifest does not carry — the route type was
 *     removed, renamed or never built;
 *   * a declaration whose **own file** the manifest maps to a different
 *     pattern — a copy-pasted `seo.route`, which names a route that does exist
 *     and is not this one, so direction one cannot see it.
 *
 * ## Dynamic segments come from the seed, and a route with no subject refuses
 *
 * Four of the eight route types take a slug. The seeded platform supplies one
 * subject per kind (`scripts/conformance/seed-storefront-fixtures.ts` writes
 * the manifest this reads), and a dynamic route type with no subject is exit 2
 * — `contracts/accessibility-floor.md` §4.5's fifth refusal — because it would
 * otherwise be silently skipped and the run would report a clean sweep over
 * seven pages while calling itself eight.
 *
 * ## The page set has a second half, and it is the same declaration read twice
 *
 * `specs/108-storefront-response-status/contracts/response-status.md` §4 adds
 * one **deliberately absent** URL per dynamic route type, asserted at `404` and
 * at nothing else. It is derived here rather than written down for the reason
 * the present half is: a hand-written list of absent URLs would be a second
 * author for the same population, and the two would disagree the first time a
 * route type was added. So the route pattern comes from the same `seo.ts`, and
 * the only difference is which token fills its dynamic segments —
 * {@link ABSENT_SEGMENT} instead of the seed's slug.
 */

/**
 * The kinds of content a seeded platform supplies for a dynamic route type.
 *
 * There is **one** kind of CMS page and it is `contentPage`. There were two
 * until `specs/105-cms-root-page-urls/` — `cmsPage` for `/cms/[...slug]` and
 * `contentPage` for `/[...slug]`, two kinds naming one table — and that is the
 * finding this suite recorded rather than the one it was pointed at
 * (`research.md` D-8): a per-route reconciliation cannot see a pair of route
 * types over one subject, because each half of the pair is individually
 * consistent. The pair is gone, and so is the second kind.
 */
export type SubjectKind = 'product' | 'category' | 'blogPost' | 'contentPage';

/**
 * Which kind of content fills a route type's dynamic segments.
 *
 * This is judgement, like `contracts/seo-declarations.md` §3's JSON-LD table,
 * and it is the storefront's rather than the seed's: *"a product page takes a
 * product slug"* is a fact about this route tree, while *"here is a product"*
 * is a fact about the seeded platform. So the two halves are declared in the
 * two places that own them, and neither holds a copy of the other.
 *
 * A **static** route type appears nowhere in this table and needs no entry: it
 * has no segment to fill.
 */
export const SUBJECT_KIND_BY_ROUTE: Readonly<Record<string, SubjectKind>> = {
  '/p/[slug]': 'product',
  '/c/[slug]': 'category',
  '/blog/[[...slug]]': 'blogPost',
  '/[...slug]': 'contentPage',
};

/**
 * Route types this job cannot measure, each with the reason and what retires
 * it. Two-way: an entry over a route the tree no longer declares, or one whose
 * subject the seed now supplies, is a refusal rather than a silent pass.
 *
 * It exists because "this route type has no subject" and "this route type
 * cannot have one" are different states, and only the first is a seed's
 * failure. An entry is never a way to quieten a route that is merely
 * inconvenient to seed — it is for a route type nothing in the platform can
 * serve, which is a defect the entry **records** rather than hides.
 */
export const ROUTE_TYPES_WITHOUT_A_SUBJECT: Readonly<
  Record<string, { readonly reason: string; readonly retiredBy: string }>
> = {
  // Empty, and it opened with one entry. `/[...slug]` fetched
  // `GET /api/v1/cms/pages/{path}`, an endpoint no commit in this repository
  // has ever registered, so every URL under it resolved to `notFound()`: there
  // was no subject to seed and no 200 to assert. `specs/105-cms-root-page-urls/`
  // is that entry's `retiredBy` taken — the route now resolves through
  // `GET /api/v1/cms/pages/by-slug`, which is what `/cms/[...slug]` used before
  // it was retired, and the seed supplies its `contentPage` subject.
};

/** One route's own `seo.ts`, as source text. */
export interface RouteDeclaration {
  /** Repo-relative path of the `seo.ts`. */
  readonly source: string;
  readonly text: string;
}

/** What one declaration says, or `null` when it cannot be read in full. */
export interface RouteSeoDeclaration {
  readonly route: string;
  readonly jsonLd: readonly string[];
}

/**
 * Read `export const seo: RouteSeo = { route, jsonLd }` out of a declaration.
 *
 * **Source text rather than an import**, and that is not a preference: this
 * runner is a Playwright spec, Playwright transforms a spec to CommonJS, and a
 * dynamic `import()` of a `.ts` file bypasses that transform entirely — the
 * measured answer is `SyntaxError: Unexpected token 'export'` at the first
 * declaration, and the alternative is a static import list, which is the
 * hand-written page set FR-033 exists to remove. It is the reading
 * `backend/scripts/check-storefront-indexability.ts` already does, for its own
 * reason (a check that runs with no services), so the two instruments read the
 * declaration the same way.
 *
 * A declaration this cannot read in full is `null` — a **finding, never a
 * skip** (issue #113). Read as "no route" it would silently shrink the page
 * set, which is the one failure this job may not have.
 */
export function readSeoDeclaration(text: string): RouteSeoDeclaration | null {
  const source = ts.createSourceFile('seo.ts', text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'seo') continue;
      const value = declaration.initializer;
      if (value === undefined || !ts.isObjectLiteralExpression(value)) return null;
      let route: string | null = null;
      let jsonLd: string[] | null = null;
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
          ? property.name.text
          : null;
        if (name === 'route' && ts.isStringLiteral(property.initializer)) {
          route = property.initializer.text;
        }
        if (name === 'jsonLd' && ts.isArrayLiteralExpression(property.initializer)) {
          const types: string[] = [];
          let readable = true;
          for (const element of property.initializer.elements) {
            if (!ts.isStringLiteral(element)) readable = false;
            else types.push(element.text);
          }
          jsonLd = readable ? types : null;
        }
      }
      if (route === null || jsonLd === null) return null;
      return { route, jsonLd };
    }
  }
  return null;
}

/** One piece of seeded content, and what the page serving it should say. */
export interface FixtureSubject {
  readonly kind: SubjectKind;
  /** The URL segments that fill the route's dynamic part. */
  readonly segments: readonly string[];
  /** The heading the page is expected to carry (FR-032). */
  readonly name: string;
  /** What the platform quotes for it, where it quotes anything. */
  readonly price?: { readonly amount: number; readonly currency: string } | null;
}

/** What the seeded platform supplied, written by the fixture seed. */
export interface FixtureManifest {
  readonly channel: { readonly code: string; readonly currency: string; readonly language: string };
  readonly subjects: Partial<Record<SubjectKind, FixtureSubject>>;
}

export interface ConformancePlanInput {
  /** Repo-relative root the declarations were walked under. */
  readonly appRoot: string;
  readonly declarations: readonly RouteDeclaration[];
  /** `.next/app-path-routes-manifest.json`, or `null` when it is absent. */
  readonly manifest: Readonly<Record<string, string>> | null;
  /** The seeded subjects, or `null` when the fixture manifest is absent. */
  readonly fixtures: FixtureManifest | null;
}

export interface PlannedPage {
  /** The route pattern, as the declaration spells it. */
  readonly route: string;
  /** The URL to fetch — the pattern with its segments filled. */
  readonly url: string;
  /** The schema.org types the route declares its server HTML emits. */
  readonly jsonLd: readonly string[];
  /** The seeded content this page is about, for a dynamic route type. */
  readonly subject: FixtureSubject | null;
  /** Repo-relative path of the declaration, so a finding names a file. */
  readonly declaredIn: string;
}

/**
 * The segment token an absent probe fills a dynamic route with
 * (`specs/108-storefront-response-status/contracts/response-status.md` §4.2).
 *
 * Long, prefixed and carrying a random-looking tail on purpose: it is a slug
 * that must never resolve to a row, and the one way this probe can lie is by
 * naming something a seed happens to have created. It is a **token**, not a
 * second page list — the URL around it comes from the same `seo.ts` the present
 * probe's does, filled by the same {@link fillRoute}.
 */
export const ABSENT_SEGMENT = 'endora-conformance-absent-6f2a91c4';

/**
 * A URL whose subject deliberately does not exist, and the route type it was
 * derived from.
 *
 * There is no `subject`, no `jsonLd` and no canonical here, and that absence is
 * the design: the only thing asserted of an absent URL is its **status line**
 * (§4.1). A not-found document owes no structured data and no domain content,
 * so asking it for either would assert the not-found page's own contents under
 * the name of the route that did not serve it.
 */
export interface AbsentProbe {
  /** The route pattern the probe was derived from. */
  readonly route: string;
  /** The URL to fetch — the pattern with its dynamic segments filled by the token. */
  readonly url: string;
  /** Repo-relative path of the declaration, so a finding names a file. */
  readonly declaredIn: string;
}

export interface ExcludedRoute {
  readonly route: string;
  readonly reason: string;
}

export interface PlanDisagreement {
  readonly route: string;
  readonly detail: string;
}

export interface ConformancePlan {
  readonly pages: readonly PlannedPage[];
  /**
   * One deliberately absent URL per dynamic route type that has a subject
   * (§4.1–§4.3). A **static** route type has no dynamic segment to falsify and
   * contributes none.
   */
  readonly absent: readonly AbsentProbe[];
  /**
   * Route types with a seeded subject whose absent URL came out identical to
   * the present one, so nothing about them was falsified — §4.4's second half.
   */
  readonly withoutAnAbsentProbe: readonly string[];
  /** Declarations whose `seo` value this analysis could not read in full. */
  readonly unreadable: readonly string[];
  readonly excluded: readonly ExcludedRoute[];
  /** Declared routes the manifest does not carry, or carries elsewhere. */
  readonly disagreements: readonly PlanDisagreement[];
  /** Dynamic route types with neither a subject nor a ledger entry. */
  readonly withoutSubject: readonly string[];
  /** Ledger entries over route types this tree no longer declares. */
  readonly staleLedgerEntries: readonly string[];
  /** How many declarations there were at all — the `no-declaration` refusal. */
  readonly declarationCount: number;
  readonly manifestPresent: boolean;
  /** `sources=next-manifest:<covered>/<expected>`. */
  readonly coverage: { readonly covered: number; readonly expected: number };
}

/**
 * The URL a route pattern serves for one subject.
 *
 * Every segment shape Next's file tree produces is handled: `[slug]` takes the
 * first value, `[...slug]` and `[[...slug]]` take the rest. A pattern with no
 * dynamic segment ignores the values, and the root stays `/`.
 */
export function fillRoute(route: string, segments: readonly string[]): string {
  const remaining = [...segments];
  const out: string[] = [];
  for (const segment of route.split('/')) {
    if (segment.length === 0) continue;
    if (/^\[{1,2}\.\.\.[^\]]+\]{1,2}$/u.test(segment)) {
      out.push(...remaining.splice(0, remaining.length));
      continue;
    }
    if (/^\[[^\]]+\]$/u.test(segment)) {
      const value = remaining.shift();
      if (value !== undefined) out.push(value);
      continue;
    }
    out.push(segment);
  }
  return `/${out.join('/')}`;
}

/**
 * The manifest key a declaration's own file corresponds to: the app path Next
 * built it under, which is the directory holding the `seo.ts` plus `/page`.
 */
function manifestKeyOf(source: string, appRoot: string): string {
  const withinApp = source.startsWith(`${appRoot}/`) ? source.slice(appRoot.length) : source;
  return `${withinApp.replace(/\/seo\.ts$/u, '')}/page`;
}

/**
 * The plan, over the declarations, the framework's manifest and the seed's
 * subjects — the three inputs a real run reads, and the top of the analysis.
 *
 * `ledger` defaults to {@link ROUTE_TYPES_WITHOUT_A_SUBJECT} and is a parameter
 * for one reason: that ledger is **empty**, and three of this analysis's
 * refusals are about what an entry does. A red proof written against the real
 * constant stops proving anything the moment the constant empties — which is
 * the state a two-way ledger is supposed to reach — so the proofs supply their
 * own entries and enter where a real run enters.
 *
 * `subjectKinds` is a parameter for the mirror of that reason. Every entry of
 * {@link SUBJECT_KIND_BY_ROUTE} names a route with a dynamic segment today, so
 * `route-without-an-absent-probe` — the refusal for a route type classified as
 * dynamic that produced no absent URL — has no subject in this tree at all. It
 * is reachable exactly when somebody classifies a **static** route as dynamic,
 * or leaves an entry standing while its pattern loses its segment, and both are
 * states the constant is in rather than states the analysis can be handed.
 */
export function buildConformancePlan(
  input: ConformancePlanInput,
  ledger: Readonly<
    Record<string, { readonly reason: string; readonly retiredBy: string }>
  > = ROUTE_TYPES_WITHOUT_A_SUBJECT,
  subjectKinds: Readonly<Record<string, SubjectKind>> = SUBJECT_KIND_BY_ROUTE,
): ConformancePlan {
  const pages: PlannedPage[] = [];
  const absent: AbsentProbe[] = [];
  const withoutAnAbsentProbe: string[] = [];
  const excluded: ExcludedRoute[] = [];
  const disagreements: PlanDisagreement[] = [];
  const withoutSubject: string[] = [];
  const unreadable: string[] = [];
  const builtRoutes = input.manifest === null ? null : new Set(Object.values(input.manifest));
  let covered = 0;

  for (const raw of input.declarations) {
    const read = readSeoDeclaration(raw.text);
    if (read === null) {
      unreadable.push(raw.source);
      continue;
    }
    const declaration = { source: raw.source, route: read.route, jsonLd: read.jsonLd };
    if (builtRoutes !== null) {
      const forThisFile = input.manifest?.[manifestKeyOf(declaration.source, input.appRoot)];
      if (forThisFile !== undefined && forThisFile !== declaration.route) {
        disagreements.push({
          route: declaration.route,
          detail:
            `${declaration.source} declares \`route: '${declaration.route}'\` and \`next build\` ` +
            `serves that file at \`${forThisFile}\`. The declaration names a route that exists ` +
            'and is not this one, so every assertion below it would be made against the wrong ' +
            'page',
        });
        continue;
      }
      if (!builtRoutes.has(declaration.route)) {
        disagreements.push({
          route: declaration.route,
          detail:
            `${declaration.source} declares \`route: '${declaration.route}'\` and the built ` +
            'route manifest carries no such route. Either the route type was removed and its ' +
            'declaration left behind, or the build did not produce it',
        });
        continue;
      }
      covered += 1;
    }

    const ledgered = ledger[declaration.route];
    const kind = subjectKinds[declaration.route];
    const subject = kind === undefined ? null : (input.fixtures?.subjects[kind] ?? null);

    if (ledgered !== undefined) {
      excluded.push({ route: declaration.route, reason: ledgered.reason });
      continue;
    }
    if (kind !== undefined && subject === null) {
      withoutSubject.push(declaration.route);
      continue;
    }

    const url = fillRoute(declaration.route, subject?.segments ?? []);
    pages.push({
      route: declaration.route,
      url,
      jsonLd: declaration.jsonLd,
      subject,
      declaredIn: declaration.source,
    });

    // §4.3 — the absent half's population is the **dynamic** route types, and
    // it is the same population `SUBJECT_KIND_BY_ROUTE` already names. A static
    // route type has no segment to falsify: its subject is the route itself, so
    // "the same URL with a slug that does not exist" is not a thing that
    // exists for it.
    if (kind === undefined) continue;
    const absentUrl = fillRoute(declaration.route, [ABSENT_SEGMENT]);
    // A pattern that swallowed the token produced the present URL again, and a
    // probe of it would assert 404 of a page that correctly answers 200. That
    // is not a probe to skip — it is §4.4's second refusal, because the route
    // type is classified as dynamic and nothing about it was falsified.
    if (absentUrl === url) {
      withoutAnAbsentProbe.push(declaration.route);
      continue;
    }
    absent.push({
      route: declaration.route,
      url: absentUrl,
      declaredIn: declaration.source,
    });
  }

  const declaredRoutes = new Set(
    input.declarations
      .map((one) => readSeoDeclaration(one.text)?.route)
      .filter((route): route is string => route !== undefined),
  );
  const staleLedgerEntries = Object.keys(ledger).filter(
    (route) => !declaredRoutes.has(route),
  );

  return {
    pages,
    absent,
    withoutAnAbsentProbe,
    unreadable,
    excluded,
    disagreements,
    withoutSubject,
    staleLedgerEntries,
    declarationCount: input.declarations.length,
    manifestPresent: input.manifest !== null && Object.keys(input.manifest).length > 0,
    coverage: { covered, expected: input.declarations.length },
  };
}

export type PlanRefusalKind =
  | 'no-declaration'
  | 'unreadable-declaration'
  | 'no-manifest'
  | 'manifest-disagreement'
  | 'no-subject'
  | 'stale-subjectless-entry'
  | 'no-page-planned'
  | 'route-without-an-absent-probe';

export interface PlanRefusal {
  readonly kind: PlanRefusalKind;
  readonly message: string;
}

/**
 * Why this run may not report on the pages it planned, or `null`.
 *
 * Ordered so that the widest cause is named first: a tree whose declarations
 * are gone is answered as such rather than as nine routes the manifest does not
 * carry.
 */
export function planRefusal(plan: ConformancePlan): PlanRefusal | null {
  if (plan.declarationCount === 0) {
    return {
      kind: 'no-declaration',
      message:
        'the walk found no route declaration at all — no `seo.ts` beside any `page.tsx`. The ' +
        'representative page set is derived from those declarations, so this run has no ' +
        'population and every assertion below it is vacuously satisfied',
    };
  }
  if (plan.unreadable.length > 0) {
    return {
      kind: 'unreadable-declaration',
      message:
        `${plan.unreadable.join(', ')} declares an \`seo\` value this analysis cannot read in ` +
        'full. Read as "no route" it would quietly shrink the page set, and a page type nobody ' +
        'measured is exactly what a green over eight of nine pages looks like',
    };
  }
  if (!plan.manifestPresent) {
    return {
      kind: 'no-manifest',
      message:
        '`.next/app-path-routes-manifest.json` is absent or empty. It is the framework\'s own ' +
        'enumeration of what it built and the second author of this page set; without it the ' +
        'set has one author and agrees with itself',
    };
  }
  if (plan.disagreements.length > 0) {
    return {
      kind: 'manifest-disagreement',
      message:
        'the route classification and the built route manifest disagree, so the population is ' +
        `not what either author says:\n${plan.disagreements
          .map((one) => `  - ${one.route}: ${one.detail}`)
          .join('\n')}`,
    };
  }
  if (plan.withoutSubject.length > 0) {
    return {
      kind: 'no-subject',
      message:
        'the seeded platform produced no subject for ' +
        `${plan.withoutSubject.join(', ')}. A dynamic route type with no content to fetch is ` +
        'a page type that would be silently skipped, and a sweep that skips a route type ' +
        'reports a clean run over fewer pages than it claims',
    };
  }
  if (plan.staleLedgerEntries.length > 0) {
    return {
      kind: 'stale-subjectless-entry',
      message:
        '`ROUTE_TYPES_WITHOUT_A_SUBJECT` holds an entry for ' +
        `${plan.staleLedgerEntries.join(', ')}, which this tree declares nowhere. An entry ` +
        'describing no route excuses nothing and hides the next route that needs excusing',
    };
  }
  if (plan.withoutAnAbsentProbe.length > 0) {
    return {
      kind: 'route-without-an-absent-probe',
      message:
        `${plan.withoutAnAbsentProbe.join(', ')} is classified as a dynamic route type with a ` +
        'seeded subject and produced no absent URL — the pattern swallowed the token, so the ' +
        'probe would have re-fetched the present page and asserted 404 of a page that correctly ' +
        'answers 200. A route type whose absence nothing falsified is a route type this run ' +
        'says nothing about',
    };
  }
  if (plan.pages.length === 0) {
    return {
      kind: 'no-page-planned',
      message:
        'declarations were read and every one of them dropped out of the page set. There is ' +
        'nothing to fetch, and a run that fetched nothing has measured nothing',
    };
  }
  return null;
}
