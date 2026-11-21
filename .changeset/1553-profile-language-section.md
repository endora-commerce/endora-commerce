---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The **My profile** screen no longer has its own **Language** card (issue #1553, UX audit SHELL-17). The card had a second filled Save that competed with the form's, and it repeated the language menu in the top bar, which already saves the choice at once. The UI language is now changed only from the top bar; one muted line in the profile's **Identity** section says so. The Admin UI languages documentation page describes the top-bar menu instead of the removed card.

`core` bundle keys removed: `profilePage.language.action.save`, `profilePage.language.failed`, `profilePage.language.saved`, `profilePage.section.language` and `profilePage.section.language.help`. A deployment that overrides them can drop the overrides. `profilePage.language.option.en` and `profilePage.language.option.pl` stay: the top-bar menu uses them. New key: `profile.languageHelp`, in English and Polish.
