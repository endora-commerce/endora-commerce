/**
 * CI check — **every storefront route says whether a crawler may index it, and
 * the sitemap and the route table agree in both directions**
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-010…FR-014;
 * `contracts/seo-declarations.md` §2–§5).
 *
 * ## Why this exists
 *
 * Before Phase 2 the reference storefront told crawlers nothing at all: no
 * `sitemap.ts`, no `robots.ts`, and not one route declaring a canonical URL.
 * Under D-195 the reference storefront is what every client instance is copied
 * from, so whatever is true of it on the day a client scaffolds is copied into
 * that client's tree and diverges there with nothing downstream to catch it. A
 * gate on the template is the only place any of this is enforceable once.
 *
 * ## The population is the pages, and "66 route files" is the wrong number
 *
 * `storefront/app` holds 66 files matching `page.tsx`/`route.ts`/`layout.tsx`.
 * Five are API handlers that emit no document and five are layouts that are not
 * pages. The population is the **56 `page.tsx` files**, and of those 48 are
 * account, auth, checkout, comparison and newsletter surfaces that must **not**
 * be indexed. Emitting a canonical on `/account/password` would be a defect,
 * not a repair — which is why the check asks every page for a *classification*
 * and asks only the indexable ones for SEO.
 *
 * ## Indexability is declared, never inferred
 *
 * A route-group name is a convention and conventions drift; a new top-level
 * page inherits nothing and would default to whichever answer this file's
 * author assumed. So **silence is a finding**. Every `page.tsx` carries either
 * `robots: { index: false, … }` or `alternates: { canonical: … }`, in
 * `export const metadata` or in a `generateMetadata` return.
 *
 * **`contradictory-indexability` is per metadata *object*, not per file**, and
 * that is load-bearing rather than a nicety: `if (!page) return { title: 'Not
 * found', robots: { index: false } }; return { alternates: { canonical } };` is
 * *correct*, and four of the eight indexable routes in this tree ship exactly
 * it — `/p/[slug]`, `/c/[slug]`, `/[...slug]` and `/blog/[[...slug]]`, measured
 * rather than remembered. A per-file contradiction test would report every one
 * of them.
 *
 * ## The second author is the sitemap, and it is a deliverable in its own right
 *
 * An SEO gate's population *is* the pages the site tells crawlers about; that
 * is a sitemap's whole job. Deriving the population from the route files and
 * then checking the route files against it would be one author twice. So
 * `storefront/app/sitemap.ts` declares, by hand, `SITEMAP_STATIC_ROUTES` (URLs
 * it emits with no database read) and `SITEMAP_DYNAMIC_ROUTES` (the route
 * patterns whose URLs it enumerates from the backend), and the two sets are
 * reconciled against the route files in both directions.
 *
 * The *URLs* of the dynamic half stay outside the reconciliation — a product
 * slug is a row, not a route, and this check runs with no services. The
 * *patterns* do not: three of the eight indexable route types have no static
 * URL at all, and a reconciliation blind to them would report every one of them
 * as unadvertised. That is a correction to `contracts/seo-declarations.md` §4,
 * which speaks only of the static set.
 *
 * ## Findings
 *
 *   * **`undeclared-indexability`** — a route declaring neither, that the
 *     sitemap does not advertise. The centre.
 *   * **`contradictory-indexability`** — one metadata object declaring both. A
 *     canonical on a `noindex` page is a statement about a page nobody may
 *     fetch.
 *   * **`unresolvable-indexability`** — a declaration the analysis cannot read:
 *     a computed `robots`, a spread of an identifier, a `generateMetadata`
 *     returning something that is not an object literal. A **finding, not a
 *     skip** (issue #113) — read as "indexable" it agrees with everything, read
 *     as "non-indexable" it excuses everything.
 *   * **`missing-canonical`** — the sitemap advertises this route and the route
 *     declares no canonical. Two shapes under one kind, and the sentence says
 *     which: a route that declared nothing (the sitemap classified it, so it
 *     owes a canonical rather than a classification), and a route that declared
 *     itself `noindex` (the two authors disagree, and one of them is wrong).
 *   * **`sitemap-orphan-route`** — an indexable route no sitemap entry covers.
 *   * **`orphan-sitemap-entry`** — a sitemap entry no route file serves.
 *   * **`undeclared-structured-data`** — an indexable route with no readable
 *     `seo.ts` beside it. That declaration is what Phase 4 asserts the served
 *     HTML against, so a route without one is a route whose JSON-LD nothing can
 *     check; and it is a *declaration* rather than a table in this file,
 *     because a table here would be the second derivation of one judgement.
 *   * **`status-decision-under-a-boundary`** — a `page.tsx` that decides a
 *     response status while a `loading.tsx` or `template.tsx` sits in its own
 *     segment or in any ancestor segment
 *     (`specs/108-storefront-response-status/`, FR-014; `contracts/response-status.md`
 *     §5). See below.
 *
 * ## The eighth finding, and why it is here rather than in a check of its own
 *
 * A `loading.tsx` puts every page below it inside a Suspense boundary; Next
 * flushes the shell as soon as that fallback is ready, and after the flush there
 * is no status line left to set. Measured: with the boundary standing, a
 * `notFound()` answers **200** — as the page's *first* statement, before any
 * promise resolves, just the same — a `permanentRedirect()` answers 200 with no
 * `Location`, and an uncaught throw answers 200 carrying a skeleton. In this
 * tree that was 68 correct call sites defeated by one file three directories up
 * whose job is to render a progress bar.
 *
 * It is a finding kind on this walk rather than a new `check-*` script because
 * this file already opens every `page.tsx` in `storefront/app` with the compiler
 * API and the boundary files are two more names in a `readdir` it already does.
 * A new script would cost the whole estate ritual — an inventory entry, an
 * `endora check` estate verdict, a read-size band — to judge a population one
 * program is already reading (contract §5.2, `specs/105-cms-root-page-urls/`'s
 * precedent for FR-034).
 *
 * **`'use server'` is the load-bearing half** (§5.4). Of this tree's 292 such
 * calls, 224 are inside server actions, where they compose an *action* response
 * and are measured correct with the boundary standing. A classifier blind to the
 * directive reports 33 correct authentication guards as findings.
 *
 * **No ledger, deliberately** (§5.3): every finding is one file deletion or one
 * `<Suspense>` from compliance in the merge request that produces it, so an
 * entry could only license re-opening the defect.
 *
 * **No ledger, deliberately.** Every finding is one line away from compliance
 * in the merge request that produces it, and the two ledgers
 * `contracts/seo-declarations.md` §6 designed — `ROUTES_WITHOUT_A_CANONICAL`
 * and `INDEXABLE_ROUTES_WITHOUT_STRUCTURED_DATA` — exist there only to let the
 * check and the canonicals land in one merge request without a red intermediate
 * commit. They landed in one merge request, so both would arrive empty, and an
 * empty ledger with no entry to strand is a mechanism that can only ever
 * license the defect back in.
 *
 * ## What it does not cover, stated rather than discovered later
 *
 *   * **Whether the canonical is the *right* URL.** It reads the declaration's
 *     presence; the served HTML is `conformance:storefront`'s subject (Phase 4).
 *   * **Whether a route emits the JSON-LD it declares.** Same answer, same job.
 *   * **`route.ts` and `layout.tsx`.** Neither produces a document.
 *   * **A route whose metadata is assembled by a helper in another file.** It
 *     is `unresolvable-indexability` here — named, not silently cleared.
 *   * **A status decision taken in a `layout.tsx`, or in a helper the page
 *     calls.** The population is the page files, and a decision reached through
 *     an imported function is not read. Both are the boundary rule's, and
 *     `conformance:storefront` is what answers for them by asking a booted
 *     storefront (`specs/108-storefront-response-status/` FR-009).
 *   * **A `<Suspense>` wrapping `{children}` in a layout.** Contract §2.1 names
 *     it as the same boundary; this walk reads `loading.tsx` and `template.tsx`
 *     file names and no layout body. There is none in this tree — the only
 *     `<Suspense>` in it is a *sibling* of `{children}` — and the day there is
 *     one, the conformance probe is what sees it.
 *   * **A navigation call re-exported through another module.** The five names
 *     are bound through this file's own `import … from 'next/navigation'`, so a
 *     page importing its own wrapper is not read as deciding anything.
 *
 * Usage: `tsx scripts/check-storefront-indexability.ts [--list]`
 * Exit 0 = every route is classified and the two authors agree; exit 1 = at
 * least one finding; exit 2 = the run could not see the population it judges —
 * no page file, an unreadable sitemap, nothing classified either way, a segment
 * directory it could not enumerate, no status decision read at all, or a walk
 * short of what the sitemap implies.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { reportReadSize } from './lib/read-size.js';

const PREFIX = '[storefront-indexability]';

/** Repo-relative, and the one place any of these paths is spelled. */
const APP_ROOT = 'storefront/app';
const SITEMAP_FILE = 'storefront/app/sitemap.ts';
const RESERVED_SEGMENTS_FILE = 'storefront/app/reserved-segments.ts';

export type StorefrontIndexabilityFindingKind =
  | 'undeclared-indexability'
  | 'contradictory-indexability'
  | 'unresolvable-indexability'
  | 'missing-canonical'
  | 'sitemap-orphan-route'
  | 'orphan-sitemap-entry'
  | 'undeclared-structured-data'
  | 'status-decision-under-a-boundary'
  | 'unreserved-top-level-segment'
  | 'stale-reserved-segment';

/** One `page.tsx` and the `seo.ts` beside it, as source text. */
export interface RouteFile {
  /** Repo-relative path of the page file. */
  readonly path: string;
  readonly text: string;
  /** The co-located `seo.ts`, or `null` where there is none. */
  readonly seoText: string | null;
}

/**
 * What the walk of the segment directories found
 * (`specs/108-storefront-response-status/contracts/response-status.md` §2.1).
 *
 * Two fields rather than one, because "there is no boundary here" and "this
 * directory could not be read" are different answers and only the first is a
 * clean tree. A directory the walk was refused might hold the `loading.tsx`
 * that defeats a page's `notFound()`, and reporting that page as clean is the
 * one verdict this finding may not give.
 */
export interface SegmentWalk {
  /** Repo-relative paths of every `loading.tsx` / `template.tsx` under `appRoot`. */
  readonly boundaries: readonly string[];
  /** Repo-relative paths of directories under `appRoot` `readdir` refused. */
  readonly unreadable: readonly string[];
}

export interface StorefrontIndexabilityInput {
  /** Repo-relative root the route patterns are derived against. */
  readonly appRoot: string;
  readonly routes: readonly RouteFile[];
  /**
   * Repo-relative paths of the `route.ts` / `route.tsx` handlers under
   * `appRoot`, as **paths and no text**.
   *
   * A handler emits no document, so it is outside every indexability question
   * and this walk deliberately does not open it. It does own a top-level path
   * segment, though — `/api`, `/pwa`, `/manifest.webmanifest` — and a CMS page
   * slugged into one of those is shadowed exactly as it would be by a page.
   */
  readonly handlerPaths: readonly string[];
  /** `storefront/app/sitemap.ts`'s source, or `null` when it is absent. */
  readonly sitemapText: string | null;
  /**
   * `storefront/app/reserved-segments.ts`'s source, or `null` when it is absent
   * (`specs/105-cms-root-page-urls/` FR-034).
   */
  readonly reservedSegmentsText: string | null;
  /** The route-level Suspense boundaries, and the directories that were unreadable. */
  readonly segments: SegmentWalk;
}

export interface SitemapDeclaration {
  readonly staticRoutes: readonly string[];
  readonly dynamicRoutes: readonly string[];
}

export interface StorefrontIndexabilityFinding {
  readonly kind: StorefrontIndexabilityFindingKind;
  /** The route pattern or sitemap entry the finding is about. */
  readonly subject: string;
  /** The file to open, repo-relative, or `null` for a sitemap entry. */
  readonly path: string | null;
  readonly detail: string;
}

export interface StorefrontIndexabilityResult {
  readonly findings: readonly StorefrontIndexabilityFinding[];
  /** Route patterns that declared a canonical. */
  readonly indexable: readonly string[];
  /** Route patterns that declared `robots.index: false` and no canonical. */
  readonly nonIndexable: readonly string[];
  /** Every route classified either way — the read line's `sites`. */
  readonly classified: readonly string[];
  /** Every file opened — the read line's `files`. */
  readonly filesRead: readonly string[];
  /** The `page.tsx` files alone: the population, before any classification. */
  readonly pagesRead: readonly string[];
  /**
   * Every response-status decision read on a document render path, over every
   * page. The `status-decision-under-a-boundary` predicate is a conjunction, so
   * "no page decides anything" prints `findings=0` honestly and means that the
   * call reader stopped working.
   */
  readonly decisionsRead: number;
  readonly sitemap: SitemapDeclaration | null;
  /**
   * `RESERVED_TOP_LEVEL_SEGMENTS`, or `null` when the declaration could not be
   * read in full — the same all-or-nothing rule the sitemap arrays take.
   */
  readonly reservedSegments: readonly string[] | null;
  /** The top-level path segments the route tree serves, deduplicated. */
  readonly topLevelSegments: readonly string[];
  /** Directories under `appRoot` the walk could not enumerate. */
  readonly unenumerableSegments: readonly string[];
  /** Sitemap entries that matched a route file. */
  readonly sitemapCovered: number;
  /** Sitemap entries declared. */
  readonly sitemapExpected: number;
}

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

/**
 * The route pattern a page file serves, in the vocabulary the sitemap speaks.
 *
 * Route groups `(marketing)`, private folders `_components` and parallel slots
 * `@modal` contribute no URL segment; everything else does, dynamic segments
 * included and spelled as the file tree spells them.
 */
export function routePatternOf(path: string, appRoot: string): string {
  const withoutRoot = path.startsWith(`${appRoot}/`) ? path.slice(appRoot.length + 1) : path;
  const segments = withoutRoot
    .split('/')
    .slice(0, -1)
    .filter(
      (segment) =>
        segment.length > 0 &&
        !(segment.startsWith('(') && segment.endsWith(')')) &&
        !segment.startsWith('_') &&
        !segment.startsWith('@'),
    );
  return `/${segments.join('/')}`;
}

interface PatternSegment {
  readonly literal: string | null;
  readonly catchAll: boolean;
  readonly optional: boolean;
}

function parsePattern(pattern: string): readonly PatternSegment[] {
  return pattern
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (segment.startsWith('[[') && segment.endsWith(']]')) {
        return { literal: null, catchAll: true, optional: true };
      }
      if (segment.startsWith('[...') && segment.endsWith(']')) {
        return { literal: null, catchAll: true, optional: false };
      }
      if (segment.startsWith('[') && segment.endsWith(']')) {
        return { literal: null, catchAll: false, optional: false };
      }
      return { literal: segment, catchAll: false, optional: false };
    });
}

/**
 * How specifically `pattern` serves the URL `path`, or `null` for no match.
 *
 * The score is the number of **literal** segments matched, so `/catalog` is
 * served by `/catalog` (score 1) rather than by the CMS catch-all `/[...slug]`
 * (score 0). Without the ranking a reconciliation would agree with the wrong
 * file and report the right one as unadvertised.
 */
export function matchScore(path: string, pattern: string): number | null {
  const url = path.split('/').filter((segment) => segment.length > 0);
  const segments = parsePattern(pattern);
  let literals = 0;
  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i] as PatternSegment;
    if (segment.catchAll) {
      const remaining = url.length - index;
      if (remaining === 0 && !segment.optional) return null;
      // A catch-all is terminal in Next's file tree.
      return i === segments.length - 1 ? literals : null;
    }
    if (index >= url.length) return null;
    if (segment.literal !== null) {
      if (url[index] !== segment.literal) return null;
      literals += 1;
    }
    index += 1;
  }
  return index === url.length ? literals : null;
}

// ---------------------------------------------------------------------------
// The sitemap — the independent second author
// ---------------------------------------------------------------------------

const STATIC_ARRAY = 'SITEMAP_STATIC_ROUTES';
const DYNAMIC_ARRAY = 'SITEMAP_DYNAMIC_ROUTES';

/**
 * The two declared arrays, or `null` when the set could not be read in full.
 *
 * An element the analysis cannot resolve makes the whole declaration unreadable
 * rather than shorter: a second author that answers about part of itself is not
 * a second author, and a short expectation is the floor switching itself off.
 */
export function readSitemapDeclaration(text: string | null): SitemapDeclaration | null {
  if (text === null) return null;
  const source = ts.createSourceFile('sitemap.ts', text, ts.ScriptTarget.Latest, true);
  const arrays = new Map<string, readonly string[] | null>();
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      const name = declaration.name.text;
      if (name !== STATIC_ARRAY && name !== DYNAMIC_ARRAY) continue;
      arrays.set(name, readStringArray(declaration.initializer));
    }
  }
  const statics = arrays.get(STATIC_ARRAY);
  const dynamics = arrays.get(DYNAMIC_ARRAY);
  if (statics === undefined || statics === null) return null;
  if (dynamics === undefined || dynamics === null) return null;
  return { staticRoutes: statics, dynamicRoutes: dynamics };
}

const RESERVED_ARRAY = 'RESERVED_TOP_LEVEL_SEGMENTS';

/**
 * `RESERVED_TOP_LEVEL_SEGMENTS`, or `null` when it could not be read in full.
 *
 * All-or-nothing for the sitemap's reason restated one file over: an element
 * this analysis cannot resolve makes the declaration *unreadable* rather than
 * *shorter*, because a short reserved set reports every segment it lost as an
 * `unreserved-top-level-segment` — a finding about the reader dressed as a
 * finding about the tree.
 */
export function readReservedSegments(text: string | null): readonly string[] | null {
  if (text === null) return null;
  const source = ts.createSourceFile('reserved-segments.ts', text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text !== RESERVED_ARRAY) continue;
      return readStringArray(declaration.initializer);
    }
  }
  return null;
}

/**
 * The top-level path segments this route tree serves, deduplicated and sorted.
 *
 * Derived from the **paths** of every routable file — pages and handlers alike
 * — through `routePatternOf`, so route groups, private folders and parallel
 * slots drop out exactly as they do for every other question this check asks.
 *
 * A **dynamic** first segment is not one: `/[...slug]` is the CMS catch-all
 * itself, and reserving it would be the storefront reserving the thing a page
 * slug *is*. The root page contributes nothing, for the same reason `/` is not
 * a segment.
 */
export function topLevelSegmentsOf(
  routedPaths: readonly string[],
  appRoot: string,
): readonly string[] {
  const segments = new Set<string>();
  for (const path of routedPaths) {
    const first = routePatternOf(path, appRoot).split('/').filter((part) => part.length > 0)[0];
    if (first === undefined || first.startsWith('[')) continue;
    segments.add(first);
  }
  return [...segments].sort();
}

function readStringArray(expression: ts.Expression | undefined): readonly string[] | null {
  const unwrapped = unwrap(expression);
  if (unwrapped === null || !ts.isArrayLiteralExpression(unwrapped)) return null;
  const values: string[] = [];
  for (const element of unwrapped.elements) {
    if (!ts.isStringLiteral(element) && !ts.isNoSubstitutionTemplateLiteral(element)) return null;
    values.push(element.text);
  }
  return values;
}

function unwrap(expression: ts.Expression | undefined): ts.Expression | null {
  let current: ts.Expression | undefined = expression;
  while (current !== undefined) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isSatisfiesExpression(current)) {
      current = current.expression;
      continue;
    }
    return current;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The route's own declaration
// ---------------------------------------------------------------------------

/** One `metadata` value the route declares — a `const`, or one `return`. */
interface MetadataObject {
  readonly noindex: boolean;
  readonly canonical: boolean;
  /** Why this object could not be read in full, or `null`. */
  readonly unreadable: string | null;
}

function readMetadataObjects(text: string, path: string): readonly MetadataObject[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const objects: MetadataObject[] = [];

  const readValue = (expression: ts.Expression | undefined): void => {
    const unwrapped = unwrap(expression);
    if (unwrapped === null) return;
    objects.push(readMetadataObject(unwrapped));
  };

  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === 'metadata') {
          readValue(declaration.initializer);
        }
      }
    }
    if (
      ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      node.name.text === 'generateMetadata' &&
      node.body !== undefined
    ) {
      const collectReturns = (inner: ts.Node): void => {
        // A nested function's `return` is not this function's metadata.
        if (inner !== node && (ts.isFunctionDeclaration(inner) || ts.isFunctionExpression(inner))) {
          return;
        }
        if (ts.isArrowFunction(inner)) return;
        if (ts.isReturnStatement(inner)) readValue(inner.expression);
        ts.forEachChild(inner, collectReturns);
      };
      ts.forEachChild(node.body, collectReturns);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return objects;
}

function isExported(node: ts.VariableStatement): boolean {
  return (
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

function readMetadataObject(expression: ts.Expression): MetadataObject {
  if (!ts.isObjectLiteralExpression(expression)) {
    return {
      noindex: false,
      canonical: false,
      unreadable: `the metadata value is a \`${ts.SyntaxKind[expression.kind]}\`, not an object literal`,
    };
  }
  let noindex = false;
  let canonical = false;
  let unreadable: string | null = null;

  for (const property of expression.properties) {
    if (ts.isSpreadAssignment(property)) {
      unreadable ??= 'the object spreads a value this analysis cannot resolve';
      continue;
    }
    if (!ts.isPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    if (name === 'robots') {
      const verdict = readRobots(property.initializer);
      if (verdict === 'unreadable') {
        unreadable ??= 'the `robots` value is computed, so its answer cannot be read here';
      } else if (verdict === 'noindex') {
        noindex = true;
      }
      continue;
    }
    if (name === 'alternates') {
      const inner = unwrap(property.initializer);
      if (inner === null || !ts.isObjectLiteralExpression(inner)) {
        unreadable ??= 'the `alternates` value is computed, so its canonical cannot be read here';
        continue;
      }
      for (const alternate of inner.properties) {
        if (ts.isPropertyAssignment(alternate) && propertyName(alternate.name) === 'canonical') {
          canonical = true;
        }
        if (ts.isShorthandPropertyAssignment(alternate) && alternate.name.text === 'canonical') {
          canonical = true;
        }
      }
    }
  }
  return { noindex, canonical, unreadable };
}

type RobotsVerdict = 'noindex' | 'index' | 'unreadable';

function readRobots(expression: ts.Expression): RobotsVerdict {
  const inner = unwrap(expression);
  if (inner === null) return 'unreadable';
  // Next accepts the string form too — `robots: 'noindex, nofollow'`.
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner)) {
    return inner.text.includes('noindex') ? 'noindex' : 'index';
  }
  if (!ts.isObjectLiteralExpression(inner)) return 'unreadable';
  for (const property of inner.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property.name) !== 'index') continue;
    const value = unwrap(property.initializer);
    if (value === null) return 'unreadable';
    if (value.kind === ts.SyntaxKind.FalseKeyword) return 'noindex';
    if (value.kind === ts.SyntaxKind.TrueKeyword) return 'index';
    return 'unreadable';
  }
  return 'unreadable';
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

/**
 * The JSON-LD types the route declares beside itself, or `null` when it makes
 * no readable declaration. An **empty array is a declaration** — `/search` owes
 * none, and saying so is what distinguishes it from a route nobody considered.
 */
export function readSeoDeclaration(text: string | null): readonly string[] | null {
  if (text === null) return null;
  const source = ts.createSourceFile('seo.ts', text, ts.ScriptTarget.Latest, true);
  let declared: readonly string[] | null = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'seo') continue;
      const value = unwrap(declaration.initializer);
      if (value === null || !ts.isObjectLiteralExpression(value)) continue;
      for (const property of value.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (propertyName(property.name) !== 'jsonLd') continue;
        declared = readStringArray(property.initializer);
      }
    }
  }
  return declared;
}

// ---------------------------------------------------------------------------
// The status decision, and the boundary above it
// ---------------------------------------------------------------------------

/**
 * The five calls that decide a response status
 * (`specs/108-storefront-response-status/contracts/response-status.md` §2.2).
 *
 * `forbidden` and `unauthorized` are Next 15's `authInterrupts` pair and appear
 * nowhere in this tree today. They are in the list rather than waiting to be
 * added, because the refactor this feature makes attractive — 33 authentication
 * guards that are about to become real `307`s — is exactly the one that reaches
 * for them.
 */
const STATUS_DECISION_CALLS = [
  'notFound',
  'redirect',
  'permanentRedirect',
  'forbidden',
  'unauthorized',
] as const;

export type StatusDecisionCall = (typeof STATUS_DECISION_CALLS)[number];

/** The module the five are imported from; a call of any other `redirect` is not one. */
const NAVIGATION_MODULE = 'next/navigation';

/** The file names Next reads as a route-level Suspense boundary (§2.1). */
const BOUNDARY_FILE_NAMES: readonly string[] = ['loading.tsx', 'template.tsx'];

/** One decision a page takes, and where. */
export interface StatusDecision {
  readonly call: StatusDecisionCall;
  /** 1-based, so the finding names a line a reader can open. */
  readonly line: number;
}

function isDirective(statement: ts.Statement, directive: string): boolean {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === directive
  );
}

/** A function whose body opens with `'use server'` — §2.3's discriminator. */
function opensAsAnAction(node: ts.Node): boolean {
  if (
    !ts.isFunctionDeclaration(node) &&
    !ts.isFunctionExpression(node) &&
    !ts.isArrowFunction(node) &&
    !ts.isMethodDeclaration(node)
  ) {
    return false;
  }
  const body = node.body;
  if (body === undefined || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return first !== undefined && isDirective(first, 'use server');
}

/**
 * Which local names in this file are the five navigation calls.
 *
 * Bound through the **import**, not by spelling: a page with its own
 * `redirect()` helper is not deciding a response status, and a page that
 * imports `notFound as missing` is. Both an aliased named import and a
 * namespace import are followed; what is not followed is a re-export through
 * another module, and that bound is in the header rather than discovered later.
 */
function navigationBindings(source: ts.SourceFile): {
  readonly named: ReadonlyMap<string, StatusDecisionCall>;
  readonly namespaces: ReadonlySet<string>;
} {
  const named = new Map<string, StatusDecisionCall>();
  const namespaces = new Set<string>();
  const known = new Set<string>(STATUS_DECISION_CALLS);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== NAVIGATION_MODULE) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;
    const bindings = clause.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.text ?? element.name.text;
      if (!known.has(imported)) continue;
      named.set(element.name.text, imported as StatusDecisionCall);
    }
  }
  return { named, namespaces };
}

/**
 * Every response-status decision this page takes **on the document render
 * path** (§2.2), in source order.
 *
 * §2.3 is the load-bearing half and it is a rule about *execution context*, not
 * about a call: 224 of this tree's 292 such calls are inside `'use server'`
 * functions, where they compose an action response and are measured correct
 * with a boundary standing. A classifier blind to the directive would report 33
 * correct authentication guards as findings, which is a check nobody would
 * keep.
 *
 * The directive is honoured in both places Next accepts it — at the top of the
 * file, which makes every function in it an action, and at the top of a
 * function body, which makes that function and everything nested inside it one.
 */
export function readStatusDecisions(text: string, path: string): readonly StatusDecision[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const first = source.statements[0];
  // A file-level `'use server'` makes every export in it an action, so nothing
  // in it is a document decision.
  if (first !== undefined && isDirective(first, 'use server')) return [];

  const { named, namespaces } = navigationBindings(source);
  if (named.size === 0 && namespaces.size === 0) return [];

  const decisions: StatusDecision[] = [];
  const visit = (node: ts.Node, insideAnAction: boolean): void => {
    const action = insideAnAction || opensAsAnAction(node);
    if (!action && ts.isCallExpression(node)) {
      const callee = node.expression;
      const call = ts.isIdentifier(callee)
        ? named.get(callee.text)
        : ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            namespaces.has(callee.expression.text) &&
            (STATUS_DECISION_CALLS as readonly string[]).includes(callee.name.text)
          ? (callee.name.text as StatusDecisionCall)
          : undefined;
      if (call !== undefined) {
        decisions.push({
          call,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
    }
    ts.forEachChild(node, (child) => {
      visit(child, action);
    });
  };
  ts.forEachChild(source, (child) => {
    visit(child, false);
  });
  return decisions;
}

/**
 * Every boundary file that sits above this page: in its own segment, or in any
 * ancestor segment up to `appRoot` inclusive (§2.1).
 *
 * Directory ancestry rather than route ancestry, deliberately. A route group
 * `(catalog)` contributes no URL segment and does contribute a directory Next
 * will read a `loading.tsx` out of, so a chain built from the route pattern
 * would walk straight past the one place a boundary is most likely to be.
 */
export function boundariesAbove(
  pagePath: string,
  boundaries: readonly string[],
  appRoot: string,
): readonly string[] {
  const segments = pagePath.split('/');
  segments.pop();
  const chain = new Set<string>();
  while (segments.length > 0) {
    const directory = segments.join('/');
    chain.add(directory);
    if (directory === appRoot) break;
    segments.pop();
  }
  return boundaries.filter((boundary) => {
    const at = boundary.slice(0, boundary.lastIndexOf('/'));
    return chain.has(at);
  });
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

/**
 * The findings, over route source text and the sitemap's source text.
 *
 * Pure, and over the text a real run reads — the top of the analysis (issue
 * #130). A fixture handing in classifications would prove the reporter and
 * leave the AST walk, which is where all seven findings are decided, unproven.
 */
export function checkStorefrontIndexability(
  input: StorefrontIndexabilityInput,
): StorefrontIndexabilityResult {
  const sitemap = readSitemapDeclaration(input.sitemapText);
  const reservedSegments = readReservedSegments(input.reservedSegmentsText);
  const findings: StorefrontIndexabilityFinding[] = [];
  const filesRead: string[] = [];
  const classified: string[] = [];
  const indexable: string[] = [];
  const nonIndexable: string[] = [];

  if (input.sitemapText !== null) filesRead.push(SITEMAP_FILE);
  if (input.reservedSegmentsText !== null) filesRead.push(RESERVED_SEGMENTS_FILE);

  const pagesRead: string[] = [];
  const patterns = new Map<string, RouteFile>();
  for (const route of input.routes) {
    filesRead.push(route.path);
    pagesRead.push(route.path);
    if (route.seoText !== null) filesRead.push(route.path.replace(/page\.tsx$/u, 'seo.ts'));
    patterns.set(routePatternOf(route.path, input.appRoot), route);
  }
  for (const boundary of input.segments.boundaries) filesRead.push(boundary);

  /** Which route pattern serves this sitemap entry — the most specific one. */
  const serves = (entry: string): string | null => {
    let best: { pattern: string; score: number } | null = null;
    for (const pattern of patterns.keys()) {
      // A dynamic entry names a pattern; a static entry names a URL.
      const score = entry === pattern ? Number.MAX_SAFE_INTEGER : matchScore(entry, pattern);
      if (score === null) continue;
      if (best === null || score > best.score) best = { pattern, score };
    }
    return best === null ? null : best.pattern;
  };

  const advertised = new Set<string>();
  let sitemapCovered = 0;
  const entries = sitemap === null ? [] : [...sitemap.staticRoutes, ...sitemap.dynamicRoutes];
  for (const entry of entries) {
    const pattern = serves(entry);
    if (pattern === null) {
      findings.push({
        kind: 'orphan-sitemap-entry',
        subject: entry,
        path: SITEMAP_FILE,
        detail:
          'the sitemap advertises this URL and no route file serves it — a crawler is being ' +
          'sent to a 404',
      });
      continue;
    }
    sitemapCovered += 1;
    advertised.add(pattern);
  }

  let decisionsRead = 0;
  for (const [pattern, route] of patterns) {
    // `specs/108-storefront-response-status/` FR-014. Asked of every page,
    // indexable or not, and before the indexability classification: a `noindex`
    // account page whose `redirect()` answers 200 is the same defect as an
    // indexable one whose `notFound()` does, and 33 of the 68 sites in this tree
    // are behind a login.
    const decisions = readStatusDecisions(route.text, route.path);
    decisionsRead += decisions.length;
    const above = boundariesAbove(route.path, input.segments.boundaries, input.appRoot);
    if (decisions.length > 0 && above.length > 0) {
      const first = decisions[0] as StatusDecision;
      findings.push({
        kind: 'status-decision-under-a-boundary',
        subject: pattern,
        path: route.path,
        detail:
          `the page calls \`${first.call}()\` at line ${first.line}` +
          `${decisions.length === 1 ? '' : ` (and ${decisions.length - 1} more)`}, and ` +
          `\`${above.join('`, `')}\` put${above.length === 1 ? 's' : ''} it inside a Suspense ` +
          'boundary it does not own. Next flushes the shell as soon as that fallback is ready, ' +
          'so by the time this page decides anything there is no status line left to set — ' +
          'measured: the decision survives as a directive inside the RSC payload, which the ' +
          'Next client library honours and no crawler, link checker or monitor does',
      });
    }

    const objects = readMetadataObjects(route.text, route.path);
    const contradiction = objects.find((object) => object.noindex && object.canonical);
    if (contradiction !== undefined) {
      findings.push({
        kind: 'contradictory-indexability',
        subject: pattern,
        path: route.path,
        detail:
          'one metadata object declares `robots.index: false` **and** a canonical — a canonical ' +
          'on a page nobody may fetch is a statement about nothing',
      });
      continue;
    }

    const declaresCanonical = objects.some((object) => object.canonical);
    const declaresNoindex = objects.some((object) => object.noindex);
    const unreadable = objects.find((object) => object.unreadable !== null)?.unreadable ?? null;

    if (declaresCanonical) {
      indexable.push(pattern);
      classified.push(pattern);
      if (!advertised.has(pattern)) {
        findings.push({
          kind: 'sitemap-orphan-route',
          subject: pattern,
          path: SITEMAP_FILE,
          detail:
            'the route declares itself indexable and the sitemap advertises nothing that ' +
            'reaches it, so a crawler is never told the page is there',
        });
      }
      if (readSeoDeclaration(route.seoText) === null) {
        findings.push({
          kind: 'undeclared-structured-data',
          subject: pattern,
          path: route.path.replace(/page\.tsx$/u, 'seo.ts'),
          detail:
            'an indexable route with no readable `seo.ts` beside it — nothing says which ' +
            'schema.org types this page emits, so nothing can assert that it emits them',
        });
      }
      continue;
    }

    if (declaresNoindex) {
      nonIndexable.push(pattern);
      classified.push(pattern);
      if (advertised.has(pattern)) {
        findings.push({
          kind: 'missing-canonical',
          subject: pattern,
          path: route.path,
          detail:
            'the sitemap advertises this route while the route declares `robots.index: false` — ' +
            'the two authors disagree and one of them is wrong',
        });
      }
      continue;
    }

    if (unreadable !== null) {
      findings.push({
        kind: 'unresolvable-indexability',
        subject: pattern,
        path: route.path,
        detail: `${unreadable}; read as indexable it agrees with everything and read as ` +
          'non-indexable it excuses everything, so it is neither',
      });
      continue;
    }

    if (advertised.has(pattern)) {
      findings.push({
        kind: 'missing-canonical',
        subject: pattern,
        path: route.path,
        detail:
          'the sitemap advertises this route, so it is indexable, and it declares no ' +
          '`alternates.canonical`',
      });
      continue;
    }

    findings.push({
      kind: 'undeclared-indexability',
      subject: pattern,
      path: route.path,
      detail:
        'the route declares neither `robots.index: false` nor `alternates.canonical` — silence ' +
        'is not a classification, and a new page inherits nothing from the group it sits in',
    });
  }

  /**
   * `specs/105-cms-root-page-urls/` FR-034 — the storefront publishes the
   * top-level segments it owns, reconciled against its own route tree.
   *
   * The two directions are reported apart, in this file's own idiom
   * (`sitemap-orphan-route` / `orphan-sitemap-entry`), because a repair in one
   * must not be able to hide a hole in the other — and because they fail
   * differently: an unreserved segment is the fail-**open** case a CMS page can
   * be silently lost to, a stale entry only refuses a slug that is free.
   */
  const topLevelSegments = topLevelSegmentsOf(
    [...input.routes.map((route) => route.path), ...input.handlerPaths],
    input.appRoot,
  );
  if (reservedSegments !== null) {
    const reserved = new Set(reservedSegments);
    for (const segment of topLevelSegments) {
      if (reserved.has(segment)) continue;
      findings.push({
        kind: 'unreserved-top-level-segment',
        subject: `/${segment}`,
        path: RESERVED_SEGMENTS_FILE,
        detail:
          'this storefront serves this top-level path and does not publish it as reserved — a ' +
          'CMS page slugged into it saves, publishes and is never shown, because the route ' +
          'wins and nothing tells the operator',
      });
    }
    const served = new Set(topLevelSegments);
    for (const segment of reservedSegments) {
      if (served.has(segment)) continue;
      findings.push({
        kind: 'stale-reserved-segment',
        subject: `/${segment}`,
        path: RESERVED_SEGMENTS_FILE,
        detail:
          'this segment is published as reserved and no route file serves it — a deployment ' +
          'copying this list refuses a slug that is actually free',
      });
    }
  }

  return {
    findings,
    indexable,
    nonIndexable,
    classified,
    filesRead,
    pagesRead,
    decisionsRead,
    unenumerableSegments: input.segments.unreadable,
    sitemap,
    reservedSegments,
    topLevelSegments,
    sitemapCovered,
    sitemapExpected: entries.length,
  };
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type VacuousReasonKind =
  | 'no-page-file'
  | 'unreadable-sitemap'
  | 'nothing-classified'
  | 'unenumerable-segment'
  | 'nothing-decided'
  | 'no-top-level-segment'
  | 'unreadable-reserved-segments';

export interface VacuousReason {
  readonly kind: VacuousReasonKind;
  readonly message: string;
}

/**
 * Why this run may not report on what it read, or `null`.
 *
 * The fourth refusal of `contracts/seo-declarations.md` §5 — a walk short of
 * what the sitemap implies — is `readSizeRefusal`'s `short-walk` over the
 * `sitemap:<covered>/<expected>` coverage token, so #215's predicate is stated
 * once for the whole estate rather than reimplemented here.
 */
export function vacuousReason(result: StorefrontIndexabilityResult): VacuousReason | null {
  // First, and before the sitemap question: a moved `storefront/app` takes the
  // sitemap with it, and "the second author is gone" is a true but useless
  // sentence to hand someone whose whole route tree has moved.
  if (result.pagesRead.length === 0) {
    return {
      kind: 'no-page-file',
      message:
        `the walk of ${APP_ROOT} opened no \`page.tsx\` at all — there is no population to ` +
        'classify, and every reconciliation below is vacuously satisfied',
    };
  }
  if (result.sitemap === null) {
    return {
      kind: 'unreadable-sitemap',
      message:
        `${SITEMAP_FILE} is absent, or its \`${STATIC_ARRAY}\` / \`${DYNAMIC_ARRAY}\` could not ` +
        'be read as string arrays. It is the independent second author, and a check with one ' +
        'author is a check that agrees with itself',
    };
  }
  if (result.sitemap.staticRoutes.length + result.sitemap.dynamicRoutes.length === 0) {
    return {
      kind: 'unreadable-sitemap',
      message:
        'the sitemap advertises no route at all, so every reconciliation below it is ' +
        'vacuously satisfied',
    };
  }
  if (result.classified.length === 0) {
    return {
      kind: 'nothing-classified',
      message:
        'no route was classified either way. The predicate is declaration-based, so "nobody ' +
        'declared anything" prints `findings=0` honestly and means the opposite',
    };
  }
  // `specs/108-storefront-response-status/contracts/response-status.md` §5.5,
  // both of them. A directory the walk was refused is a directory that may hold
  // the `loading.tsx` defeating a page below it, and the pages under it would be
  // reported clean; and `status-decision-under-a-boundary` is a conjunction, so
  // a call reader that stopped resolving prints `findings=0` honestly.
  if (result.unenumerableSegments.length > 0) {
    return {
      kind: 'unenumerable-segment',
      message:
        `${result.unenumerableSegments.join(', ')} could not be enumerated, so whether a ` +
        '`loading.tsx` sits there is unknown — and every page under it would be reported as ' +
        'having no boundary above it, which is the one verdict this run may not give on a ' +
        'directory it could not read',
    };
  }
  if (result.decisionsRead === 0) {
    return {
      kind: 'nothing-decided',
      message:
        'no page in this tree was read as deciding a response status — no `notFound()`, no ' +
        '`redirect()`, no `permanentRedirect()` outside a `\'use server\'` function. That is a ' +
        'storefront no dynamic route can 404, so it is the call reader that stopped working ' +
        'rather than the tree that became clean',
    };
  }
  // `specs/105-cms-root-page-urls/` FR-034's two, and both are the shape #215
  // is about: the reconciliation is a set comparison, so an empty set on either
  // side reports the *other* side's whole contents and nothing about the tree.
  if (result.topLevelSegments.length === 0) {
    return {
      kind: 'no-top-level-segment',
      message:
        `the walk of ${APP_ROOT} produced no top-level path segment at all, so every entry in ` +
        `\`${RESERVED_ARRAY}\` would be reported stale — a finding about the walk rather than ` +
        'about the tree',
    };
  }
  if (result.reservedSegments === null) {
    return {
      kind: 'unreadable-reserved-segments',
      message:
        `${RESERVED_SEGMENTS_FILE} is absent, or its \`${RESERVED_ARRAY}\` could not be read as ` +
        'a string array. It is the storefront\'s own statement of what it reserves, and a ' +
        'deployment copies its `cms.reserved_slug_segments` value from it; with nothing to ' +
        'read, the reconciliation below is vacuously satisfied in both directions',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The CLI half
// ---------------------------------------------------------------------------

const REMEDIES: Readonly<Record<StorefrontIndexabilityFindingKind, string>> = {
  'undeclared-indexability':
    'Add one line. A page a crawler must not index declares ' +
    '`export const metadata: Metadata = { robots: { index: false, follow: false } };`; an ' +
    'indexable one declares `alternates: { canonical: seo.route }` and ships a `seo.ts` beside ' +
    'itself. 48 of the 57 pages in this tree take the first, and that is the usual answer for ' +
    'anything behind a login or inside checkout.',
  'contradictory-indexability':
    'Decide. If the page is not indexable, drop the canonical; if it is, drop the `robots` ' +
    'block. A `noindex` page with a canonical tells a crawler to consolidate ranking signals ' +
    'onto a URL it has just been told to ignore.',
  'unresolvable-indexability':
    'Write the declaration where it can be read: a literal `robots` object or a literal ' +
    '`alternates.canonical` in `export const metadata`, or in the `generateMetadata` return. ' +
    'A value assembled elsewhere is a classification only its author can see.',
  'missing-canonical':
    'Either give the route `alternates: { canonical: … }` (and a `seo.ts` beside it), or take ' +
    'it out of `storefront/app/sitemap.ts`. The sitemap and the route are the two authors of ' +
    'one fact and they are disagreeing.',
  'sitemap-orphan-route':
    'Add the route to `SITEMAP_STATIC_ROUTES` (a URL it serves with no database read) or to ' +
    '`SITEMAP_DYNAMIC_ROUTES` (the pattern whose URLs the sitemap enumerates). An indexable ' +
    'page nobody is told about is a page nobody finds.',
  'orphan-sitemap-entry':
    'Remove the entry, or add the route file it names. A sitemap URL that 404s costs crawl ' +
    'budget and is a quality signal in its own right.',
  'undeclared-structured-data':
    "Ship a `seo.ts` beside the `page.tsx` exporting `seo: RouteSeo` with the route pattern " +
    'and the schema.org types the page emits. `jsonLd: []` is a valid declaration for a route ' +
    'that owes none — say so rather than leaving the question open.',
  'unreserved-top-level-segment':
    'Add the segment to `RESERVED_TOP_LEVEL_SEGMENTS` in ' +
    '`storefront/app/reserved-segments.ts`, and add it to the deployment\'s ' +
    '`cms.reserved_slug_segments` setting. A CMS page is served at the site root, so every ' +
    'top-level path this storefront owns is a path a page can be silently lost to — the page ' +
    'saves, publishes, and the URL goes on serving your route ' +
    '(`specs/105-cms-root-page-urls/contracts/cms-page-url.md` §5.3.1).',
  'stale-reserved-segment':
    'Remove the entry, or add the route file it names. A segment that has left the storefront ' +
    'and is still published as reserved refuses a page slug that is actually free — the ' +
    'fail-safe direction of this reconciliation, and still one line of drift a deployment ' +
    'copies.',
  'status-decision-under-a-boundary':
    'Delete the boundary, or move the skeleton inside the page. A `loading.tsx` is the one ' +
    'thing a page cannot work around: the shell is flushed when its fallback is ready, and ' +
    'nothing an author writes in the page component gets the status line back — a `notFound()` ' +
    'as the very first statement answers 200 just the same. What a page *may* have is a ' +
    '`<Suspense>` it renders itself, **below** the statement that decides the status; that ' +
    'keeps the fallback in the first flush at an unchanged time to last byte ' +
    '(`specs/108-storefront-response-status/research.md` §1.3). A route that decides nothing ' +
    'keeps its `loading.tsx` — `/catalog` does.',
};

interface WalkedRoutes {
  readonly routes: readonly RouteFile[];
  /** `route.ts` / `route.tsx` paths — no text; see `handlerPaths` on the input. */
  readonly handlerPaths: readonly string[];
  readonly sitemapText: string | null;
  readonly reservedSegmentsText: string | null;
  readonly segments: SegmentWalk;
}

/** Next's names for a route handler, which emits no document. */
const HANDLER_FILE_NAMES: readonly string[] = ['route.ts', 'route.tsx'];

function walkRoutes(repoRoot: string): WalkedRoutes {
  const appDirectory = join(repoRoot, APP_ROOT);
  const routes: RouteFile[] = [];
  // The same walk, one more file name. The boundary files sit in directories
  // this already visits, which is why FR-014 is a finding kind here and not a
  // check of its own (contract §5.2).
  const boundaries: string[] = [];
  const handlerPaths: string[] = [];
  const unreadable: string[] = [];

  const here = (full: string): string => relative(repoRoot, full).split(sep).join('/');

  const walk = (directory: string): void => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      // A directory that is not there contributes nothing; the *whole tree*
      // being gone is what `vacuousReason`'s `no-page-file` refuses, and it is
      // the record that answers it rather than this walk. A directory that is
      // there and was refused is a different state, and it is recorded so
      // `unenumerable-segment` can refuse over it: the boundary question cannot
      // be answered for anything below it.
      unreadable.push(here(directory));
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (BOUNDARY_FILE_NAMES.includes(entry.name)) boundaries.push(here(full));
      // A path and no read: a handler emits no document, so it answers no
      // indexability question — it owns a top-level segment and nothing else
      // (feature 105, FR-034).
      if (HANDLER_FILE_NAMES.includes(entry.name)) handlerPaths.push(here(full));
      if (entry.name !== 'page.tsx') continue;
      const seoPath = join(directory, 'seo.ts');
      routes.push({
        path: here(full),
        text: readFileSync(full, 'utf8'),
        seoText: exists(seoPath) ? readFileSync(seoPath, 'utf8') : null,
      });
    }
  };
  walk(appDirectory);
  routes.sort((a, b) => a.path.localeCompare(b.path));
  boundaries.sort();
  handlerPaths.sort();

  const sitemapPath = join(repoRoot, SITEMAP_FILE);
  const reservedPath = join(repoRoot, RESERVED_SEGMENTS_FILE);
  return {
    routes,
    handlerPaths,
    sitemapText: exists(sitemapPath) ? readFileSync(sitemapPath, 'utf8') : null,
    reservedSegmentsText: exists(reservedPath) ? readFileSync(reservedPath, 'utf8') : null,
    segments: { boundaries, unreadable },
  };
}

function exists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function main(): void {
  const listMode = process.argv.includes('--list');
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const walked = walkRoutes(repoRoot);

  const result = checkStorefrontIndexability({
    appRoot: APP_ROOT,
    routes: walked.routes,
    handlerPaths: walked.handlerPaths,
    sitemapText: walked.sitemapText,
    reservedSegmentsText: walked.reservedSegmentsText,
    segments: walked.segments,
  });

  // §5's refusals, all three of them over the record rather than over the walk,
  // so a red proof enters where a real run enters (issue #130). The first is
  // the moved tree: `no-page-file` comes before the sitemap question because a
  // moved `storefront/app` takes `sitemap.ts` with it.
  const refusal = vacuousReason(result);
  if (refusal !== null) {
    console.error(`${PREFIX} ${refusal.message}; refusing to report a vacuous pass`);
    process.exit(2);
  }

  if (listMode) {
    for (const route of walked.routes) {
      const pattern = routePatternOf(route.path, APP_ROOT);
      const state = result.indexable.includes(pattern)
        ? 'INDEX  '
        : result.nonIndexable.includes(pattern)
          ? 'NOINDEX'
          : '???????';
      console.log(`${state} ${pattern.padEnd(24)} ${route.path}`);
    }
    console.log('');
  }

  // §5's second refusal, through the shared reporter: the walk covering fewer
  // sitemap entries than the sitemap declares is #215's predicate — not "the
  // walk came back empty" but "the walk disagreed with an independent second
  // author about how much there was to read".
  reportReadSize({
    prefix: PREFIX,
    files: result.filesRead.length,
    sites: result.classified.length,
    coverage: [
      { source: 'sitemap', expected: result.sitemapExpected, covered: result.sitemapCovered },
    ],
  });
  console.log(
    `${PREFIX} pages=${walked.routes.length} indexable=${result.indexable.length} ` +
      `noindex=${result.nonIndexable.length} boundaries=${walked.segments.boundaries.length} ` +
      `status-decisions=${result.decisionsRead} segments=${result.topLevelSegments.length} ` +
      `findings=${result.findings.length}`,
  );

  if (result.findings.length === 0) process.exit(0);

  const kinds = [...new Set(result.findings.map((finding) => finding.kind))].sort();
  for (const kind of kinds) {
    console.error(`\n[${kind}]\n${REMEDIES[kind]}\n`);
    for (const finding of result.findings.filter((candidate) => candidate.kind === kind)) {
      console.error(
        `  - ${finding.subject}${finding.path === null ? '' : ` (${finding.path})`}\n` +
          `      ${finding.detail}`,
      );
    }
  }
  process.exit(1);
}

// CLI only — importing this module (the companion test does) must not scan.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
