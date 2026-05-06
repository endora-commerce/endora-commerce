// Blog module plugin — feature 016 / T026.
//
// Wires the cross-module ports the Blog services consume, runs the
// seed reconcilers on first plugin invocation (idempotent), and exposes
// the module handle so other modules + tests can call into it.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';

import { BlogCacheService, type BlogCacheOptions } from './services/blog-cache.js';
import { BlogSettingsResolver, type SettingsServicePort } from './services/blog-settings-resolver.js';
import { registerBlogAssetReferences } from './services/blog-asset-references.js';
import { seedDefaultCategory } from './services/seed-default-category.js';
import { seedBlogRoles } from './services/seed-roles.js';
import type { AssetReferenceRegistry } from '../assets_library/services/reference-registry.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface BlogModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
  /** Redis is optional — when absent, BlogCacheService is `undefined`. */
  redis?: Redis;
  cacheOptions?: BlogCacheOptions;
  /** Settings service port — narrow projection of feature 004's surface. */
  settings: SettingsServicePort;
  /** Library Asset reference registry (feature 013). */
  assetReferenceRegistry: AssetReferenceRegistry;
}

export interface BlogModuleHandle {
  cache: BlogCacheService | undefined;
  settingsResolver: BlogSettingsResolver;
  /**
   * Run the boot reconcilers (Default Category + seeded roles). Called
   * at plugin startup. Returning the result lets tests inspect what was
   * created vs preserved.
   */
  reconcile(): Promise<void>;
}

export function blogModule(options: BlogModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: BlogModuleHandle;
} {
  const cache = options.redis
    ? new BlogCacheService(options.redis, options.cacheOptions ?? {})
    : undefined;

  const settingsResolver = new BlogSettingsResolver(options.settings);

  // Register the asset-reference descriptors immediately so the Library's
  // soft-delete path picks them up before any blog write happens.
  registerBlogAssetReferences(options.assetReferenceRegistry, options.emFactory);

  let reconciled = false;
  async function reconcile(): Promise<void> {
    if (reconciled) return;
    await seedDefaultCategory(options.emFactory);
    await seedBlogRoles(options.emFactory);
    reconciled = true;
  }

  const handle: BlogModuleHandle = { cache, settingsResolver, reconcile };

  const plugin = async (app: FastifyInstance) => {
    // Real admin + storefront routes land in user-story phases. The
    // plugin currently runs the seed reconcilers on first registration
    // so the platform boots with the seeded Default Category + the two
    // seeded admin roles + the four blog settings (registered through
    // the Settings module's manifest loader).
    await reconcile();
    // Avoid the unused-arg lint while no routes are registered yet.
    void app;
  };

  return { plugin, handle };
}
