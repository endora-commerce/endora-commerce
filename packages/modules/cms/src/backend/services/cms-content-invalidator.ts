import {
  CMS_STOREFRONT_CACHE_TAGS,
  type CmsContentChange,
} from '@endora-commerce/contracts';
import type { CmsCache } from './cms-cache.js';

/**
 * The one seam every CMS content write leaves through.
 *
 * Two caches stand between a saved page and a shopper: this module's Redis
 * read-through cache ({@link CmsCache}), and the storefront's Data Cache in
 * front of it. The write services used to hold the first directly and knew
 * nothing of the second, so a save was visible only once the storefront's own
 * time window ran out — whatever an operator did on the cache screen, which
 * clears Redis namespaces the write had already cleared.
 *
 * So a write now states *what changed* here, once, and this class does both
 * halves in the only order that works: the Redis entries are dropped **before**
 * the change is published. A subscriber answers a published change by asking
 * the storefront to refetch, and a refetch that lands on an entry not yet
 * dropped re-caches the old content for another whole window.
 *
 * Publishing is a callback rather than an `EventBus` so that this file stays a
 * function of its arguments; `backend/index.ts` binds it to the bus. It fires
 * whether or not a Redis connection exists — the storefront's cache does not
 * depend on this process having one. When the callback answers a promise —
 * the bus dispatching the change and its handlers asking the storefront to
 * drop the tags — the write waits for it (R19C, T271), so the request that
 * follows a save or a publish reads the new content, not the previous render.
 *
 * Nothing tracks which page inlines which block or template, so those two take
 * the broad drop rather than none. At the scale a CMS runs at — hundreds of
 * pages, edited by people — the next request rebuilds what it needs.
 */
export type CmsCacheInvalidation = Pick<
  CmsCache,
  | 'invalidatePagesBySlug'
  | 'invalidateBlocksByCode'
  | 'invalidateHooksByCode'
  | 'invalidateAllPages'
  | 'invalidateAllHooks'
  | 'invalidateAll'
>;

export class CmsContentInvalidator {
  constructor(
    private readonly cache: CmsCacheInvalidation | undefined,
    private readonly publish: (change: CmsContentChange) => void | Promise<void>,
  ) {}

  /**
   * A page changed — named by every slug and path it is, or was, served under.
   * `addressesMoved` (R19D) says a nested page's path moved: the resolver
   * writes that path into the links of other pages, so every page goes.
   */
  async pagesChanged(slugs: Iterable<string>, options: { addressesMoved?: boolean } = {}): Promise<void> {
    const named = nonEmpty(slugs);
    if (named.length === 0) return;
    await this.cache?.invalidatePagesBySlug(named);
    if (options.addressesMoved) await this.cache?.invalidateAllPages();
    await this.publish(options.addressesMoved ? { kind: 'page', slugs: named, addressesMoved: true } : { kind: 'page', slugs: named });
  }

  /**
   * A block changed. Its own entries go, and so does everything that inlines a
   * block's tree into an answer of its own: every page (`InsertBlock`) and
   * every hook (its attachments).
   */
  async blocksChanged(codes: Iterable<string>): Promise<void> {
    const named = nonEmpty(codes);
    if (named.length === 0) return;
    if (this.cache) {
      await this.cache.invalidateBlocksByCode(named);
      await this.cache.invalidateAllPages();
      await this.cache.invalidateAllHooks();
    }
    await this.publish({ kind: 'block', codes: named });
  }

  /** A template changed — it reaches the storefront only inlined into a page. */
  async templateChanged(): Promise<void> {
    await this.cache?.invalidateAll();
    await this.publish({ kind: 'template' });
  }

  /**
   * An asset changed that a page, a block or a hook may embed (issue #363).
   * Every resolved answer carries its assets' URLs, and nothing records which
   * answer embeds which asset, so every entry goes — the broad drop a template
   * takes, at the rate operators edit assets.
   */
  async assetsChanged(assetIds: Iterable<string>): Promise<void> {
    const named = nonEmpty(assetIds);
    if (named.length === 0) return;
    await this.cache?.invalidateAll();
    await this.publish({ kind: 'assets', assetIds: named });
  }

  /** A hook, or what is attached to it, changed. */
  async hooksChanged(codes: Iterable<string>): Promise<void> {
    const named = nonEmpty(codes);
    if (named.length === 0) return;
    await this.cache?.invalidateHooksByCode(named);
    await this.publish({ kind: 'hook', codes: named });
  }
}

function nonEmpty(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).filter((value) => value && value.length > 0);
}

/**
 * The storefront Data Cache tags a change makes stale — the names the
 * storefront's CMS readers tag their fetches with
 * (`storefront/lib/api/cms.ts`), from the vocabulary both sides import.
 *
 * A page names its own slugs and the page index, which lists it. A block names
 * itself and the two broad tags of what may inline it. A template names every
 * page and nothing else: no reader fetches a template by code. An asset names
 * every page, block and hook read, because each may embed it.
 */
export function storefrontTagsFor(change: CmsContentChange): string[] {
  switch (change.kind) {
    case 'page':
      return [
        ...change.slugs.map((slug) => CMS_STOREFRONT_CACHE_TAGS.page(slug)),
        CMS_STOREFRONT_CACHE_TAGS.pageIndex,
        ...(change.addressesMoved ? [CMS_STOREFRONT_CACHE_TAGS.pages] : []),
      ];
    case 'block':
      return [
        ...change.codes.map((code) => CMS_STOREFRONT_CACHE_TAGS.block(code)),
        CMS_STOREFRONT_CACHE_TAGS.pages,
        CMS_STOREFRONT_CACHE_TAGS.hooks,
      ];
    case 'template':
      return [CMS_STOREFRONT_CACHE_TAGS.pages];
    case 'hook':
      return change.codes.map((code) => CMS_STOREFRONT_CACHE_TAGS.hook(code));
    case 'assets':
      return [
        CMS_STOREFRONT_CACHE_TAGS.pages,
        CMS_STOREFRONT_CACHE_TAGS.blocks,
        CMS_STOREFRONT_CACHE_TAGS.hooks,
      ];
  }
}
