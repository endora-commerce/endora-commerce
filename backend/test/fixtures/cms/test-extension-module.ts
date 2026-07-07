// Test fixture exercising the Page Builder component-extension SPI
// (feature 014 / T087). Real modules wire equivalent registrations from
// their plugin's composition step; this fixture lets the integration test
// in T086 verify the SPI end-to-end without depending on a production
// extension shipping yet.

import type { PageBuilderRegistry } from '../../../src/modules/cms/services/page-builder-registry.js';

export const TEST_EXTENSION_MODULE_CODE = 'test-ext';
export const TEST_EXTENSION_COMPONENT_NAME = 'TestCallout';

/**
 * Registers a single `TestCallout` component owned by a fictional
 * `test-ext` module. The component declares a `title` (text) field and a
 * `tone` (select: info | warning) field; both are echoed unchanged through
 * the storefront resolver because Puck data trees are opaque to the
 * backend.
 */
export function registerTestExtension(registry: PageBuilderRegistry): void {
  registry.register(TEST_EXTENSION_MODULE_CODE, {
    components: {
      [TEST_EXTENSION_COMPONENT_NAME]: {
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
        contexts: ['cms'],
      },
    },
  });
}
