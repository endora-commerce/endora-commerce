import { defineModuleManifest } from '@b2b/contracts';

/**
 * Analytics module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'analytics',
  name: 'Analytics',
  description:
    'Server-side analytics aggregation and dashboard data feeds.',
  version: '1.0.0',
  // Feature 072 (wave 1) — the admin summary route is gated by `requireAdmin`,
  // which `auth` owns. With `auth` absent the route cannot be guarded at all,
  // so this is a hard edge rather than a degraded mode.
  dependencies: ['auth'],
  permissions: [{ code: 'analytics:read', label: 'View analytics dashboards' }],
  settings: {
    moduleCode: 'analytics',
    groups: [{ code: 'analytics', name: 'Analytics' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide,
        // never channel-scoped: activation is not a per-channel question.
        code: 'analytics.enabled',
        name: 'Analytics enabled',
        description:
          'Switches server-side analytics on or off. While off nothing is ingested, the dashboards and their API are gone, and no event is forwarded to GA4. Nothing is deleted — the events already collected are preserved and reappear when you switch it back on.',
        groupCode: 'analytics',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  activation: { settingCode: 'analytics.enabled', default: true },
});
