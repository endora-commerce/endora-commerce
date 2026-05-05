// CMS module plugin — feature 014 / T033.
//
// Phase 2 ships the registry + the seeded-Hook reconciler hook only.
// Admin + storefront route registrations land in subsequent user-story
// phases (Pages in US1, Blocks in US2, Hooks in US4, Templates in US5,
// PageBuilder config endpoint in US6). The legacy cms_pages module's
// plugin continues to register its routes for one release; it will be
// retired in the cleanup PR after the new admin surface is complete.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type Redis from 'ioredis';

import { PageBuilderRegistry } from './services/page-builder-registry.js';
import { reconcileSeededHooks } from './services/seed-hooks.js';
import { CmsPageService } from './services/cms-page-service.js';
import { CmsBlockService } from './services/cms-block-service.js';
import { CmsTemplateService } from './services/cms-template-service.js';
import { CmsReferenceRegistry } from './services/cms-reference-registry.js';
import { StorefrontResolver } from './services/storefront-resolver.js';
import { CmsHookService } from './services/cms-hook-service.js';
import { CmsCache, type CmsCacheOptions } from './services/cms-cache.js';
import { registerCmsAdminRoutes } from './routes.admin.js';
import { registerCmsStorefrontRoutes } from './routes.storefront.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CmsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
  /**
   * When provided, the storefront resolver caches its responses in Redis
   * with a 5-minute TTL. Tests pass a custom `cacheOptions.ttlSeconds=0`
   * to disable caching when they need every read to hit the DB.
   */
  redis?: Redis;
  cacheOptions?: CmsCacheOptions;
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
}

export function cmsModule(options: CmsModuleOptions): {
  plugin: (app: FastifyInstance) => Promise<void>;
  handle: CmsModuleHandle;
} {
  const pageBuilderRegistry = new PageBuilderRegistry();
  // Register the CMS module's own built-in components in metadata-only
  // form. Their actual React renderers live in @b2b/cms-components.
  // Field shapes are intentionally minimal at v1 ship; admin-side controls
  // expand them as the editor matures.
  pageBuilderRegistry.register('cms', {
    components: {
      Row: { fields: { gap: { type: 'number', label: 'Gap' } } },
      Columns: {
        fields: {
          count: { type: 'number', label: 'Number of columns' },
          widths: { type: 'array', label: 'Column widths (percent)' },
        },
      },
      Text: { fields: { tiptapHtml: { type: 'richtext', label: 'Text' } } },
      Heading: {
        fields: {
          level: {
            type: 'select',
            label: 'Level',
            options: [1, 2, 3, 4, 5, 6].map((n) => ({ label: `H${n}`, value: n })),
          },
          text: { type: 'text', label: 'Text' },
        },
      },
      Button: {
        fields: {
          label: { type: 'text', label: 'Label', required: true },
          href: { type: 'text', label: 'Link target', required: true },
          variant: {
            type: 'select',
            label: 'Variant',
            options: ['primary', 'secondary', 'ghost'].map((v) => ({ label: v, value: v })),
          },
        },
      },
      InsertBlock: {
        fields: { code: { type: 'text', label: 'Block code', required: true } },
      },
      InsertTemplate: {
        fields: { code: { type: 'text', label: 'Template code', required: true } },
      },
    },
  });

  const cache = options.redis ? new CmsCache(options.redis, options.cacheOptions ?? {}) : undefined;

  const referenceRegistry = new CmsReferenceRegistry(options.emFactory);
  const pageService = new CmsPageService(
    options.emFactory,
    () => pageBuilderRegistry.knownNames(),
    cache,
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
  };

  const plugin = async (app: FastifyInstance) => {
    await registerCmsAdminRoutes(app, {
      pageService,
      blockService,
      templateService,
      hookService,
      pageBuilderRegistry,
      ...(options.requireAdmin ? { requireAdmin: options.requireAdmin } : {}),
    });
    await registerCmsStorefrontRoutes(app, { storefrontResolver });
  };

  return { plugin, handle };
}
