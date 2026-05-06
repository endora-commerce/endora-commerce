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
  /** Cross-module ports the storefront resolver delegates to (asset URL signing, product cards). */
  storefrontDeps?: BlogStorefrontDeps;
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
  const postService = new BlogPostService(options.emFactory, cache);
  const categoryService = new BlogCategoryService(options.emFactory, cache);
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
    await registerBlogAdminRoutes(app, {
      postService,
      categoryService,
      tagService,
      ...(options.requireAdmin ? { requireAdmin: options.requireAdmin } : {}),
    });
    await registerBlogStorefrontRoutes(app, { storefrontResolver });
  };

  return { plugin, handle };
}
