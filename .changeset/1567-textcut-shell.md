---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-admin-users': patch
'@endora-commerce/mod-admin-search': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-analytics': patch
'@endora-commerce/mod-admin-notifications': patch
'@endora-commerce/mod-admin-feedback': patch
---

Shorter admin copy on the system screens (UX audit text-to-cut, part of issue #1567). The English and Polish text of these keys is shorter: `core` `platform.commandHooks.outbox.hint`, `platform.apiDescription.reference.body`, `adminUsers.resetPassword.hint`, `profile.authorHelp` and `appShell.noRole.description` (the command-line remedy is now in the getting-started guide); `settings` `activation.managedOnPlatformScreen`; `admin_users` `roles.twoFactor.help` and `roles.twoFactor.mfaOff`; `sales_channels` `identity.code.lockedHelp` and `identity.theme.help`; and the setting descriptions `analytics.reporting_time_zone`, `admin_notifications.enabled` and `admin_feedback.module_enabled`.

On the Global search screen the sentence before the Settings link is gone, and the link reads "Search limits". The key `admin_search` `page.configuration.settingsNote` is removed from both `en` and `pl`, and `page.configuration.settingsLink` has new text. A deployment that overrides any of these keys keeps its own text.
