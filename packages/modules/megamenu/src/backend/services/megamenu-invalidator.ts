import type { MegamenuCache } from './megamenu-cache.js';

/** The two drops a megamenu write asks for — `MegamenuCache`'s own spelling. */
export type MegamenuCacheInvalidation = Pick<MegamenuCache, 'invalidateAll' | 'invalidateScope'>;

/**
 * What the write services hold in place of the cache.
 *
 * A resolved menu is cached twice: in this module's Redis read-through cache,
 * and in the storefront's Data Cache in front of it. The services used to hold
 * the first and knew nothing of the second, so an edited menu reached a shopper
 * only when the storefront's 60 s window ran out. This wraps the same two
 * methods the services already call and adds the notice, **after** the Redis
 * drop: the notice makes the storefront refetch, and a refetch that lands on an
 * entry not yet dropped re-caches the old menu for another window.
 *
 * It exists whether or not there is a Redis connection — the storefront's
 * cache does not depend on this process having one.
 *
 * `invalidateScope` still notifies for the whole menu tag. The storefront tags
 * every channel's menu with one name, and a tag only selects which entries to
 * drop: the others are refetched unchanged.
 */
export class MegamenuInvalidator implements MegamenuCacheInvalidation {
  constructor(
    private readonly cache: MegamenuCacheInvalidation | undefined,
    private readonly onInvalidated: () => void,
  ) {}

  async invalidateAll(): Promise<void> {
    await this.cache?.invalidateAll();
    this.onInvalidated();
  }

  async invalidateScope(channelCode: string, language: string): Promise<void> {
    await this.cache?.invalidateScope(channelCode, language);
    this.onInvalidated();
  }
}
