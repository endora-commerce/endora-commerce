import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';
import type { DictionaryValidator } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { AssetReferenceRegistry } from '../assets_library/services/reference-registry.js';

import { BlogCategory } from './entities/blog-category.entity.js';
import { BlogCategorySalesChannel } from './entities/blog-category-sales-channel.entity.js';
import { BlogCategoryLanguage } from './entities/blog-category-language.entity.js';
import { BlogPost } from './entities/blog-post.entity.js';
import { BlogPostSalesChannel } from './entities/blog-post-sales-channel.entity.js';
import { BlogPostLanguage } from './entities/blog-post-language.entity.js';
import { BlogPostCategory } from './entities/blog-post-category.entity.js';
import { BlogPostTag } from './entities/blog-post-tag.entity.js';
import { BlogPostRelatedPost } from './entities/blog-post-related-post.entity.js';
import { BlogPostRelatedProduct } from './entities/blog-post-related-product.entity.js';
import { BlogTag } from './entities/blog-tag.entity.js';

import { BlogCacheService } from './services/blog-cache.js';
import {
  BlogSettingsResolver,
  type SettingsServicePort,
} from './services/blog-settings-resolver.js';
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

/**
 * The Blog module's backend entry point — feature 016, converted to feature
 * 072's `registerModule` contract.
 *
 * One function declares the whole module: its services, its two route
 * surfaces, its event subscription and its boot work. Nothing about `blog`
 * appears in a composition root any more, which is what makes removing it a
 * deletion rather than a search.
 */

/** Every entity this module owns. The ORM's list is assembled from these. */
export const entities = [
  BlogCategory,
  BlogCategorySalesChannel,
  BlogCategoryLanguage,
  BlogPost,
  BlogPostSalesChannel,
  BlogPostLanguage,
  BlogPostCategory,
  BlogPostTag,
  BlogPostRelatedPost,
  BlogPostRelatedProduct,
  BlogTag,
] as const;

/**
 * What `blog` resolves from the container: the names it owns, plus the shapes
 * it needs from the platform and from other modules.
 *
 * The cross-module names are declared **structurally, here**, not imported from
 * the providing module's service class — that is the port rule (FR-040). The
 * container is the runtime authority: a name nothing registered throws at
 * resolution rather than arriving as `undefined`.
 */
export interface BlogCradle {
  /** Kernel-owned: a fresh `EntityManager` fork per call. */
  readonly emFactory: () => EntityManager;
  /** Platform-owned. Absent in a deployment that runs without Redis. */
  readonly redis: Redis | undefined;
  /** Kernel port (`kernel/ports/require-admin.ts`), implemented by `auth`. */
  readonly requireAdmin: RequireAdminFactory | undefined;
  /** Kernel port — the narrow read slice of the settings store this module uses. */
  readonly settingsReadPort: SettingsServicePort;
  /**
   * Owned by `assets_library`: the registry that blocks deleting a referenced
   * asset. Still a type-only import of the provider's interface, exactly as
   * `plugin.ts` had it — the port that would replace it belongs to
   * `assets_library`'s own conversion, not to this one.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistry;
  /** Owned by `dictionaries`: validates language-scope fields (feature 017). */
  readonly dictionaryValidator: DictionaryValidator | undefined;
  /** Cross-module storefront ports (asset URL signing, product cards). */
  readonly blogStorefrontDeps: BlogStorefrontDeps | undefined;

  readonly blogCacheService: BlogCacheService | undefined;
  readonly blogSettingsResolver: BlogSettingsResolver;
  readonly blogPostService: BlogPostService;
  readonly blogCategoryService: BlogCategoryService;
  readonly blogTagService: BlogTagService;
  readonly blogStorefrontResolver: BlogStorefrontResolver;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Singletons, matching what the composition root constructed once at boot.
    // They take `emFactory` rather than an `EntityManager`, so a single
    // instance is correct in every request and every job: the fork happens per
    // call and the tenant filter reads the ambient context at query time.
    blogCacheService: ctx
      .asFunction(({ redis }: BlogCradle) =>
        redis ? new BlogCacheService(redis, {}) : undefined,
      )
      .singleton(),

    blogSettingsResolver: ctx
      .asFunction(
        () => new BlogSettingsResolver(lazyPort<SettingsServicePort>(ctx, 'settingsReadPort')),
      )
      .singleton(),

    blogPostService: ctx
      .asFunction(
        ({ emFactory, blogCacheService }: BlogCradle) =>
          new BlogPostService(
            emFactory,
            blogCacheService,
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
          ),
      )
      .singleton(),

    blogCategoryService: ctx
      .asFunction(
        ({ emFactory, blogCacheService }: BlogCradle) =>
          new BlogCategoryService(
            emFactory,
            blogCacheService,
            lazyPort<DictionaryValidator>(ctx, 'dictionaryValidator'),
          ),
      )
      .singleton(),

    blogTagService: ctx
      .asFunction(
        ({ emFactory, blogCacheService }: BlogCradle) =>
          new BlogTagService(emFactory, blogCacheService),
      )
      .singleton(),

    blogStorefrontResolver: ctx
      .asFunction(
        ({ emFactory, blogSettingsResolver, blogStorefrontDeps, blogCacheService }: BlogCradle) =>
          new BlogStorefrontResolver(
            emFactory,
            blogSettingsResolver,
            blogStorefrontDeps ?? {},
            blogCacheService,
          ),
      )
      .singleton(),
  });

  ctx.routes(async (app) => {
    const { blogPostService, blogCategoryService, blogTagService, requireAdmin } =
      ctx.cradle<BlogCradle>();
    await registerBlogAdminRoutes(app, {
      postService: blogPostService,
      categoryService: blogCategoryService,
      tagService: blogTagService,
      ...(requireAdmin ? { requireAdmin } : {}),
    });
  });

  ctx.routes(async (app) => {
    const { blogStorefrontResolver } = ctx.cradle<BlogCradle>();
    await registerBlogStorefrontRoutes(app, { storefrontResolver: blogStorefrontResolver });
  });

  // R9 — a `blog.*` settings write wipes the storefront blog cache, so the next
  // read picks up the new value.
  ctx.subscribe('settings.value_changed', async (payload) => {
    const code = (payload as { settingCode?: string } | null)?.settingCode;
    if (code === undefined || !code.startsWith('blog.')) return;
    await ctx.cradle<BlogCradle>().blogCacheService?.invalidateAll();
  });

  ctx.onBoot(async () => {
    const { assetReferenceRegistry, emFactory } = ctx.cradle<BlogCradle>();
    // Registered before any blog write can happen, so the Library's soft-delete
    // path sees the two blog reference edges from the first request on.
    registerBlogAssetReferences(assetReferenceRegistry, emFactory);
    // Idempotent boot reconcilers (R11 / R8): on a rerun they preserve every
    // admin edit and only fill in what is missing.
    await seedDefaultCategory(emFactory);
    await seedBlogRoles(emFactory);
  });
}
