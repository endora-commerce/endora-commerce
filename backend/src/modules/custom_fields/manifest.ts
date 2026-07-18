import { defineModuleManifest } from '@b2b/contracts';

/**
 * Custom Fields module — manifest (feature 055).
 *
 * Owns the entity-agnostic custom-field definition/option registry and the
 * value-validation service consumed by host modules. Platform-global; values
 * live on host rows and inherit the host's tenant scope (Principle XI).
 * Definition/option mutations run through the Command Bus (Principle XIII).
 */
export const manifest = defineModuleManifest({
  id: 'custom_fields',
  name: 'Custom Fields',
  description: 'Entity-agnostic runtime custom fields for core entities.',
  version: '1.0.0',
  dependencies: [],
  i18n: { bundlesDir: 'i18n' },
  permissions: [
    { code: 'custom_fields:read', label: 'View custom fields' },
    { code: 'custom_fields:write', label: 'Manage custom fields (definitions and options)' },
  ],
  actions: [
    {
      id: 'open-custom-fields',
      labelKey: 'actions.openCustomFields.label',
      descriptionKey: 'actions.openCustomFields.description',
      icon: 'Layers',
      targetRoute: '/custom-fields',
      requiredPermission: 'custom_fields:read',
      keywords: ['custom fields', 'attributes', 'pola', 'niestandardowe'],
      weight: 240,
    },
  ],
});
