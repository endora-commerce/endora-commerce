// CMS module plugin — feature 014 / T033.
//
// Phase 2 ships the registry + the seeded-Hook reconciler hook only.
// Admin + storefront route registrations land in subsequent user-story
// phases (Pages in US1, Blocks in US2, Hooks in US4, Templates in US5,
// PageBuilder config endpoint in US6). The legacy cms_pages module's
// plugin continues to register its routes for one release; it will be
// retired in the cleanup PR after the new admin surface is complete.

import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type {
  CmsColorPaletteEntry,
  CmsContentChange,
  ModuleManifest,
} from '@endora-commerce/contracts';

import { PageBuilderRegistry, type PageBuilderBreakpointsResolver, type ColorPaletteResolver } from './services/page-builder-registry.js';
import { reconcileSeededHooks } from './services/seed-hooks.js';
import { resolvePageBuilderBreakpointsFromEnv } from '../manifest.js';
import { CmsPageService, type ReservedSlugSegmentsResolver } from './services/cms-page-service.js';
import { CmsBlockService } from './services/cms-block-service.js';
import { CmsTemplateService } from './services/cms-template-service.js';
import { CmsReferenceRegistry } from './services/cms-reference-registry.js';
import { StorefrontResolver, type CmsAssetResolver, type CmsDefaultShareImageResolver } from './services/storefront-resolver.js';
import { CmsHookService } from './services/cms-hook-service.js';
import { CmsCache } from './services/cms-cache.js';
import { CmsContentInvalidator } from './services/cms-content-invalidator.js';
import { CmsBrandTokensService } from './services/brand-tokens-service.js';
import { registerCmsAdminRoutes } from './routes.admin.js';
import { registerCmsStorefrontRoutes } from './routes.storefront.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { CMS_TRANSLATION_DEFAULT_MAX_SOURCE_CHARACTERS } from '@endora-commerce/contracts';
import type { TranslationConfig } from './services/translation/capability.js';
import { PageBuilderTranslationService } from './services/translation/page-builder-translation.service.js';

export interface ColorPaletteAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

export type ColorPaletteWriter = (
  entries: CmsColorPaletteEntry[],
  expectedVersion: string | null,
  actor: ColorPaletteAuditContext,
) => Promise<CmsColorPaletteEntry[]>;

export interface CmsModuleOptions {
  emFactory: () => EntityManager;
  /**
   * The platform's Command Bus (Constitution XIII): every admin write to a
   * Page, a Block, a Template or a Hook runs through it, so each one is audited
   * in its own transaction. Required — an optional bus would be a write path
   * whose absent form records nothing.
   */
  commandBus: CommandBus;
  /**
   * Required since feature 072 (T093). It was optional, and `routes.admin.ts`
   * defaulted it to `?? (async () => {})` — a permission gate whose absent form
   * is open. It is resolved from the container now, so there is no omission
   * left to default.
   */
  requireAdmin: RequireAdminFactory;
  /**
   * When provided, the storefront resolver caches its responses in Redis
   * with a 5-minute TTL. Tests pass a custom `cacheOptions.ttlSeconds=0`
   * to disable caching when they need every read to hit the DB.
   */
  redis?: Redis;
  /**
   * The composed modules, from which the Page Builder registry takes every
   * block and category declaration (feature 096, T209). Core manifests plus
   * this deployment's overlay modules, in the shape both composition roots
   * contribute as `resolvedModuleRegistry`.
   */
  manifests?: ReadonlyArray<{ manifest: ModuleManifest }>;
  /** Effective presence, read by the registry at enumeration (FR-010). */
  isModulePresent?: (moduleId: string) => boolean;
  /**
   * Told what a content write changed, after it committed and after this
   * module's own Redis entries were dropped. `backend/index.ts` binds it to the
   * EventBus; a composition that passes nothing publishes nothing.
   */
  publishContentChange?: (change: CmsContentChange) => void | Promise<void>;
  /**
   * Feature 151 — the Page Builder translation's configuration, resolved per
   * request (settings, credential, model). `backend/index.ts` binds it to the
   * settings store and the `credentials` port; a composition that passes
   * nothing has the function switched off.
   */
  translationConfig?: () => Promise<TranslationConfig>;
  /**
   * Feature 163 — asks the storefront to drop Data Cache entries by tag after a
   * brand-token write commits. `backend/index.ts` binds it to
   * `cmsStorefrontRevalidator`; a composition that passes nothing revalidates
   * nothing.
   */
  revalidateStorefront?: (tags: string[]) => Promise<void>;
}

export interface CmsModuleHandle {
  pageBuilderRegistry: PageBuilderRegistry;
  pageService: CmsPageService;
  blockService: CmsBlockService;
  templateService: CmsTemplateService;
  hookService: CmsHookService;
  referenceRegistry: CmsReferenceRegistry;
  storefrontResolver: StorefrontResolver;
  /** Feature 151 — the Page Builder translation behind the two admin routes. */
  translation: PageBuilderTranslationService;
  /** Feature 163 — the brand tokens behind the admin and storefront routes. */
  brandTokensService: CmsBrandTokensService;
  /** Storefront read-through cache — `undefined` when no Redis was wired. */
  cache: CmsCache | undefined;
  /** Idempotent reconciler — called by composition before HTTP starts. */
  reconcile: () => Promise<{ inserted: number; preservedExisting: number }>;
  /** Late-bound resolver for breakpoint settings (wired from composition after Settings module boots). */
  setPageBuilderBreakpointsResolver: (resolver: PageBuilderBreakpointsResolver) => void;
  /** Late-bound resolver for the global Page Builder color palette. */
  setColorPaletteResolver: (resolver: ColorPaletteResolver) => void;
  /** Late-bound writer for the global Page Builder color palette. */
  setColorPaletteWriter: (writer: ColorPaletteWriter) => void;
  /**
   * Late-bound reader for the deployment's reserved first path segments
   * (feature 105, FR-032). Installed by `registerModule`, which is where every
   * settings-backed value of this module is wired, so there is no setter left
   * for a composition root to forget.
   */
  setReservedSlugSegmentsResolver: (resolver: ReservedSlugSegmentsResolver) => void;
  /** Feature 167 — the channels' storefront language prefixes → channel codes. */
  setLanguagePrefixesResolver: (resolver: () => Promise<ReadonlyMap<string, readonly string[]>>) => void;
  /** Feature 171 — first segments other modules serve in the given channels → the claiming module. */
  setClaimedSegmentsResolver: (
    resolver: (salesChannelIds: readonly string[]) => Promise<ReadonlyMap<string, string>>,
  ) => void;
  getColorPaletteWriter: () => ColorPaletteWriter | null;
  setAssetResolver: (resolver: CmsAssetResolver | null) => void;
  /** Feature 163 — the default sharing image, read per request for the request's channel. */
  setDefaultShareImageResolver: (resolver: CmsDefaultShareImageResolver | null) => void;
}

export function cmsModule(options: CmsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: CmsModuleHandle;
} {
  const pageBuilderRegistry = new PageBuilderRegistry({
    breakpoints: resolvePageBuilderBreakpointsFromEnv(),
    // Feature 096, T209 — the registry is populated from the composed modules'
    // `blocks` and `blockCategories` declarations. The 35-name
    // `register('cms', …)` call that stood here declared five of `catalog`'s
    // blocks as `cms`', so the descriptor's `ownerModule` was wrong for every
    // one of them and FR-010 had nothing true to filter on.
    manifests: options.manifests,
    isModulePresent: options.isModulePresent,
  });

  const cache = options.redis ? new CmsCache(options.redis, {}) : undefined;
  // The write services hold this and not the cache: a write states what
  // changed once, and the Redis drop and the published change follow from it
  // in the one order that is safe (see `CmsContentInvalidator`).
  const invalidator = new CmsContentInvalidator(
    cache,
    options.publishContentChange ?? (() => {}),
  );

  const referenceRegistry = new CmsReferenceRegistry(options.emFactory);
  const pageService = new CmsPageService(
    options.emFactory,
    options.commandBus,
    () => pageBuilderRegistry.knownNames(),
    invalidator,
    referenceRegistry,
  );
  const blockService = new CmsBlockService(
    options.emFactory,
    options.commandBus,
    () => pageBuilderRegistry.knownNames(),
    referenceRegistry,
    invalidator,
  );
  const templateService = new CmsTemplateService(
    options.emFactory,
    options.commandBus,
    () => pageBuilderRegistry.knownNames(),
    referenceRegistry,
    invalidator,
  );
  const hookService = new CmsHookService(options.emFactory, options.commandBus, invalidator);
  const storefrontResolver = new StorefrontResolver(options.emFactory, cache);
  const translation = new PageBuilderTranslationService({
    config:
      options.translationConfig ??
      (async () => ({ status: 'disabled', maxCharacters: CMS_TRANSLATION_DEFAULT_MAX_SOURCE_CHARACTERS })),
    // Presence-filtered: a block whose owner is switched off is left untouched.
    declarations: (name) => pageBuilderRegistry.translatableFor(name),
    commandBus: options.commandBus,
  });

  const brandTokensService = new CmsBrandTokensService({
    emFactory: options.emFactory,
    commandBus: options.commandBus,
    ...(options.revalidateStorefront ? { revalidateStorefront: options.revalidateStorefront } : {}),
  });
  // The page-builder descriptor carries the effective set for the previewed
  // channel (feature 163, research R-4).
  pageBuilderRegistry.setBrandTokensResolver((salesChannelId) =>
    brandTokensService.effective(salesChannelId),
  );

  let colorPaletteWriter: ColorPaletteWriter | null = null;

  const handle: CmsModuleHandle = {
    pageBuilderRegistry,
    pageService,
    blockService,
    templateService,
    hookService,
    referenceRegistry,
    storefrontResolver,
    translation,
    brandTokensService,
    cache,
    reconcile: () => reconcileSeededHooks(options.emFactory),
    setPageBuilderBreakpointsResolver: (resolver) => {
      pageBuilderRegistry.setBreakpointsResolver(resolver);
    },
    setColorPaletteResolver: (resolver) => {
      pageBuilderRegistry.setColorPaletteResolver(resolver);
    },
    setColorPaletteWriter: (writer) => {
      colorPaletteWriter = writer;
    },
    setReservedSlugSegmentsResolver: (resolver) => {
      pageService.setReservedSegmentsResolver(resolver);
    },
    setClaimedSegmentsResolver: (resolver) => {
      pageService.setClaimedSegmentsResolver(resolver);
    },
    setLanguagePrefixesResolver: (resolver) => {
      pageService.setLanguagePrefixesResolver(resolver);
    },
    getColorPaletteWriter: () => colorPaletteWriter,
    setAssetResolver: (resolver) => {
      storefrontResolver.setAssetResolver(resolver);
    },
    setDefaultShareImageResolver: (resolver) => {
      storefrontResolver.setDefaultShareImageResolver(resolver);
    },
  };

  const plugin = async (app: FastifyInstance) => {
    // `app.log` exists from here on; a failed brand revalidation is logged to it.
    brandTokensService.setLogger(app.log);
    await registerCmsAdminRoutes(app, {
      pageService,
      blockService,
      templateService,
      hookService,
      pageBuilderRegistry,
      getColorPaletteWriter: () => colorPaletteWriter,
      requireAdmin: options.requireAdmin,
      translation,
      brandTokensService,
    });
    await registerCmsStorefrontRoutes(app, { storefrontResolver, brandTokensService });
  };

  return { plugin, handle };
}
