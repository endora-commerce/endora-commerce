import type Redis from 'ioredis';
import type { CustomFieldDefinition } from '../entities/custom-field-definition.entity.js';
import type { CustomFieldOption } from '../entities/custom-field-option.entity.js';

/** Redis pub/sub channel that fans definition changes across processes (API + worker). */
export const CUSTOM_FIELDS_CHANGED_CHANNEL = 'b2b:custom_fields:definitions-changed';
/** Degraded-mode fallback: drop cached entries after this age if pub/sub is unavailable. */
export const CUSTOM_FIELDS_CACHE_TTL_MS = 5_000;

/** A definition with its options, as cached per entity type. */
export interface CachedDefinition {
  readonly definition: CustomFieldDefinition;
  readonly options: CustomFieldOption[];
}

interface CacheEntry {
  readonly value: CachedDefinition[];
  readonly loadedAt: number;
}

/**
 * Per-`entityType` in-process cache of custom-field definitions (feature 055).
 *
 * The hot path — validating a host write and rendering the admin form — reads
 * definitions frequently, so they are cached in memory and invalidated
 * cross-process on the {@link CUSTOM_FIELDS_CHANGED_CHANNEL} Redis channel
 * (registry-cache pattern). A definition/option Command publishes on commit;
 * every process's subscriber drops the affected entity-type entry. If the
 * subscription connection drops, entries expire after {@link CUSTOM_FIELDS_CACHE_TTL_MS}.
 *
 * `now()` is injectable so tests can advance time without a real clock.
 */
export class CustomFieldDefinitionsCache {
  private readonly entries = new Map<string, CacheEntry>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly publisher?: Redis,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Read cached definitions for an entity type, loading + caching on a miss or a stale entry. */
  async getForEntity(
    entityType: string,
    loader: () => Promise<CachedDefinition[]>,
  ): Promise<CachedDefinition[]> {
    const hit = this.entries.get(entityType);
    if (hit && this.now() - hit.loadedAt < CUSTOM_FIELDS_CACHE_TTL_MS) {
      return hit.value;
    }
    const value = await loader();
    this.entries.set(entityType, { value, loadedAt: this.now() });
    return value;
  }

  /** Drop the local cache for one entity type (or all when omitted). */
  invalidateLocal(entityType?: string): void {
    if (entityType === undefined) this.entries.clear();
    else this.entries.delete(entityType);
  }

  /**
   * Invalidate locally AND fan the change out to other processes. Called by the
   * definition service after a Command commits. Publish failures are swallowed —
   * the TTL fallback keeps other processes eventually-consistent.
   */
  async publishInvalidate(entityType: string): Promise<void> {
    this.invalidateLocal(entityType);
    if (!this.publisher) return;
    try {
      await this.publisher.publish(CUSTOM_FIELDS_CHANGED_CHANNEL, JSON.stringify({ entityType }));
    } catch {
      // Degraded: rely on the TTL fallback.
    }
  }

  /** Arm the cross-process subscriber. Idempotent. */
  async start(redisSubscriber: Redis): Promise<void> {
    if (this.subscriber) return;
    this.subscriber = redisSubscriber;
    await this.subscriber.subscribe(CUSTOM_FIELDS_CHANGED_CHANNEL);
    this.subscriber.on('message', (channel, message) => {
      if (channel !== CUSTOM_FIELDS_CHANGED_CHANNEL) return;
      this.handleMessage(message);
    });
  }

  /** Apply an invalidation message. Exposed for tests + a shared-subscriber wiring. */
  handleMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as { entityType?: string };
      this.invalidateLocal(parsed.entityType);
    } catch {
      this.invalidateLocal();
    }
  }
}
