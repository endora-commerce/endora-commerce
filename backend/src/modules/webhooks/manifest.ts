import { defineModuleManifest } from '@endora-commerce/contracts';

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
  // `webhooks.organization_id` scopes a subscription to a tenant — a real
  // foreign key, surfaced by feature 072 exporting this module's entities.
  dependencies: ['auth', 'organizations'],
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
  // Issue #213 — `integrations:manage` is a **shared** gate: it guards this
  // module's admin surface and `api_keys`', and the core `PERMISSION_CATALOGUE`
  // row that carries its label names `api_keys` alone. Declaring it here makes
  // this module a second *owner*, so the presence filter on `/admin-roles` keeps
  // it grantable while either surface is on. Without this line, switching
  // `api_keys` off would take the code off the role editor while every route in
  // `webhooks/routes.ts` went on enforcing it — a gate nobody can be granted.
  permissions: [{ code: 'integrations:manage', label: 'Manage API keys + webhooks' }],
  activation: { settingCode: 'webhooks.enabled', default: true },
});
