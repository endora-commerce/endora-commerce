---
'@endora-commerce/admin-kit': minor
'@endora-commerce/mod-i18n': patch
---

**`@endora-commerce/admin-kit/components`** adds `ImmediateBadge`, the one "Applies immediately" badge for the heading of a section whose controls write at once, outside the page's one Save (issue #407, `specs/180-one-save-zone-editors/` FR-061). Text with a decorative icon, drawn with the info tokens the product editor used. An optional `className` places it and is merged last, so a caller's spacing class replaces the badge's own. Its string is `saveSession.immediateBadge` in the `core` catalogue (English and Polish), which `@endora-commerce/mod-i18n` now ships.
