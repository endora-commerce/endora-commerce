import { defineModuleManifest } from '@b2b/contracts';

/**
 * CMS module — feature 014.
 *
 * Owns CMS pages, blocks, templates, and hooks. Manifest backfilled
 * alongside feature 020.
 */
export const manifest = defineModuleManifest({
  id: 'cms',
  name: 'CMS',
  description: 'Pages, blocks, templates, and hooks for content management.',
  version: '1.0.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'cms.read', label: 'View CMS content' },
    { code: 'cms.write', label: 'Edit CMS content' },
  ],
  actions: [
    {
      id: 'new-page',
      labelKey: 'actions.newPage.label',
      descriptionKey: 'actions.newPage.description',
      icon: 'FileText',
      targetRoute: '/cms/pages/new',
      requiredPermission: 'cms.write',
      keywords: ['page', 'new', 'create', 'strona', 'nowa', 'utwórz'],
      weight: 130,
    },
  ],
});
