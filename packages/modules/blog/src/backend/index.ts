import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type {
  AdminRolePort,
  AssetReferenceRegistryPort,
  DictionaryValidator,
  SystemRoleCodePort,
  DictionaryReferenceRegistryPort,
} from '@endora-commerce/contracts';
import type { ModuleContext, RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { effectiveState, lazyPort } from '@endora-commerce/platform/kernel';

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
import { registerBlogLanguageReferences } from './services/blog-language-reference.js';
import { BlogCategory } from './entities/blog-category.entity.js';
import { BlogCategoryLanguage } from './entities/blog-category-language.entity.js';
import { BlogCategorySalesChannel } from './entities/blog-category-sales-channel.entity.js';
import { BlogPost } from './entities/blog-post.entity.js';
import { BlogPostCategory } from './entities/blog-post-category.entity.js';
import { BlogPostLanguage } from './entities/blog-post-language.entity.js';
import { BlogPostRelatedPost } from './entities/blog-post-related-post.entity.js';
import { BlogPostRelatedProduct } from './entities/blog-post-related-product.entity.js';
import { BlogPostSalesChannel } from './entities/blog-post-sales-channel.entity.js';
import { BlogPostTag } from './entities/blog-post-tag.entity.js';
import { BlogTag } from './entities/blog-tag.entity.js';

/**
 * The Blog module's backend entry point — feature 016, converted to feature
 * 072's `registerModule` contract.
 *
 * One function declares the whole module: its services, its two route
 * surfaces, its event subscription and its boot work. Nothing about `blog`
 * appears in a composition root any more, which is what makes removing it a
 * deletion rather than a search.
 */

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
   * asset, as the shape that module publishes (feature 075, Phase C). It used
   * to be a type-only import of the provider's own interface — a real edge,
   * since types resolve at build time, and the one `cms` and `megamenu` cut to
   * the same contract before this.
   */
  readonly assetReferenceRegistry: AssetReferenceRegistryPort;
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

  /**
   * The two asset-reference edges, contributed **unprobed** (D-68).
   *
   * Registered before any blog write can happen, so the Library's soft-delete
   * path sees them from the first request on — and it keeps seeing them while
   * `blog` is switched off, deliberately. `assets_library` consults the registry
   * to refuse deleting an asset something still points at, and a deactivated
   * module's posts and categories still embed assets: probing here would let an
   * operator delete an asset a deactivated post references, and the damage would
   * only surface as a broken image when `blog` comes back on. Off is meant to be
   * non-destructive and reversible (Constitution XVII), which is why the
   * registry's own enumeration policy is `honoured` rather than `skip` for these
   * descriptors — a scanner is integrity, not a surface.
   *
   * A second hook rather than a line in the one below, because the two answer
   * different questions: this one must run whatever the module's state, that one
   * must not run while it is off. `product_feeds/backend.ts` is the shipped
   * example of the same pair.
   */
  ctx.onBoot(() => {
    const { assetReferenceRegistry, emFactory } = ctx.cradle<BlogCradle>();
    registerBlogAssetReferences(assetReferenceRegistry, emFactory);
  });

  // Idempotent boot reconcilers (R11 / R8): on a rerun they preserve every
  // admin edit and only fill in what is missing.
  ctx.onBoot(async () => {
    // Presence is decided here — first, and outside anything that could catch it
    // (issue #146, D-68). These two seeds write rows: a category and two roles.
    // A switched-off module writing at every boot is "behaves as if never
    // installed" failing, and a boot hook has no caller to answer, so the
    // question is asked rather than thrown. `runBootHooks` re-throws as
    // `ModuleCompositionError`, which `index.ts` turns into `process.exit(1)`.
    if (!effectiveState.isPresent('blog')) return;
    const { emFactory } = ctx.cradle<BlogCradle>();
    await seedDefaultCategory(emFactory);
    // Two ports into `admin_roles`, and they are different kinds of seam.
    //
    // `adminRolePort` is a **call**: it is where the two role rows are written
    // since feature 075 drained this module's cross-module-import shard, in
    // place of three raw SQL statements against `admin_roles`' own table. It is
    // gated, so the seam fails closed — but `admin_roles` declares itself
    // non-deactivatable, so the state that gate answers "no" in is one an
    // operator cannot reach: the only way this composition runs without it is a
    // deployment that never shipped it, and `composeModules` refuses that
    // before the first module registers. Resolving it here rather than in a
    // factory keeps it lazy, so composition asks the gate nothing.
    //
    // `systemRoleCodePort` is `admin_roles`' ungated contribution registry, so
    // resolving it asks no gate at all — the probe above is this module's own
    // answer about its own seeds, not a question about either seam's owner.
    await seedBlogRoles(
      lazyPort<AdminRolePort>(ctx, 'adminRolePort'),
      lazyPort<SystemRoleCodePort>(ctx, 'systemRoleCodePort'),
    );
  });

  /**
   * This module's rows carry a language code, so it answers "who still points at
   * this language?" about its own tables (feature 077, D-87), where the owner used
   * to count them with SQL naming this module's tables.
   *
   * A **contribution** hook: it pushes an inert descriptor into `languageReferenceRegistry`,
   * an ungated registry, and carries no presence probe (D-62/D-68). Probing
   * would be wrong in the dangerous direction — a switched-off module still owns
   * the rows, so its language must still refuse the delete, which is the
   * enumeration policy the registry states.
   */
  ctx.onBoot(() => {
    registerBlogLanguageReferences(
      lazyPort<DictionaryReferenceRegistryPort>(ctx, 'languageReferenceRegistry'),
      ctx.cradle<BlogCradle>().emFactory,
    );
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform already reads, in two places: the boot-time
 * loader (`src/packages/package-runtime.ts`, `exported['entities']`) and the
 * static declaration reader (`scripts/lib/package-declarations.ts`), which is
 * the third source of the `table→owner` map and the package pass of
 * `check-entity-tenant-classification`. Until D-168 this file published eleven
 * `export *` lines instead, which satisfied only the committed host registry —
 * the one path that stops being taken the day this module is *installed*
 * rather than linked, at which point the loader read `undefined`, returned
 * `[]`, and registered zero entities without a word.
 *
 * The absence of a named export is the load-bearing half. With it,
 * `import type { BlogPost } from '@endora-commerce/mod-blog/backend'` compiles
 * in any consumer — ours, a deployment's, a stranger's — and only a check whose
 * population is *this* repository could ever object. Without it, that import is
 * TS2305 in the consumer's own tree, which is Principle I holding by
 * construction. Nothing legitimate is lost: D-32 already forbids an ORM
 * relation from another module into these classes, and every other cross-module
 * read goes through a contract type. An `EntityClassLike[]` is a value the
 * host's ORM registers and nothing else can usefully name.
 *
 * Identity matters more here than anywhere else in the package: MikroORM keys
 * its metadata on the class, so a consumer that reached these files by a second
 * specifier would register a second `BlogPost` and lose one of them at
 * discovery (D-160.6, measured). One array behind one declared subpath is the
 * only way in.
 */
export const entities = [
  BlogCategory,
  BlogCategoryLanguage,
  BlogCategorySalesChannel,
  BlogPost,
  BlogPostCategory,
  BlogPostLanguage,
  BlogPostRelatedPost,
  BlogPostRelatedProduct,
  BlogPostSalesChannel,
  BlogPostTag,
  BlogTag,
];
