import type { MetadataRoute } from 'next';

import { getBlogIndex } from '../lib/api/blog';
import { getCategoryTree, listProducts } from '../lib/api/catalog';
import { getCmsPageIndex, normalizeCmsUrlPath } from '../lib/api/cms';
import { getHomepageConfig } from '../lib/api/homepage';
import { getServerContext } from '../lib/server-context';
import { absoluteUrl } from '../lib/seo/site-url';
import { localizePath, type UrlLanguageState } from '../lib/i18n/locale-path';

/**
 * What this storefront tells crawlers to fetch
 * (`specs/098-storefront-ssr-seo-a11y-suite/`, FR-011;
 * `contracts/seo-declarations.md` §4).
 *
 * Until this file existed a crawler was told nothing at all, which is a
 * Constitution VII obligation the reference storefront did not meet — and under
 * D-195 whatever is true of the reference storefront on the day a client
 * scaffolds is copied into that client's tree.
 *
 * ## It is also the check's independent second author, and that is deliberate
 *
 * `check:storefront-indexability` derives the indexable route set from the
 * route files' own declarations and reconciles it against the two arrays below.
 * An indexable route this file does not advertise is a finding; an entry here
 * matching no route file is a finding. Deriving the population from the route
 * files and then checking the route files against it would be one author twice.
 *
 * The two arrays are therefore written **by hand**, as a statement about what
 * the shop advertises, and must not be computed from the route tree — the
 * moment they are, the reconciliation becomes a mirror.
 *
 * ## Static and dynamic
 *
 * `SITEMAP_STATIC_ROUTES` are URLs this file emits with no database read.
 * `SITEMAP_DYNAMIC_ROUTES` names the **route patterns** whose URLs it
 * enumerates from the backend below. The *URLs* of the dynamic half are data —
 * a product slug is a row, not a route — and are outside the reconciliation;
 * the *patterns* are not, because three of the eight indexable route types have
 * no static URL at all and a reconciliation blind to them would report each of
 * them as unadvertised.
 */
export const SITEMAP_STATIC_ROUTES: readonly string[] = [
  '/',
  '/catalog',
  '/search',
  '/blog',
  '/kontakt',
];

/**
 * Route patterns this sitemap enumerates from the backend. Spelled as the route
 * pattern the file tree produces, so the reconciliation compares like with like.
 */
export const SITEMAP_DYNAMIC_ROUTES: readonly string[] = [
  '/p/[slug]',
  '/c/[slug]',
  '/[...slug]',
];

type Ctx = Awaited<ReturnType<typeof getServerContext>>['ctx'];

/** How many product URLs one sitemap emits. Below Google's 50 000 ceiling. */
const PRODUCT_URL_LIMIT = 5000;

/** How many products one request asks for. */
const PRODUCT_PAGE_SIZE = 100;

/**
 * How many pages the product walk asks for at most — twice what full pages
 * need to reach `PRODUCT_URL_LIMIT`, so short and empty pages are tolerated
 * and the walk still ends without being told to.
 */
const PRODUCT_PAGE_LIMIT = (2 * PRODUCT_URL_LIMIT) / PRODUCT_PAGE_SIZE;

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = SITEMAP_STATIC_ROUTES.map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: path === '/' ? ('daily' as const) : ('weekly' as const),
    priority: path === '/' ? 1 : 0.7,
  }));

  // The static half above needs no backend and is composed before anything is
  // asked of one, deliberately: a shop whose API is down still has a home page,
  // a catalogue and a contact page, and a crawler that got a 500 here would be
  // told the shop advertises nothing at all.
  //
  // Each dynamic source is then asked separately and one that cannot answer
  // contributes nothing. The tolerance is narrow and it is the right one here:
  // a sitemap that throws is a 500 to a crawler, which is strictly worse than a
  // sitemap that is short — the crawler keeps the URLs it already knows either
  // way, and a 500 on this path is a signal search engines act on.
  let ctx: Ctx;
  let anonymousAccess: boolean | undefined;
  let urlState: UrlLanguageState;
  try {
    ({ ctx, anonymousAccess, urlState } = await getServerContext());
  } catch {
    return entries;
  }

  // A store closed to anonymous visitors (`specs/154-sales-channel-access/`)
  // sends every crawler — which never signs in — to its sign-in page, and its
  // backend refuses the catalogue to them. A sitemap would advertise only
  // redirects, so it advertises nothing and asks nothing.
  if (anonymousAccess === false) return [];

  // Feature 167 (FR-032) — every page is listed under each channel language's path
  // prefix (none for the unprefixed default). Without known URL languages (an older
  // backend) the paths are listed as they are, in the request's language only.
  const languages: readonly (string | undefined)[] =
    urlState.languages.length > 0 ? urlState.languages.map((l) => l.languageCode) : [undefined];
  const inLanguage = (path: string, languageCode: string | undefined): string =>
    absoluteUrl(languageCode === undefined ? path : localizePath(path, urlState, languageCode));

  const blog = await blogPaths(ctx);
  const localized: MetadataRoute.Sitemap = [];
  for (const entry of entries) {
    const route = new URL(entry.url).pathname;
    // Feature 171 — the blog index lives under the operator's prefix; `/blog` then only redirects.
    const path = route === '/blog' ? blog.base : route;
    for (const languageCode of languages) localized.push({ ...entry, url: inLanguage(path, languageCode) });
  }

  for (const languageCode of languages) {
    // A product's key is per language (163): the listing is asked in each language.
    const inThatLanguage = languageCode === undefined ? ctx : { ...ctx, locale: languageCode };
    for (const path of await productPaths(inThatLanguage)) {
      localized.push({ url: inLanguage(path, languageCode), lastModified: now, priority: 0.8 });
    }
  }
  const categories = await categoryPaths(ctx);
  for (const languageCode of languages) {
    for (const path of categories) localized.push({ url: inLanguage(path, languageCode), lastModified: now, priority: 0.6 });
    for (const path of blog.paths) localized.push({ url: inLanguage(path, languageCode), lastModified: now, priority: 0.5 });
  }
  for (const entry of await cmsPageEntries(ctx)) {
    // R24 + feature 167: the backend answers each language's own URL — its own slug,
    // under its prefix — so those are listed as they are, each declaring the others
    // as `hreflang` alternates. An index from a backend that predates them lists the
    // page's path under every channel language.
    if (entry.alternates.length > 0) {
      const alternates =
        entry.alternates.length > 1
          ? Object.fromEntries(entry.alternates.map((alternate) => [alternate.language, absoluteUrl(alternate.url)]))
          : null;
      for (const alternate of entry.alternates) {
        localized.push({
          url: absoluteUrl(alternate.url),
          lastModified: entry.lastModified,
          changeFrequency: 'monthly',
          priority: 0.5,
          ...(alternates ? { alternates: { languages: alternates } } : {}),
        });
      }
      continue;
    }
    for (const languageCode of languages) {
      localized.push({
        url: inLanguage(entry.path, languageCode),
        lastModified: entry.lastModified,
        changeFrequency: 'monthly',
        priority: 0.5,
      });
    }
  }

  return localized;
}

/**
 * The products of this channel, one URL each.
 *
 * A walk over a remote, cursor-paginated list, and **bounded by construction**:
 * the `for` below cannot run more than `PRODUCT_PAGE_LIMIT` times whatever the
 * API answers. It used to be a `while` whose only exits were "the API said
 * stop" and "enough URLs collected", reading a pagination field the API never
 * sends — so the cursor never advanced, and a first page that came back empty
 * while reporting more never collected a URL either. That loop had no exit, and
 * because the answer is served from the data cache it did not yield to I/O: one
 * request for `/sitemap.xml` held the whole process, and every other request
 * with it, until somebody restarted it.
 *
 * The walk ends when there is nothing further to ask for (`hasMore` false or no
 * cursor), when the API hands back a cursor already asked with (asking again
 * can only return what it returned before), when enough URLs are collected, or
 * at the page ceiling.
 *
 * **An empty page alone does not end it.** The list endpoint applies
 * sales-channel membership and its attribute filters to a page it has already
 * cut, so a page whose rows all belong to another channel is empty, reports
 * more, and carries a cursor that does advance; stopping there would drop
 * every product behind it. The page ceiling is what bounds a run of those.
 *
 * URLs are collected into a set: one product is advertised once, whatever the
 * pages overlap by.
 */
async function productPaths(ctx: Ctx): Promise<string[]> {
  const urls = new Set<string>();
  try {
    const asked = new Set<string>();
    let cursor: string | undefined;
    for (let pages = 0; pages < PRODUCT_PAGE_LIMIT && urls.size < PRODUCT_URL_LIMIT; pages += 1) {
      const page = await listProducts(
        { limit: PRODUCT_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
        ctx,
      );
      for (const product of page.data) urls.add(`/p/${product.slug}`);
      const next = page.pagination.cursor;
      if (!page.pagination.hasMore || !next || asked.has(next)) break;
      asked.add(next);
      cursor = next;
    }
  } catch {
    // Short rather than a 500, and short rather than empty: the pages already
    // walked are real URLs, and a later page failing does not make them less so.
  }
  return [...urls].slice(0, PRODUCT_URL_LIMIT);
}

async function categoryPaths(ctx: Ctx): Promise<string[]> {
  try {
    const tree = await getCategoryTree(ctx);
    const urls: string[] = [];
    const walk = (nodes: readonly { slug: string; children?: unknown }[]): void => {
      for (const node of nodes) {
        urls.push(`/c/${node.slug}`);
        const children = node.children;
        if (Array.isArray(children)) walk(children as { slug: string; children?: unknown }[]);
      }
    };
    walk(tree);
    return urls;
  } catch {
    return [];
  }
}

/**
 * The CMS pages of this channel, at the one address each of them has
 * (`specs/105-cms-root-page-urls/` FR-020; `contracts/cms-page-url.md` §4.1).
 *
 * Entries rather than URLs, unlike the three sources above: a CMS page carries
 * its own `updatedAt`, and a `lastModified` that is the moment of the build
 * tells a crawler nothing it did not already know.
 *
 * **The home-page row is emitted as `/` and never as its slug address.** When
 * an operator selects a page as the home page, that row's one address becomes
 * `/` and `/{slug}` answers a permanent redirect to it (§1.3) — so advertising
 * the slug would put a URL that redirects in the sitemap, which is the one
 * thing §4.1 forbids. `/` is already in `SITEMAP_STATIC_ROUTES`, so the row is
 * *represented* by dropping its slug entry rather than by adding a second `/`.
 */
interface CmsSitemapEntry {
  /** The page's logical path in its primary language (the fallback). */
  readonly path: string;
  readonly lastModified: Date;
  /** R24: every served language's own URL, built by the backend under its prefix (feature 167). */
  readonly alternates: ReadonlyArray<{ readonly language: string; readonly url: string }>;
}

async function cmsPageEntries(ctx: Ctx): Promise<CmsSitemapEntry[]> {
  try {
    const [index, homepage] = await Promise.all([getCmsPageIndex(ctx), getHomepageConfig(ctx)]);
    // A switched-off `cms` answers `null` (Principle XVII), exactly as `blog`
    // does above: the module is absent, so the shop advertises no CMS URL.
    if (index === null) return [];
    const homeSlug = normalizeCmsUrlPath(homepage.cmsPageSlug ?? '');
    // R19D: a page's address is its public path; `?? page.slug` covers a
    // backend that predates the field.
    // R24: a page in several languages is one entry per language URL, each
    // naming the others as alternates; the `path` fallback covers a backend
    // that predates the field.
    return index.pages
      .filter((page) => homeSlug === '' || normalizeCmsUrlPath(page.slug) !== homeSlug)
      .map((page) => ({
        path: `/${normalizeCmsUrlPath(page.path ?? page.slug)}`,
        lastModified: new Date(page.updatedAt),
        alternates: page.alternates ?? [],
      }));
  } catch {
    return [];
  }
}

/**
 * The blog's logical paths: `base` is its index (the operator's prefix, feature 171),
 * `paths` its categories and latest posts. Without an answer the index stays at the
 * storefront's own `/blog` route and nothing else is listed.
 */
async function blogPaths(ctx: Ctx): Promise<{ base: string; paths: string[] }> {
  try {
    const index = await getBlogIndex(ctx);
    // A switched-off `blog` answers `null` (Principle XVII): the module is
    // absent, so the shop advertises no blog URL, which is the correct sitemap
    // rather than a degraded one.
    if (index === null) return { base: '/blog', paths: [] };
    const prefix = index.urlPrefix.replace(/^\/+|\/+$/gu, '');
    const base = prefix.length > 0 ? `/${prefix}` : '/blog';
    return {
      base,
      paths: [
        ...index.topLevelCategories.map((category) => `${base}/${category.slug}`),
        ...index.latestPosts.map((post) => `${base}/${post.slug}`),
      ],
    };
  } catch {
    return { base: '/blog', paths: [] };
  }
}
