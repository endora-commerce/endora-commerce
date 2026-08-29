---
'@endora-commerce/contracts': minor
---

Publish `ModuleRecentActivity` — a fifth export a module's `manifest.ts` may
declare, beside `installHook`, `uninstallHook`, `lifecycleParticipant` and
`cliCommands`, carried on `ModuleManifestExports.recentActivity`.

A module **declares** that its activity is eligible for the admin home
dashboard's Recent Activity card; the operator **decides** whether it appears,
and the default is that it does. That is Constitution XVII's two-axis shape
applied to a narrower object: a module author cannot put entries on somebody's
home screen by fiat, and an operator cannot be surprised by a card they did not
configure.

```ts
// <module>/manifest.ts
export const recentActivity = defineModuleRecentActivity({
  entries: [
    { action: 'product.create', icon: 'Plus', labelKey: 'activity.verb.product.create' },
  ],
});
```

`action` is the `audit_log_entries.action` token, matched against the exported
`auditActionRe`. `icon` comes from the existing `KnownIconNameSchema`, so the
Admin SPA maps it through the one icon map it already has and a package cannot
name a component the app does not bundle. `labelKey` is **relative to the
declaring module's i18n namespace**, exactly as a command-palette action's
`labelKey` is, which is what lets a third-party package's verb render in the
operator's language from the package's own bundle.

The operator's half needs no declaration and takes none. Three new functions
derive it:

- `recentActivityVisibilitySettingCode(moduleId)` → `<moduleId>.recent_activity_visible`,
  throwing `RecentActivitySettingCodeInvalid` for a module id that cannot carry
  a setting code (a platform-internal, underscore-prefixed one). Derived rather
  than declared because the ruling fixes the default, so there is nothing left
  for a declaration to carry — and a declared code would be one more place a
  module could disagree with the platform about its own name.
- `settingsManifestWithRecentActivity(manifest, recentActivity)` merges that
  Setting into the module's own settings manifest, `hidden: true` and defaulting
  to `true`. One derivation, two callers — the boot reconcile and the lifecycle
  orchestrator's `install`, which is a package's only settings author.
- `defineModuleRecentActivity` is the identity-with-validation helper, the twin
  of `defineModuleManifest`.

`KnownIconNameSchema` gains six names — `Edit`, `Archive`, `Box`, `Truck`,
`CircleDollarSign`, `Activity` — the icons the dashboard's renderings used while
they were a hand-maintained table in the Admin SPA.

Additive: no existing export changed shape, and a `manifest.ts` that declares no
recent-activity eligibility is unaffected.
