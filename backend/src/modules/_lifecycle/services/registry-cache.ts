import type Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ModuleRegistration } from '../entities/module-registration.entity.js';

export const ENABLED_SET_KEY = 'b2b:module:enabled-set';
export const STATE_CHANGED_CHANNEL = 'b2b:module:state-changed';
export const FALLBACK_TTL_MS = 5_000;

/**
 * Per-process cache of currently-enabled module ids. Hot path for the
 * `defineModuleRoutes` / `defineModuleWorker` / `subscribeForModule`
 * wrappers — every request hits `isEnabled()` so the implementation
 * MUST stay in-memory after the cold start.
 *
 * The cache keeps itself fresh by subscribing to the
 * `b2b:module:state-changed` pub/sub channel. If the subscription
 * connection drops, the cache falls back to a 5-second TTL with
 * on-demand SQL refresh until pub/sub recovers.
 */
export class ModuleRegistryCache {
  private enabled = new Set<string>();
  private lastFreshAt = 0;
  private subscriber: Redis | null = null;
  private degraded = false;

  isEnabled(moduleId: string): boolean {
    return this.enabled.has(moduleId);
  }

  enabledIds(): string[] {
    return [...this.enabled].sort();
  }

  /**
   * Cold-start the cache from the registry table and arm the pub/sub
   * subscriber. Safe to call multiple times — subsequent calls re-read
   * the registry but do not re-subscribe.
   */
  async start(opts: {
    redis: Redis;
    redisSubscriber: Redis;
    em: () => EntityManager;
  }): Promise<void> {
    await this.refreshFromDb(opts.em);
    if (this.subscriber) return;
    this.subscriber = opts.redisSubscriber;
    await this.subscriber.subscribe(STATE_CHANGED_CHANNEL);
    this.subscriber.on('message', (channel) => {
      if (channel !== STATE_CHANGED_CHANNEL) return;
      void this.refreshFromDb(opts.em).catch((err) => {
        // Slip into degraded mode; route handlers will check via fallback.
        this.degraded = true;
         
        console.warn(
          `[module-lifecycle] registry-cache refresh failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    });
    this.subscriber.on('end', () => {
      this.degraded = true;
    });
    // Mirror to Redis SET so other processes can warm-read on cold start.
    await opts.redis.del(ENABLED_SET_KEY);
    if (this.enabled.size > 0) {
      await opts.redis.sadd(ENABLED_SET_KEY, ...this.enabled);
    }
  }

  /** Test seam — replaces the cached set without touching Redis or DB. */
  __setEnabledForTesting(ids: readonly string[]): void {
    this.enabled = new Set(ids);
    this.lastFreshAt = Date.now();
  }

  /** True when the pub/sub side is unhealthy and the cache should TTL-refresh. */
  isDegraded(): boolean {
    return this.degraded;
  }

  /** Refresh from the source-of-truth table. Idempotent. */
  async refreshFromDb(em: () => EntityManager): Promise<void> {
    const rows = await em().find(ModuleRegistration, { state: 'installed' });
    const fresh = new Set<string>();
    for (const r of rows) fresh.add(r.moduleId);
    this.enabled = fresh;
    this.lastFreshAt = Date.now();
    this.degraded = false;
  }

  /**
   * Used by the wrappers in degraded mode. Refreshes from DB at most
   * once per FALLBACK_TTL_MS so a stuck pub/sub doesn't turn every
   * request into a SQL query.
   */
  async maybeRefresh(em: () => EntityManager): Promise<void> {
    if (!this.degraded) return;
    if (Date.now() - this.lastFreshAt < FALLBACK_TTL_MS) return;
    await this.refreshFromDb(em);
  }
}

/** Module-internal singleton consumed by the wrappers. */
export const registryCache = new ModuleRegistryCache();

/**
 * Publish a state-change notification. Called by the orchestrator on
 * every successful install / uninstall / enable / disable.
 */
export async function publishStateChanged(
  redis: Redis,
  payload: { moduleId: string; newState: string },
): Promise<void> {
  await redis.publish(STATE_CHANGED_CHANNEL, JSON.stringify(payload));
}
