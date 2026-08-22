import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * API Keys module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'api_keys',
  name: 'API Keys',
  description:
    'Programmatic API keys (Bearer tokens) used by integrations and webhooks.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; feature
  // 072 made it a container resolution rather than a constructor argument.
  dependencies: ['customer_accounts', 'organizations', 'sales_channels', 'auth'],
  settings: {
    moduleCode: 'api_keys',
    groups: [{ code: 'api_keys', name: 'API keys' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'api_keys.enabled',
        name: 'API keys enabled',
        description:
          'Switches machine-to-machine API keys on or off: the admin screens that issue them and the gates that authenticate them on the external catalog namespace. Switched off, existing keys stop authenticating but are not revoked — they work again exactly as issued when you switch it back on.',
        groupCode: 'api_keys',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  // Issue #213 — `integrations:manage` is a **shared** gate: it guards this
  // module's admin surface and `webhooks`', and the core `PERMISSION_CATALOGUE`
  // row that carries its label can name only one module. Both owners declare it,
  // so the presence filter on `/admin-roles` keeps the code grantable while
  // either surface is on. This half is what the core row already says; it is
  // written out anyway, because a shared code owned by one manifest and one
  // hard-coded core row is the arrangement that produced the asymmetry.
  permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
  activation: { settingCode: 'api_keys.enabled', default: true },
});
