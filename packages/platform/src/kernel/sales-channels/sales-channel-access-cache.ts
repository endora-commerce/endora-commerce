import type { Redis } from 'ioredis';
import { SharedDropMarks } from '../cache/shared-drop-marks.js';
import { subscribeWhenReady } from '../cache/subscribe-when-ready.js';
import type { InProcessCacheLayer } from '../cache/in-process-cache-registry.js';

/**
 * SalesChannelAccessCache — `specs/154-sales-channel-access/` research R-6,
 * `contracts/channel-access-rule.md` §5.
 *
 * The channels an Organization's members may use, read by the kernel's access
 * step on **every** customer request. Without a cache that is one bridge query
 * per request (FR-035), so it has the two-layer shape `SalesChannelsCache` has
 * and carries the same three obligations, for the same reasons:
 *
 *   1. Per-process LRU (cap {@link LRU_MAX}, entries older than
 *      {@link SALES_CHANNEL_ACCESS_LRU_TTL_MS} ignored).
 *   2. Redis (`sales-channel-access:v1:org:<organizationId>`, a JSON array of
 *      channel ids, TTL {@link TTL_SECONDS}).
 *   3. PostgreSQL through the loader the composition hands in — the membership
 *      service's bridge read, so this file names no module's table.
 *
 * Invalidation is part of the **write** (D-93): the membership service awaits
 * {@link SalesChannelAccessCacheInvalidation.invalidateAfterWrite} after every
 * committed mutation of an Organization's channels, before it emits. The drop
 * takes the shared layer first with the prefix marked for the whole operation,
 * then the local layer, then announces `{ organizationId }` on
 * {@link SALES_CHANNEL_ACCESS_CHANGED_CHANNEL} so every other composed process
 * drops its local entry. A lost subscription degrades to the LRU window —
 * *stale for at most that long*, never *open*: a refused customer stays refused
 * no longer than an admitted one stays admitted.
 *
 * The in-process `sales_channels.membership_changed` event is deliberately not
 * the mechanism: it is dispatched after the write and in-process only.
 */

export const SALES_CHANNEL_ACCESS_CACHE_KEY_PREFIX = 'sales-channel-access:v1:org:';
export const SALES_CHANNEL_ACCESS_CACHE_NAMESPACE = 'sales_channel_access';
/** Pub/sub channel announcing a committed change of an Organization's channels. */
export const SALES_CHANNEL_ACCESS_CHANGED_CHANNEL = 'b2b:sales-channel-access:changed';
/** Maximum age of an entry in the per-process layer — the cross-process bound of FR-036. */
export const SALES_CHANNEL_ACCESS_LRU_TTL_MS = 30_000;

const KEY_PREFIX = SALES_CHANNEL_ACCESS_CACHE_KEY_PREFIX;
const TTL_SECONDS = 5 * 60;
const LRU_MAX = 4096;
const EVERY_ORGANIZATION = '*';

/** Reads an Organization's assigned channel ids from the source of truth. */
export type PermittedChannelIdsLoader = (organizationId: string) => Promise<readonly string[]>;

interface LruEntry {
  readonly value: ReadonlySet<string>;
  readonly storedAt: number;
}

/**
 * The invalidating half, as the write seam sees it. Narrow on purpose, as
 * `SalesChannelsCacheInvalidation` is: a writer that can only invalidate cannot
 * seed the cache from the write path.
 */
export interface SalesChannelAccessCacheInvalidation {
  /**
   * Drop one Organization's permitted set, on behalf of a write that has
   * **already committed**, and announce it to every other process. Returns the
   * number of shared keys deleted, or `null` when Redis could not be reached —
   * in which case reads in this process bypass the cache until a later drop
   * succeeds, so a Redis blip never fails the operator's request.
   */
  invalidateAfterWrite(organizationId: string): Promise<number | null>;
  /** The same for a change that can move every Organization's set (a channel delete). */
  invalidateAllAfterWrite(): Promise<number | null>;
}

export class SalesChannelAccessCache
  implements SalesChannelAccessCacheInvalidation, InProcessCacheLayer
{
  private readonly lru = new Map<string, LruEntry>();
  private readonly marks = new SharedDropMarks();
  private watching = false;

  constructor(
    private readonly redis: Redis,
    private readonly load: PermittedChannelIdsLoader,
    /** Injectable so a test can move the LRU window without a real clock. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  private static keyOf(organizationId: string): string {
    return `${KEY_PREFIX}${organizationId}`;
  }

  /** The channel ids `organizationId` may use; an empty set when it has none. */
  async permittedChannelIds(organizationId: string): Promise<ReadonlySet<string>> {
    const key = SalesChannelAccessCache.keyOf(organizationId);
    if (await this.isBypassed(key)) {
      return new Set(await this.load(organizationId));
    }

    const entry = this.lru.get(key);
    if (entry !== undefined) {
      if (this.now() - entry.storedAt < SALES_CHANNEL_ACCESS_LRU_TTL_MS) {
        this.lru.delete(key);
        this.lru.set(key, entry);
        return entry.value;
      }
      this.lru.delete(key);
    }

    let raw: string | null = null;
    try {
      raw = await this.redis.get(key);
    } catch {
      // The shared layer is an optimisation over an authority that is still
      // reachable; an unreachable Redis costs a read, never a decision.
      return new Set(await this.load(organizationId));
    }
    if (raw !== null) {
      const decoded = decodeIds(raw);
      if (decoded !== null) {
        const value = new Set(decoded);
        this.touchLru(key, value);
        return value;
      }
    }

    const ids = await this.load(organizationId);
    const value = new Set(ids);
    // A read that started before a change loaded the pre-change set; caching it
    // now would undo the invalidation in flight.
    if (await this.isBypassed(key)) return value;
    this.touchLru(key, value);
    try {
      await this.redis.set(key, JSON.stringify([...value]), 'EX', TTL_SECONDS);
    } catch {
      // Same as the read: the local layer still bounds the next lookups.
    }
    return value;
  }

  /** Drop one Organization's entry across both layers and announce it. */
  async invalidate(organizationId: string): Promise<number> {
    const deleted = await this.drop(SalesChannelAccessCache.keyOf(organizationId), true);
    await this.announce(organizationId);
    return deleted;
  }

  /**
   * Drop every Organization's entry across both layers and announce `'*'`. Also
   * the operator-facing clear's entry point ({@link InProcessCacheLayer}).
   */
  async invalidateAll(): Promise<number> {
    const deleted = await this.drop(KEY_PREFIX, false);
    await this.announce(EVERY_ORGANIZATION);
    return deleted;
  }

  /** {@inheritDoc SalesChannelAccessCacheInvalidation.invalidateAfterWrite} */
  async invalidateAfterWrite(organizationId: string): Promise<number | null> {
    return this.afterWrite(() => this.invalidate(organizationId));
  }

  /** {@inheritDoc SalesChannelAccessCacheInvalidation.invalidateAllAfterWrite} */
  async invalidateAllAfterWrite(): Promise<number | null> {
    return this.afterWrite(() => this.invalidateAll());
  }

  /**
   * Subscribe to the cross-process announcement on `subscriber` — a connection
   * in subscriber mode, shared with the module-state channel in production.
   * Idempotent, and never fatal: a failing subscribe leaves this process on the
   * LRU window, which is the bound the design accepts for a lost subscription.
   * ioredis re-subscribes on reconnect by itself.
   */
  async watch(subscriber: Redis): Promise<void> {
    if (this.watching) return;
    this.watching = true;
    subscriber.on('message', (channel: string, message: string) => {
      if (channel !== SALES_CHANNEL_ACCESS_CHANGED_CHANNEL) return;
      this.dropLocalFor(message);
    });
    try {
      // Issue #1096 — never SUBSCRIBE mid-handshake.
      await subscribeWhenReady(subscriber, SALES_CHANNEL_ACCESS_CHANGED_CHANNEL);
    } catch (err) {
      console.warn(
        `[sales-channel-access] could not subscribe to ${SALES_CHANNEL_ACCESS_CHANGED_CHANNEL} — ` +
          `assignment changes made by other processes take effect within ` +
          `${SALES_CHANNEL_ACCESS_LRU_TTL_MS} ms: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Apply one announcement: drop the named Organization's local entry, or every one. */
  private dropLocalFor(message: string): void {
    let organizationId: unknown;
    try {
      organizationId = (JSON.parse(message) as { organizationId?: unknown }).organizationId;
    } catch {
      return;
    }
    if (organizationId === EVERY_ORGANIZATION) {
      this.dropLocal(KEY_PREFIX);
    } else if (typeof organizationId === 'string' && organizationId !== '') {
      this.lru.delete(SalesChannelAccessCache.keyOf(organizationId));
    }
  }

  private async announce(organizationId: string): Promise<void> {
    try {
      await this.redis.publish(
        SALES_CHANNEL_ACCESS_CHANGED_CHANNEL,
        JSON.stringify({ organizationId }),
      );
    } catch {
      // The other processes converge within the LRU window; the write stands.
    }
  }

  private async afterWrite(drop: () => Promise<number>): Promise<number | null> {
    try {
      return await drop();
    } catch {
      return null;
    }
  }

  private async drop(prefix: string, exact: boolean): Promise<number> {
    this.marks.begin(prefix);
    try {
      const deleted = exact ? await this.redis.del(prefix) : await this.dropShared(prefix);
      this.marks.retireFailedUnder(prefix);
      return deleted;
    } catch (err) {
      this.marks.markFailed(prefix);
      throw err;
    } finally {
      this.dropLocal(prefix);
      this.marks.finish(prefix);
    }
  }

  private async dropShared(prefix: string): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) deleted += await this.redis.del(...keys);
    } while (cursor !== '0');
    return deleted;
  }

  private dropLocal(prefix: string): void {
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  private async isBypassed(key: string): Promise<boolean> {
    if (this.marks.isClean) return false;
    if (this.marks.isDraining(key)) return true;
    const failed = this.marks.failedPrefixFor(key);
    if (failed === undefined) return false;
    try {
      await this.drop(failed, failed !== KEY_PREFIX);
    } catch {
      // Still unreachable — stay off the cache and read through to PostgreSQL.
    }
    return true;
  }

  private touchLru(key: string, value: ReadonlySet<string>): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, { value, storedAt: this.now() });
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }
}

function decodeIds(raw: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) return parsed;
  } catch {
    // fall through to a miss
  }
  return null;
}
