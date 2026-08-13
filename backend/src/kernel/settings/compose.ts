import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import { SettingsCache } from './settings-cache.js';
import { SettingsService } from './settings.service.js';
import {
  attachSettingsCacheInvalidator,
  type SettingsCacheInvalidatorHandle,
} from './settings-cache-invalidator.js';

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
  readonly eventBus: EventBus;
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
  readonly cache: SettingsCache;
  /** Released for tests; in production it lives until process exit. */
  readonly cacheInvalidator: SettingsCacheInvalidatorHandle;
}

export function composeSettingsKernel(options: SettingsKernelOptions): SettingsKernel {
  const cache = new SettingsCache(options.redis);
  const settingsService = new SettingsService(
    options.emFactory,
    cache,
    options.secretEncryptionKey,
  );
  const cacheInvalidator = attachSettingsCacheInvalidator(options.eventBus, cache);

  return { settingsService, cache, cacheInvalidator };
}
