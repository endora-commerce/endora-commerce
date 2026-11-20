---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The Modules screen (`/platform/modules`) is easier to scan (UX audit SHELL-12, issue #1520). It has a search box that matches the module's name, id or description and ignores case and diacritics. Filter chips (On · Off · Not offered · Locked) show how many modules each one holds, and the modules are grouped under the sidebar section their screens are in. Modules without a screen are listed last, under "Other modules".

Switching a module on or off is now a switch in the *Your business* column. Before, every module that was off showed a filled "Switch on" button. Turning a module off still asks for confirmation. A module that cannot be switched off shows a locked switch with its reason as the tooltip and the description, instead of printing the reason twice. The Recent Activity choice is a switch in a new *Dashboard* column, which is shown only to an admin who may change it. A module's description, dependencies and lock reason are behind a disclosure on its row. What either switch does is unchanged.

`ListPage` takes an optional `help`, passed to `PageHeader`'s ⓘ.

Removed `core` keys: `platform.modules.column.actions`, `platform.modules.action.enable` and `platform.modules.recentActivity.{shown,hidden,hint}`. An overlay that overrides them should override the new `platform.modules.*` keys instead.
