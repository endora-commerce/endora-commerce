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
import type { CmsColorPaletteEntry, ModuleManifest } from '@endora-commerce/contracts';

import { PageBuilderRegistry, type PageBuilderBreakpointsResolver, type ColorPaletteResolver } from './services/page-builder-registry.js';
import { reconcileSeededHooks } from './services/seed-hooks.js';
import { resolvePageBuilderBreakpointsFromEnv } from '../manifest.js';
import { CmsPageService } from './services/cms-page-service.js';
import { CmsBlockService } from './services/cms-block-service.js';
import { CmsTemplateService } from './services/cms-template-service.js';
import { CmsReferenceRegistry } from './services/cms-reference-registry.js';
import { StorefrontResolver, type CmsAssetResolver } from './services/storefront-resolver.js';
import { CmsHookService } from './services/cms-hook-service.js';
import { CmsCache } from './services/cms-cache.js';
import { registerCmsAdminRoutes } from './routes.admin.js';
import { registerCmsStorefrontRoutes } from './routes.storefront.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

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
}

export interface CmsModuleHandle {
  pageBuilderRegistry: PageBuilderRegistry;
  pageService: CmsPageService;
  blockService: CmsBlockService;
  templateService: CmsTemplateService;
  hookService: CmsHookService;
  referenceRegistry: CmsReferenceRegistry;
  storefrontResolver: StorefrontResolver;
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
  getColorPaletteWriter: () => ColorPaletteWriter | null;
  setAssetResolver: (resolver: CmsAssetResolver | null) => void;
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

  const referenceRegistry = new CmsReferenceRegistry(options.emFactory);
  const pageService = new CmsPageService(
    options.emFactory,
    () => pageBuilderRegistry.knownNames(),
    cache,
    referenceRegistry,
  );
  const blockService = new CmsBlockService(
    options.emFactory,
    () => pageBuilderRegistry.knownNames(),
    referenceRegistry,
    cache,
  );
  const templateService = new CmsTemplateService(
    options.emFactory,
    () => pageBuilderRegistry.knownNames(),
    referenceRegistry,
    cache,
  );
  const hookService = new CmsHookService(options.emFactory, cache);
  const storefrontResolver = new StorefrontResolver(options.emFactory, cache);

  let colorPaletteWriter: ColorPaletteWriter | null = null;

  const handle: CmsModuleHandle = {
    pageBuilderRegistry,
    pageService,
    blockService,
    templateService,
    hookService,
    referenceRegistry,
    storefrontResolver,
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
    getColorPaletteWriter: () => colorPaletteWriter,
    setAssetResolver: (resolver) => {
      storefrontResolver.setAssetResolver(resolver);
    },
  };

  const plugin = async (app: FastifyInstance) => {
    await registerCmsAdminRoutes(app, {
      pageService,
      blockService,
      templateService,
      hookService,
      pageBuilderRegistry,
      getColorPaletteWriter: () => colorPaletteWriter,
      requireAdmin: options.requireAdmin,
    });
    await registerCmsStorefrontRoutes(app, { storefrontResolver });
  };

  return { plugin, handle };
}
