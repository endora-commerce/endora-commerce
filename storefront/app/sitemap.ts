import type { MetadataRoute } from 'next';

import { getBlogIndex } from '../lib/api/blog';
import { getCategoryTree, listProducts } from '../lib/api/catalog';
import { getServerContext } from '../lib/server-context';
import { absoluteUrl } from '../lib/seo/site-url';

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
  try {
    ({ ctx } = await getServerContext());
  } catch {
    return entries;
  }

  for (const url of await productUrls(ctx)) entries.push({ url, lastModified: now, priority: 0.8 });
  for (const url of await categoryUrls(ctx)) entries.push({ url, lastModified: now, priority: 0.6 });
  for (const url of await blogUrls(ctx)) entries.push({ url, lastModified: now, priority: 0.5 });

  return entries;
}

async function productUrls(ctx: Ctx): Promise<string[]> {
  try {
    const urls: string[] = [];
    let cursor: string | undefined;
    while (urls.length < PRODUCT_URL_LIMIT) {
      const page = await listProducts({ limit: 100, ...(cursor ? { cursor } : {}) }, ctx);
      for (const product of page.data) urls.push(absoluteUrl(`/p/${product.slug}`));
      if (!page.pagination.hasMore || page.pagination.nextCursor === null) break;
      cursor = page.pagination.nextCursor;
    }
    return urls.slice(0, PRODUCT_URL_LIMIT);
  } catch {
    return [];
  }
}

async function categoryUrls(ctx: Ctx): Promise<string[]> {
  try {
    const tree = await getCategoryTree(ctx);
    const urls: string[] = [];
    const walk = (nodes: readonly { slug: string; children?: unknown }[]): void => {
      for (const node of nodes) {
        urls.push(absoluteUrl(`/c/${node.slug}`));
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

async function blogUrls(ctx: Ctx): Promise<string[]> {
  try {
    const index = await getBlogIndex(ctx);
    // A switched-off `blog` answers `null` (Principle XVII): the module is
    // absent, so the shop advertises no blog URL, which is the correct sitemap
    // rather than a degraded one.
    if (index === null) return [];
    const prefix = index.urlPrefix.replace(/^\/+|\/+$/gu, '');
    const base = prefix.length > 0 ? `/${prefix}` : '/blog';
    return [
      ...index.topLevelCategories.map((category) => absoluteUrl(`${base}/${category.slug}`)),
      ...index.latestPosts.map((post) => absoluteUrl(`${base}/${post.slug}`)),
    ];
  } catch {
    return [];
  }
}
