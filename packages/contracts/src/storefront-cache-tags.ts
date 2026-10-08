/**
 * The cache-tag vocabulary the backend and the storefront share for content an
 * operator edits in the Admin UI.
 *
 * The storefront keeps CMS and megamenu reads in Next's Data Cache
 * (`fetch(…, { next: { revalidate, tags } })`); the backend asks the
 * storefront's `/api/revalidate` endpoint to drop entries **by tag** when the
 * content behind them changes. That only works while both sides spell a tag
 * identically, and a tag that drifts fails silently — the revalidation request
 * still answers 200 and the stale entry simply stays. So the strings live
 * here, once, and each side imports them: the storefront to tag a fetch, the
 * owning module to say what a write made stale.
 *
 * A tag is deliberately **not** sales-channel-scoped. The Data Cache keys an
 * entry on the request (URL plus the `X-Sales-Channel` / `Accept-Language`
 * headers), so channels never share an entry; a tag only selects which entries
 * to drop. Dropping one slug's entries on every channel over-invalidates by a
 * handful of entries and can never serve one channel's content on another.
 */
export const CMS_STOREFRONT_CACHE_TAGS = {
  /** Every page-by-slug read — dropped when something a page may embed changes. */
  pages: 'cms:page',
  /** One page's reads, on every channel and language it is served under. */
  page: (slug: string): string => `cms:page:${slug}`,
  /** The published-page index the sitemap is built from. */
  pageIndex: 'cms:page-index',
  /** Every block-by-code read. */
  blocks: 'cms:block',
  /** One block's reads. */
  block: (code: string): string => `cms:block:${code}`,
  /** Every hook-by-code read — a hook answer inlines the blocks attached to it. */
  hooks: 'cms:hook',
  /** One hook's reads. */
  hook: (code: string): string => `cms:hook:${code}`,
} as const;

/** The resolved megamenu of a channel and language — it inlines CMS blocks. */
export const MEGAMENU_STOREFRONT_CACHE_TAG = 'megamenu';

/**
 * The event `cms` publishes on the in-process EventBus after a content write
 * has committed and its own read-through cache has been dropped.
 *
 * It exists for whoever **embeds** CMS content in an answer of their own and
 * caches that answer — `megamenu` inlines a block's tree into a menu payload —
 * because such a cache cannot otherwise learn that the embedded content moved.
 */
export const CMS_CONTENT_CHANGED_EVENT = 'cms.content_changed.v1';

/**
 * What changed, in the terms a storefront read is addressed by: a page by its
 * slugs (its own and every channel's), a block or a hook by its code. A
 * template carries no key because nothing reads one by code — it only ever
 * reaches the storefront inlined into a page.
 */
export type CmsContentChange =
  | { readonly kind: 'page'; readonly slugs: readonly string[] }
  | { readonly kind: 'block'; readonly codes: readonly string[] }
  | { readonly kind: 'template' }
  | { readonly kind: 'hook'; readonly codes: readonly string[] };
