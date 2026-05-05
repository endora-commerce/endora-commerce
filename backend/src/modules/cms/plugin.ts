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

import { PageBuilderRegistry } from './services/page-builder-registry.js';
import { reconcileSeededHooks } from './services/seed-hooks.js';

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CmsModuleOptions {
  emFactory: () => EntityManager;
  requireAdmin?: RequireAdminFactory;
}

export interface CmsModuleHandle {
  pageBuilderRegistry: PageBuilderRegistry;
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

  const handle: CmsModuleHandle = {
    pageBuilderRegistry,
    reconcile: () => reconcileSeededHooks(options.emFactory),
  };

  const plugin = async (_app: FastifyInstance) => {
    // Routes registered in subsequent user-story phases. Phase 2 ships
    // module instantiation only.
  };

  return { plugin, handle };
}
