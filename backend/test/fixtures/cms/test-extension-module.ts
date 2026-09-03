// Test fixture exercising the Page Builder block-declaration SPI
// (feature 014 / T087, rebuilt on manifest declarations by feature 096 T209).
//
// Real modules declare `blocks` and `blockCategories` on their own
// `manifest.ts` and the registry takes them at composition; this fixture is a
// synthetic manifest, so the integration test exercises the same entry point a
// module package does rather than a call shape nothing else uses.

import type { ModuleManifest } from '@endora-commerce/contracts';
import type { PageBuilderRegistry } from '../../../../packages/modules/cms/src/backend/services/page-builder-registry.js';

/** A module id, so it is a legal owner segment (`moduleIdRe`, snake_case). */
export const TEST_EXTENSION_MODULE_CODE = 'test_ext';
export const TEST_EXTENSION_COMPONENT_NAME = 'test_ext.TestCallout';

/**
 * Declares a single `test_ext.TestCallout` block owned by a fictional module.
 * Its `title` (text) and `tone` (select) props are echoed unchanged through the
 * storefront resolver, because Puck data trees are opaque to the backend.
 */
export function registerTestExtension(registry: PageBuilderRegistry): void {
  registry.registerManifest({
    id: TEST_EXTENSION_MODULE_CODE,
    name: 'Test extension',
    version: '1.0.0',
    dependencies: [],
    description: 'Page Builder extension SPI fixture.',
    blocks: [
      {
        name: TEST_EXTENSION_COMPONENT_NAME,
        labelKey: 'blocks.testCallout.label',
        category: 'testing',
        contexts: ['cms'],
        fields: {
          title: { type: 'text', label: 'Callout title', required: true },
          tone: {
            type: 'select',
            label: 'Tone',
            options: [
              { label: 'Info', value: 'info' },
              { label: 'Warning', value: 'warning' },
            ],
          },
        },
        previewIcon: 'callout',
      },
    ],
    blockCategories: [
      { key: 'testing', titleKey: 'blocks.category.testing', contexts: ['cms'] },
    ],
  } as ModuleManifest);
}
