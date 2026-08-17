import type Redis from 'ioredis';
import { SharedDropMarks } from '../cache/shared-drop-marks.js';

/**
 * Read-through cache for `SettingsService.get` — feature 004 / US3 (T050).
 *
 * Two layers, in this order on read:
 *   1. Per-process LRU (cheap; absorbs intra-request bursts).
 *   2. Redis (`settings:v1:<code>:<channelId>`, TTL 1h; survives restarts).
 *
 * Invalidation goes the other way: write → drop in Redis → drop in LRU. The
 * write seam calls {@link SettingsCacheInvalidation} itself and awaits it
 * (issue #45); until then the drop rode an EventBus notification, which made it
 * a function of *which handler the bus reached first*.
 *
 * Dropping the shared layer first is deliberate: it is the layer that outlives
 * this process and would otherwise be re-pulled into every other process's
 * LRU. Dropping it is also the step that can fail (network, closed
 * connection), and a half-done invalidation must degrade to "slower but
 * correct", never to "fast and wrong". {@link SharedDropMarks} holds the two
 * guards that enforce it.
 *
 * **The local layer expires.** The EventBus is in-process (`events/bus.ts`),
 * so a second API instance learns about a write only through the shared layer:
 * invalidation is, across processes, a broadcast that can be missed. Redis
 * expires its entries after an hour; without {@link SETTINGS_LRU_TTL_MS} the
 * LRU expired nothing and was bounded only by its capacity, so a process that
 * missed a notification served the pre-write value indefinitely — the one case
 * the operator's "clear cache" button cannot fix, because clearing rides the
 * same in-process path that already failed. The window is on the value's age,
 * never refreshed by a read: a setting read on every request is exactly the
 * entry a sliding window would pin forever.
 *
 * Stored values are JSON-serialised so structured types (objects, arrays)
 * survive the Redis hop. The `null` sentinel is never stored — absence of a
 * key means "cache miss"; falsy values like `false`, `0`, `""` are valid.
 */

/** Shared with the operator-facing cache-clear surface, so the two cannot drift. */
export const SETTINGS_CACHE_KEY_PREFIX = 'settings:v1:';
export const SETTINGS_CACHE_NAMESPACE = 'settings';

/**
 * Maximum age of an entry in the per-process layer.
 *
 * 30 s is chosen from both ends. The layer exists to remove the Redis hop from
 * a path read several times per request, and a request burst — a page load, a
 * checkout step, a worker's batch — lives well inside 30 s, so the hit rate
 * that justifies the layer is untouched; a 5 s window (what `custom_fields`
 * uses for a far colder key space) would put a Redis round trip back on the
 * hot path many times a second. At the other end, 30 s is a bound an operator
 * experiences as "reload the page and it is right" rather than as a defect,
 * and it is two orders of magnitude below the hour Redis keeps its own copy —
 * which is what makes the self-healing real rather than theoretical.
 */
export const SETTINGS_LRU_TTL_MS = 30_000;

const KEY_PREFIX = SETTINGS_CACHE_KEY_PREFIX;

/**
 * The channel segment of a **platform-wide** read's key (feature 072, D-41).
 * A uuid can never spell it, so it cannot collide with a real channel; using
 * the nil UUID here would have re-introduced the ambiguity the null read exists
 * to remove. `invalidate(code)` drops by the `<prefix><code>:` prefix, so this
 * segment needs no invalidator of its own.
 */
const GLOBAL_KEY_SEGMENT = '__global__';

const TTL_SECONDS = 60 * 60;
const LRU_MAX = 1024;
const NOT_REGISTERED = '__settings_not_registered__';

interface LruEntry {
  readonly value: unknown;
  /** When the value was read from the shared layer or written here. */
  readonly storedAt: number;
}

/**
 * The invalidating half of the cache, as the **write seam** sees it (issue #45).
 *
 * `SettingsAdminService` — the one place a setting value or group changes —
 * takes this and awaits it before it emits `settings.value_changed`. That is
 * what makes the drop a property of the write instead of a property of the
 * dispatch order: a caller that writes and reads back in the same tick, in the
 * same `EventBus.run` scope, or with any number of module subscribers on the
 * bus, cannot observe the pre-write value.
 *
 * Narrow on purpose. The reader (`SettingsService`) holds the whole
 * {@link SettingsCache}; the writer needs only these two, and a module that can
 * only invalidate cannot accidentally seed the cache from the write path.
 */
export interface SettingsCacheInvalidation {
  /**
   * Drop every cached entry for one setting code, across every channel, on
   * behalf of a write that has **already committed**.
   *
   * Returns the number of shared keys deleted, or `null` when the shared layer
   * could not be reached. The degrade lives here rather than in a `catch` at
   * the call site, and it is in the return type on purpose: the row is written
   * and audited, so a Redis blip must not fail the operator's request or make
   * them retry a write that succeeded. Correctness does not rest on the number
   * — {@link SharedDropMarks} has marked the prefix failed, so this process
   * bypasses both layers for those keys and retries the drop on the next read.
   */
  invalidateAfterWrite(code: string): Promise<number | null>;
  /**
   * The same contract for a group change, which can move settings between
   * groups or rescope channels and so can change resolution for any number of
   * codes.
   */
  invalidateAllAfterWrite(): Promise<number | null>;
}

export class SettingsCache implements SettingsCacheInvalidation {
  private readonly lru = new Map<string, LruEntry>();
  private readonly marks = new SharedDropMarks();

  constructor(
    private readonly redis: Redis,
    /** Injectable so a test can advance the TTL window without a real clock. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  private static composeKey(code: string, channelId: string | null): string {
    return `${KEY_PREFIX}${code}:${channelId ?? GLOBAL_KEY_SEGMENT}`;
  }

  /**
   * Returns:
   *   - { hit: true; value: unknown } when the value (or "not registered" sentinel) is cached
   *   - { hit: false } when the caller must fall through to Postgres
   * The "not registered" sentinel is encoded as `{ __settings_not_registered__: true }`.
   */
  async get(
    code: string,
    channelId: string | null,
  ): Promise<{ hit: false } | { hit: true; value: unknown; notRegistered?: boolean }> {
    const key = SettingsCache.composeKey(code, channelId);
    if (await this.isBypassed(key)) return { hit: false };

    const entry = this.lru.get(key);
    if (entry !== undefined) {
      if (this.now() - entry.storedAt < SETTINGS_LRU_TTL_MS) {
        // Touch the LRU for eviction order — but not `storedAt`: the bound is
        // on the value's age, and a hot key must still age out.
        this.lru.delete(key);
        this.lru.set(key, entry);
        if (this.isNotRegisteredSentinel(entry.value)) {
          return { hit: true, value: undefined, notRegistered: true };
        }
        return { hit: true, value: entry.value };
      }
      this.lru.delete(key);
    }

    const raw = await this.redis.get(key);
    if (raw === null) return { hit: false };

    const decoded = JSON.parse(raw) as unknown;
    this.touchLru(key, decoded);
    if (this.isNotRegisteredSentinel(decoded)) {
      return { hit: true, value: undefined, notRegistered: true };
    }
    return { hit: true, value: decoded };
  }

  async set(code: string, channelId: string | null, value: unknown): Promise<void> {
    const key = SettingsCache.composeKey(code, channelId);
    // A read that started before the write resolved the pre-invalidation value
    // from Postgres. Caching it now would undo the invalidation in flight.
    if (await this.isBypassed(key)) return;
    this.touchLru(key, value);
    await this.redis.set(key, JSON.stringify(value), 'EX', TTL_SECONDS);
  }

  /** Cache the "not registered" outcome so repeated typos don't hammer Postgres. */
  async setNotRegistered(code: string, channelId: string | null): Promise<void> {
    const key = SettingsCache.composeKey(code, channelId);
    if (await this.isBypassed(key)) return;
    const sentinel = { [NOT_REGISTERED]: true };
    this.touchLru(key, sentinel);
    await this.redis.set(key, JSON.stringify(sentinel), 'EX', TTL_SECONDS);
  }

  /**
   * Drop every cached entry for a given setting code (across every channel).
   * Returns how many shared keys were deleted.
   */
  async invalidate(code: string): Promise<number> {
    return this.drop(`${KEY_PREFIX}${code}:`, 200);
  }

  /**
   * Used after group-level changes that may affect many codes, and by the
   * operator-facing cache clear. Returns how many shared keys were deleted.
   */
  async invalidateAll(): Promise<number> {
    return this.drop(KEY_PREFIX, 500);
  }

  /** {@inheritDoc SettingsCacheInvalidation.invalidateAfterWrite} */
  async invalidateAfterWrite(code: string): Promise<number | null> {
    return this.afterWrite(() => this.invalidate(code));
  }

  /** {@inheritDoc SettingsCacheInvalidation.invalidateAllAfterWrite} */
  async invalidateAllAfterWrite(): Promise<number | null> {
    return this.afterWrite(() => this.invalidateAll());
  }

  /**
   * The one place the write seam's tolerance is written down.
   *
   * `drop` has already marked the prefix failed by the time it re-throws, so
   * every read in this process bypasses both layers for those keys and retries
   * the drop until Redis answers — the invariant is intact and the answer is
   * "slower but correct". What is left of the throw is a report, and a report
   * must not undo the write that produced it.
   */
  private async afterWrite(drop: () => Promise<number>): Promise<number | null> {
    try {
      return await drop();
    } catch {
      return null;
    }
  }

  /**
   * Drop both layers for a key prefix, shared layer first. The prefix is
   * marked for the whole operation so concurrent reads and writes cannot
   * observe or restore the pre-invalidation state; the mark is only released
   * once the shared layer is known to be clean.
   */
  private async drop(prefix: string, scanCount: number): Promise<number> {
    this.marks.begin(prefix);
    try {
      const deleted = await this.dropShared(prefix, scanCount);
      this.marks.retireFailedUnder(prefix);
      return deleted;
    } catch (err) {
      // Fail closed: Redis may still serve the pre-invalidation value to this
      // process, so keep reads off the cache until a later drop succeeds.
      this.marks.markFailed(prefix);
      throw err;
    } finally {
      this.dropLocal(prefix);
      this.marks.finish(prefix);
    }
  }

  /** SCAN + DEL, to avoid blocking on KEYS in production-sized databases. */
  private async dropShared(prefix: string, scanCount: number): Promise<number> {
    let cursor = '0';
    let deleted = 0;
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        scanCount,
      );
      cursor = next;
      if (keys.length > 0) {
        deleted += await this.redis.del(...keys);
      }
    } while (cursor !== '0');
    return deleted;
  }

  private dropLocal(prefix: string): void {
    for (const k of this.lru.keys()) {
      if (k.startsWith(prefix)) this.lru.delete(k);
    }
  }

  /**
   * True when neither layer may be trusted for this key: a drop is in flight,
   * or an earlier drop failed and Redis was never cleaned. In the failed case
   * the drop is retried here, so a transient outage costs the affected codes
   * their caching until Redis answers again — not for the process lifetime.
   */
  private async isBypassed(key: string): Promise<boolean> {
    if (this.marks.isClean) return false;
    if (this.marks.isDraining(key)) return true;
    const failed = this.marks.failedPrefixFor(key);
    if (failed === undefined) return false;
    try {
      await this.drop(failed, 200);
    } catch {
      // Still unreachable — stay off the cache and read through to Postgres.
    }
    return true;
  }

  private touchLru(key: string, value: unknown): void {
    if (this.lru.has(key)) this.lru.delete(key);
    this.lru.set(key, { value, storedAt: this.now() });
    while (this.lru.size > LRU_MAX) {
      const oldest = this.lru.keys().next().value;
      if (oldest === undefined) break;
      this.lru.delete(oldest);
    }
  }

  private isNotRegisteredSentinel(v: unknown): boolean {
    return (
      typeof v === 'object' &&
      v !== null &&
      Object.prototype.hasOwnProperty.call(v, NOT_REGISTERED) &&
      (v as Record<string, unknown>)[NOT_REGISTERED] === true
    );
  }
}
