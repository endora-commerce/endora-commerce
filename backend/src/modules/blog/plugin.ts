// Blog module plugin — feature 016 / T026.
//
// Wires the cross-module ports the Blog services consume, runs the
// seed reconcilers on first plugin invocation (idempotent), and exposes
// the module handle so other modules + tests can call into it.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DictionaryValidator } from '@b2b/contracts';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';

import { BlogCacheService, type BlogCacheOptions } from './services/blog-cache.js';
import { BlogSettingsResolver, type SettingsServicePort } from './services/blog-settings-resolver.js';
import { BlogCategoryService } from './services/blog-category-service.js';
import { BlogPostService } from './services/blog-post-service.js';
import { BlogTagService } from './services/blog-tag-service.js';
import {
  BlogStorefrontResolver,
  type BlogStorefrontDeps,
} from './services/blog-storefront-resolver.js';
import { registerBlogAssetReferences } from './services/blog-asset-references.js';
import { seedDefaultCategory } from './services/seed-default-category.js';
import { seedBlogRoles } from './services/seed-roles.js';
import { registerBlogAdminRoutes } from './routes.admin.js';
import { defineModuleRoutes } from '../_lifecycle/plugin-helpers.js';
import { registerBlogStorefrontRoutes } from './routes.storefront.js';
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
  /** Feature 017 dictionary validation port for language-scope fields. */
  dictionaryValidator?: DictionaryValidator;
  /** Cross-module ports the storefront resolver delegates to (asset URL signing, product cards). */
  storefrontDeps?: BlogStorefrontDeps;
  /**
   * Optional EventBus. When supplied, the plugin subscribes to
   * `settings.value_changed` and wipes the storefront blog cache when a
   * `blog.*` setting changes (R9 — settings writes invalidate the
   * affected channels' keyspace).
   */
  eventBus?: EventBus;
}

export interface BlogModuleHandle {
  cache: BlogCacheService | undefined;
  settingsResolver: BlogSettingsResolver;
  postService: BlogPostService;
  categoryService: BlogCategoryService;
  tagService: BlogTagService;
  storefrontResolver: BlogStorefrontResolver;
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
  const postService = new BlogPostService(options.emFactory, cache, options.dictionaryValidator);
  const categoryService = new BlogCategoryService(
    options.emFactory,
    cache,
    options.dictionaryValidator,
  );
  const tagService = new BlogTagService(options.emFactory, cache);
  const storefrontResolver = new BlogStorefrontResolver(
    options.emFactory,
    settingsResolver,
    options.storefrontDeps ?? {},
    cache,
  );

  // Register the asset-reference descriptors immediately so the Library's
  // soft-delete path picks them up before any blog write happens.
  registerBlogAssetReferences(options.assetReferenceRegistry, options.emFactory);

  // When a `blog.*` setting changes, wipe the storefront blog cache so
  // the next read picks up the new value (R9).
  if (options.eventBus && cache) {
    options.eventBus.on('settings.value_changed', async (payload: unknown) => {
      const code = (payload as { settingCode?: string } | null)?.settingCode;
      if (code && code.startsWith('blog.')) {
        await cache.invalidateAll();
      }
    });
  }

  let reconciled = false;
  async function reconcile(): Promise<void> {
    if (reconciled) return;
    await seedDefaultCategory(options.emFactory);
    await seedBlogRoles(options.emFactory);
    reconciled = true;
  }

  const handle: BlogModuleHandle = {
    cache,
    settingsResolver,
    postService,
    categoryService,
    tagService,
    storefrontResolver,
    reconcile,
  };

  const plugin = async (app: FastifyInstance) => {
    await reconcile();
    // Feature 018 smoke wiring — every blog route (admin + storefront)
    // is gated by the `blog` module's enabled state. Disabling the
    // module via `pnpm module:disable blog` makes these routes return
    // 503 with `MODULE_DISABLED`; re-enabling restores them without a
    // process restart.
    const adminPlugin = defineModuleRoutes('blog', async (scoped) => {
      await registerBlogAdminRoutes(scoped, {
        postService,
        categoryService,
        tagService,
        ...(options.requireAdmin ? { requireAdmin: options.requireAdmin } : {}),
      });
    });
    await adminPlugin(app);
    const storefrontPlugin = defineModuleRoutes('blog', async (scoped) => {
      await registerBlogStorefrontRoutes(scoped, { storefrontResolver });
    });
    await storefrontPlugin(app);
  };

  return { plugin, handle };
}
