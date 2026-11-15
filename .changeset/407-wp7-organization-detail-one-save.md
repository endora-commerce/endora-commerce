---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-price-lists': minor
---

The organization detail screen now has one Save for the whole page (issue #407, `specs/180-one-save-zone-editors/` WP-7).

**mod-organizations:**
- The screen runs a save session, one per organization, and passes it to `organization.detail.after`. The Save button sits in the page header (a sticky bar at the bottom on narrow screens). It reads "Save" or "Save n changes" and does nothing while there is nothing to save.
- Status, VAT status, order-confirmation e-mails, fulfilment strategy, restrictions and custom fields no longer save on change, on blur or through their own Save buttons. They are staged and written by the page's Save: first one `PATCH /api/v1/admin/organizations/:id` with `expectedUpdatedAt`, carrying only the fields that changed, then, if the allow-lists changed, the `PUT …/restrictions` with the version the `PATCH` returned. After that come the panels, in zone order.
- If either write answers `VERSION_CONFLICT`, no panel is written. The organization is reloaded, every unsaved change on the page (the screen's and every panel's) is discarded, and the screen says so. If a panel fails after the organization saved, a summary reports what was saved and what was not, and the next Save writes only what is left.
- Members (invite, direct add, role, edit, remove), hierarchy, moderation, VAT validation, sales channels, roles and sales representatives still apply immediately. Each of these sections now carries an "Applies immediately" badge.
- Leaving the page with unsaved changes asks first.
- An operator without `customers:manage` sees status, VAT status, e-mails, fulfilment strategy, restrictions and custom fields read-only. The page's Save would never write them for that operator.
- New strings in English and Polish: `detail.save.hostPartLabel` and `detail.save.conflict`. The badge is `@endora-commerce/admin-kit`'s `ImmediateBadge`.

**mod-price-lists:**
- The organization detail's display-mode panel passes that screen's session, so the display mode is saved by the page's Save instead of on change. No host is left without a session, so `DisplayModeOverrideRow` now requires `saveSession`, and its save-on-change branch and its "saved" suffix are gone.
