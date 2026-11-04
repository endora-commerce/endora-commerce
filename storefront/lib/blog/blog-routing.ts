import type { BlogRouting } from '@endora-commerce/contracts';
import {
  PROCESS_READER_DEPS,
  createChannelCache,
  type CrawlerPolicyReaderDeps,
  type CrawlerRead,
} from '../seo/crawler-policy';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/contracts/routing-and-settings.md` §2) —
 * where the blog lives on this storefront. The route is the fixed directory
 * `app/blog`; the operator sets the public prefix per channel and language, and the
 * middleware maps one onto the other. The answer is read per channel through the same
 * per-process cache the channel identity uses, and never rejects: an unreadable,
 * disabled or switched-off blog reads as `none`, and the middleware then leaves every
 * path alone.
 */

/** The backend route the blog routing is read from. */
export const BLOG_ROUTING_PATH = '/api/v1/blog/routing';

/** The storefront's own blog route — and the prefix that needs no mapping. */
export const BLOG_ROUTE_SEGMENT = 'blog';

const PREFIX = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/** The routing in a `200` body, or `null`. Malformed entries are dropped, never trusted. */
export function parseBlogRouting(body: unknown): BlogRouting | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const { defaultPrefix, prefixes, formerPrefixes } = data as Record<string, unknown>;
  if (typeof defaultPrefix !== 'string' || !PREFIX.test(defaultPrefix)) return null;
  const byLanguage: Record<string, string> = {};
  if (typeof prefixes === 'object' && prefixes !== null && !Array.isArray(prefixes)) {
    for (const [language, prefix] of Object.entries(prefixes)) {
      if (typeof prefix === 'string' && PREFIX.test(prefix)) byLanguage[language] = prefix;
    }
  }
  const former: BlogRouting['formerPrefixes'] = [];
  if (Array.isArray(formerPrefixes)) {
    for (const entry of formerPrefixes) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { languageCode, prefix } = entry as Record<string, unknown>;
      if (typeof prefix !== 'string' || !PREFIX.test(prefix)) continue;
      if (languageCode !== null && typeof languageCode !== 'string') continue;
      former.push({ languageCode, prefix });
    }
  }
  return { defaultPrefix, prefixes: byLanguage, formerPrefixes: former };
}

export interface BlogRoutingReader {
  read(channelCode: string | undefined): Promise<CrawlerRead<BlogRouting>>;
}

export function createBlogRoutingReader(deps: CrawlerPolicyReaderDeps): BlogRoutingReader {
  const cache = createChannelCache<BlogRouting>(deps, { path: BLOG_ROUTING_PATH, parse: parseBlogRouting });
  return { read: (channelCode) => cache.read(channelCode) };
}

const reader = createBlogRoutingReader(PROCESS_READER_DEPS);

/** This process's blog routing for `channelCode`, or `null` when there is none to apply. */
export async function readBlogRouting(channelCode: string | undefined): Promise<BlogRouting | null> {
  const read = await reader.read(channelCode);
  return read.kind === 'value' ? read.value : null;
}

/** What the middleware does with a logical (language-less) path. */
export type BlogRouteDecision =
  | { readonly kind: 'rewrite'; readonly path: string }
  | { readonly kind: 'redirect'; readonly path: string };

/**
 * The blog's answer for a logical path in a language (`null` = the channel default):
 *
 * - the current prefix of the language → rewrite to the `app/blog` route;
 * - `blog`, another language's prefix or the channel default while the language's
 *   prefix is another → redirect to that prefix;
 * - a former prefix of the language or of the channel default → redirect;
 * - anything else → `null`, the path is not the blog's.
 *
 * The returned paths are logical: the caller adds the language prefix and the query.
 */
export function blogRouteDecision(
  logicalPath: string,
  routing: BlogRouting | null,
  languageCode: string | null,
): BlogRouteDecision | null {
  if (routing === null) return null;
  const current = (languageCode !== null ? routing.prefixes[languageCode] : undefined) ?? routing.defaultPrefix;
  const match = /^\/([^/]+)(\/.*)?$/.exec(logicalPath);
  if (match === null) return null;
  const first = match[1]!;
  const rest = match[2] ?? '';
  if (first === current) {
    return current === BLOG_ROUTE_SEGMENT ? null : { kind: 'rewrite', path: `/${BLOG_ROUTE_SEGMENT}${rest}` };
  }
  // Another language's prefix, the channel default or a former prefix: the visitor
  // asked for the blog, in this language, at an address it no longer has here.
  const otherCurrent = first === routing.defaultPrefix || Object.values(routing.prefixes).includes(first);
  const formerHere = routing.formerPrefixes.some(
    (former) => former.prefix === first && (former.languageCode === null || former.languageCode === languageCode),
  );
  if (first === BLOG_ROUTE_SEGMENT || otherCurrent || formerHere) return { kind: 'redirect', path: `/${current}${rest}` };
  return null;
}
