import { ANALYTICS_REPORTING_TIME_ZONE_SETTING, defineModuleManifest } from '@endora-commerce/contracts';

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
  //
  // `settings` owns `settingWriteValidatorRegistry`, into which the reporting
  // time zone's validator is pushed at boot (owner decisions 2026-10-27,
  // #465). It cannot be switched off, so the edge binds nothing an operator
  // could flip.
  dependencies: ['auth', 'settings'],
  permissions: [{ code: 'analytics:read', label: 'View analytics dashboards' }],
  // Feature 091, Phase 4 — the module owns its admin surface, so it owns the
  // strings that surface is labelled with. `nav.analytics.label` replaces the
  // shared bundle's `appShell.nav.analytics`, and the dashboard's own copy
  // moved here verbatim out of `_i18n`'s `analytics.*` block.
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // Principle XVI. The module has had an admin screen and a sidebar entry since
  // feature 018 and has never been reachable under ⌘K — sidebar-only, which the
  // principle says is not enough. The gap is repaired in the merge request that
  // makes the surface the module's, because the palette entry is the one half
  // of that surface no admin-side test can answer for: it is resolved by the
  // server from this declaration against the effective enabled-set, which is
  // what makes the off-state proof in
  // `backend/test/integration/analytics/off-state.test.ts` possible at all.
  actions: [
    {
      id: 'open-analytics',
      labelKey: 'actions.openAnalytics.label',
      descriptionKey: 'actions.openAnalytics.description',
      icon: 'LineChart',
      targetRoute: '/analytics',
      requiredPermission: 'analytics:read',
      keywords: ['analytics', 'dashboard', 'events'],
      keywordsKey: 'actions.openAnalytics.keywords',
      weight: 230,
    },
  ],
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
      {
        // Owner decisions 2026-10-27 (#465): the calendar reports count days
        // in, owned here so no single reporting module owns it. Projects
        // analytics reads it through `reportingTimeZonePort`; CRM may follow
        // (#474). Validated as an IANA zone (`services/reporting-time-zone.ts`).
        code: ANALYTICS_REPORTING_TIME_ZONE_SETTING,
        name: 'Reporting time zone',
        description:
          'The time zone, as an IANA name such as Europe/Warsaw, in which reports count days, months and other ' +
          'ranges of days — today, Projects analytics. Default UTC. While Analytics is switched off, reports count in UTC.',
        groupCode: 'analytics',
        valueType: 'string',
        defaultValue: 'UTC',
      },
    ],
  },
  activation: { settingCode: 'analytics.enabled', default: true },
});
