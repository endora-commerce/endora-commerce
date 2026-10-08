import { describe, expect, it } from 'vitest';
import {
  CMS_STOREFRONT_CACHE_TAGS,
  type CmsContentChange,
} from '@endora-commerce/contracts';
import {
  CmsContentInvalidator,
  storefrontTagsFor,
  type CmsCacheInvalidation,
} from './cms-content-invalidator.js';

/**
 * The one seam every CMS content write leaves through.
 *
 * Two layers sit between a saved page and a shopper: this module's Redis
 * read-through cache, and the storefront's Data Cache in front of it. The
 * write services used to drop the first and never mention the second, so a
 * save showed up only when the storefront's time window ran out. These tests
 * hold the two properties that close that:
 *
 *  - **order** — the Redis entries go before the change is published. A
 *    subscriber answers by asking the storefront to refetch, and a refetch
 *    that lands on a Redis entry not yet dropped re-caches the old content
 *    for another whole window;
 *  - **reach** — a change names everything that may *embed* it. Nothing tracks
 *    which page inlines which block, so a block or a template takes the broad
 *    tag rather than none.
 */

function recorder(): {
  log: string[];
  cache: CmsCacheInvalidation;
  publish: (change: CmsContentChange) => void;
  published: CmsContentChange[];
} {
  const log: string[] = [];
  const published: CmsContentChange[] = [];
  const cache: CmsCacheInvalidation = {
    invalidatePagesBySlug: async (slugs) => {
      log.push(`redis:pages:${Array.from(slugs).join(',')}`);
    },
    invalidateBlocksByCode: async (codes) => {
      log.push(`redis:blocks:${Array.from(codes).join(',')}`);
    },
    invalidateHooksByCode: async (codes) => {
      log.push(`redis:hooks:${Array.from(codes).join(',')}`);
    },
    invalidateAllPages: async () => {
      log.push('redis:all-pages');
    },
    invalidateAllHooks: async () => {
      log.push('redis:all-hooks');
    },
    invalidateAll: async () => {
      log.push('redis:all');
    },
  };
  return {
    log,
    cache,
    published,
    publish: (change) => {
      log.push(`publish:${change.kind}`);
      published.push(change);
    },
  };
}

describe('CmsContentInvalidator', () => {
  it('drops a page by slug, then publishes the change', async () => {
    const r = recorder();
    await new CmsContentInvalidator(r.cache, r.publish).pagesChanged(['about', 'about-us']);

    expect(r.log).toEqual(['redis:pages:about,about-us', 'publish:page']);
    expect(r.published).toEqual([{ kind: 'page', slugs: ['about', 'about-us'] }]);
  });

  it('says nothing when a page write names no slug', async () => {
    const r = recorder();
    await new CmsContentInvalidator(r.cache, r.publish).pagesChanged(['', '']);

    expect(r.log).toEqual([]);
  });

  it('drops a block, every page and every hook that may inline it, then publishes', async () => {
    const r = recorder();
    await new CmsContentInvalidator(r.cache, r.publish).blocksChanged(['hero']);

    // The hook entries are the half that was missing: a hook answer inlines the
    // content of every block attached to it, so a block save used to leave the
    // hook serving the old tree until its five-minute key expired.
    expect(r.log).toEqual([
      'redis:blocks:hero',
      'redis:all-pages',
      'redis:all-hooks',
      'publish:block',
    ]);
    expect(r.published).toEqual([{ kind: 'block', codes: ['hero'] }]);
  });

  it('drops everything for a template, then publishes', async () => {
    const r = recorder();
    await new CmsContentInvalidator(r.cache, r.publish).templateChanged();

    expect(r.log).toEqual(['redis:all', 'publish:template']);
  });

  it('drops a hook by code, then publishes', async () => {
    const r = recorder();
    await new CmsContentInvalidator(r.cache, r.publish).hooksChanged(['home.top']);

    expect(r.log).toEqual(['redis:hooks:home.top', 'publish:hook']);
    expect(r.published).toEqual([{ kind: 'hook', codes: ['home.top'] }]);
  });

  it('still publishes in a composition with no Redis', async () => {
    // The storefront's Data Cache exists whether or not this process has a
    // Redis connection, so the absent cache must not take the notice with it.
    const r = recorder();
    await new CmsContentInvalidator(undefined, r.publish).blocksChanged(['hero']);

    expect(r.log).toEqual(['publish:block']);
  });
});

describe('storefrontTagsFor', () => {
  it('names each slug of a page and the page index', () => {
    expect(storefrontTagsFor({ kind: 'page', slugs: ['about', 'o-nas'] })).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.page('about'),
      CMS_STOREFRONT_CACHE_TAGS.page('o-nas'),
      CMS_STOREFRONT_CACHE_TAGS.pageIndex,
    ]);
  });

  it('names the block, and every page and hook, for a block', () => {
    expect(storefrontTagsFor({ kind: 'block', codes: ['hero'] })).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.block('hero'),
      CMS_STOREFRONT_CACHE_TAGS.pages,
      CMS_STOREFRONT_CACHE_TAGS.hooks,
    ]);
  });

  it('names every page for a template', () => {
    expect(storefrontTagsFor({ kind: 'template' })).toEqual([CMS_STOREFRONT_CACHE_TAGS.pages]);
  });

  it('names the hook for a hook', () => {
    expect(storefrontTagsFor({ kind: 'hook', codes: ['home.top'] })).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.hook('home.top'),
    ]);
  });
});
