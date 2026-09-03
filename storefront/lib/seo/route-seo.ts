/**
 * The per-route SEO declaration (`specs/098-storefront-ssr-seo-a11y-suite/`,
 * FR-010/FR-012/FR-014; `contracts/seo-declarations.md` §2–§3).
 *
 * Every indexable route ships a `seo.ts` **beside its `page.tsx`** holding this
 * shape, and its `page.tsx` takes its `alternates.canonical` from it. Two
 * consumers read it and neither holds a copy of the table:
 *
 *   * `check:storefront-indexability` (Phase 2) reads the declaration and
 *     refuses an indexable route that does not make one;
 *   * `conformance:storefront` (Phase 4) asserts the **served HTML** against
 *     the types declared here.
 *
 * It is a file of its own rather than an export of `page.tsx` for a reason that
 * is not style: Next 15's generated page types are
 * `checkFields<Diff<{ default, metadata, generateMetadata, … }, TEntry, ''>>`,
 * so any *extra* export from a `page.tsx` is a build-time type error ("Page has
 * an invalid export field"). A co-located module is what "beside the route"
 * can mean here.
 */

/**
 * The schema.org types a route may declare.
 *
 * A closed union rather than `string`, so a typo is a `tsc` error at the
 * declaration and Phase 4's assertion has a vocabulary it can trust. Widening
 * it is a deliberate edit in the merge request that emits the new type.
 */
export type JsonLdType =
  | 'BlogPosting'
  | 'BreadcrumbList'
  | 'ContactPage'
  | 'ItemList'
  | 'Offer'
  | 'Organization'
  | 'Product';

export interface RouteSeo {
  /**
   * The route **pattern** this declaration is about, spelled as the Next file
   * tree produces it — `/catalog`, `/c/[slug]`, `/blog/[[...slug]]`.
   *
   * It is the vocabulary `app/sitemap.ts` speaks, so the reconciliation
   * compares like with like, and it is what a static route's `page.tsx` hands
   * straight to `alternates.canonical`. A dynamic route composes its own
   * canonical **path** from its resolved segment; the canonical is always a
   * path and never an absolute URL, because the deployment's origin is one
   * value in one place (`metadataBase`) and a route that spelled its own would
   * go on naming the old origin after a move, silently.
   */
  readonly route: string;
  /**
   * The schema.org types this route's server HTML emits.
   *
   * An **empty array is a declaration**, not an omission — `/search` owes none
   * (a search results page is not a thing), and saying so is what distinguishes
   * it from a route whose author never considered the question.
   */
  readonly jsonLd: readonly JsonLdType[];
}

/**
 * The canonical **path** for one page of a dynamic route.
 *
 * `canonicalPath(seo.route, { slug: 'pumps' })` over `/c/[slug]` gives
 * `/c/pumps`. It exists so a dynamic route's `page.tsx` still *reads* its own
 * declaration rather than re-spelling the pattern in a template literal — the
 * two would drift the first time a segment was renamed, and the canonical is
 * the one field where drift is silent.
 *
 * Every segment shape Next's file tree produces is handled: `[slug]` takes one
 * value, `[...slug]` one or more, `[[...slug]]` zero or more. A segment the
 * caller supplies no value for is **dropped**, which is what makes the blog's
 * optional catch-all resolve to `/blog` for its index.
 */
export function canonicalPath(
  route: string,
  params: Readonly<Record<string, string | readonly string[] | undefined>>,
): string {
  const segments: string[] = [];
  for (const segment of route.split('/')) {
    if (segment.length === 0) continue;
    const dynamic = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/u.exec(segment);
    if (dynamic === null) {
      segments.push(segment);
      continue;
    }
    const value = params[dynamic[1] as string];
    if (value === undefined) continue;
    if (Array.isArray(value)) segments.push(...value);
    else segments.push(value as string);
  }
  return `/${segments.join('/')}`;
}
