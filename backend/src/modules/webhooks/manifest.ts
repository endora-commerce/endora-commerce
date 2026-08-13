import { defineModuleManifest } from '@b2b/contracts';

/**
 * Webhooks module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'webhooks',
  name: 'Webhooks',
  description:
    'Outbound webhook subscription registry and dispatcher.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by; the
  // edge became real with the conversion (feature 072, T098).
  dependencies: ['auth'],
  settings: {
    moduleCode: 'webhooks',
    groups: [{ code: 'webhooks', name: 'Webhooks' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'webhooks.enabled',
        name: 'Webhooks enabled',
        description:
          'Switches outbound webhook delivery and its admin screens on or off. While off no event is bridged and no delivery is attempted; events emitted during that time are not delivered retroactively. Nothing is deleted — subscriptions and delivery history are preserved and resume when you switch it back on.',
        groupCode: 'webhooks',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  activation: { settingCode: 'webhooks.enabled', default: true },
});
