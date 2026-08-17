import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import { inProcessCaches } from '../cache/in-process-cache-registry.js';
import { SettingsCache, SETTINGS_CACHE_NAMESPACE } from './settings-cache.js';
import { SettingsService } from './settings.service.js';

/**
 * The universal settings *reader*, composed as kernel infrastructure rather
 * than as part of the `settings` module (feature 072, T118).
 *
 * The split is the one T110 drew for sales channels, for the same reason: a
 * `SettingsService.get` call backs behaviour in almost every module on the
 * platform, so it cannot be gated on whether an operator wants the settings
 * *administration* screens. What the module owns is the admin write surface,
 * the cache-admin action, the storefront resolvers and its routes.
 *
 * `redis` is required here where the module treated it as optional. Both
 * compositions have always passed one, and the no-cache fallback meant a
 * settings read hit PostgreSQL on every request — a shape nothing ran and
 * nothing measured.
 */
export interface SettingsKernelOptions {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  /**
   * Base64 32-byte key for the `secret` value type (feature 043, FR-021), from
   * `SETTINGS_SECRET_ENCRYPTION_KEY`. Genuinely optional: without it a secret
   * *write* is refused with `SETTING_SECRET_KEY_MISSING` and legacy plaintext
   * reads keep working — absence refuses rather than permits, which is why it
   * survives where the other options did not.
   */
  readonly secretEncryptionKey?: string;
}

export interface SettingsKernel {
  readonly settingsService: SettingsService;
  /**
   * Handed to the `settings` module as `settingsCache`: it owns the one write
   * seam, and since issue #45 the seam drops the cache itself rather than
   * announcing the write and hoping a subscriber gets there first.
   */
  readonly cache: SettingsCache;
  /**
   * Withdraws this process's cache from the operator-facing clear. Released
   * for tests; in production it lives until process exit.
   */
  readonly cacheRegistration: { readonly dispose: () => void };
}

export function composeSettingsKernel(options: SettingsKernelOptions): SettingsKernel {
  const cache = new SettingsCache(options.redis);
  const settingsService = new SettingsService(
    options.emFactory,
    cache,
    options.secretEncryptionKey,
  );

  /**
   * The one thing composing the cache still has to *do*: announce it to the
   * operator-facing "clear cache" action (issue #33). The clear runs in this
   * process and has to reach the object that owns both layers, or it drops the
   * Redis keys while every warm process keeps serving — and re-pinning — the
   * value it had already resolved.
   *
   * It used to ride on `attachSettingsCacheInvalidator`, which also subscribed
   * to `settings.value_changed`. The subscription is gone (issue #45); the
   * registration is not, because it never had anything to do with the bus.
   */
  const unregister = inProcessCaches.register(SETTINGS_CACHE_NAMESPACE, cache);

  return { settingsService, cache, cacheRegistration: { dispose: unregister } };
}
