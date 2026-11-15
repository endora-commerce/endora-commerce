---
'@endora-commerce/mod-customers': minor
---

The customer detail screen now has one Save for everything that waits to be saved (issue #407, `specs/180-one-save-zone-editors/` WP-8).

- The screen runs a save session, one per open customer, and passes it to `customer.detail.after`, so the panels contributed there save with the page.
- A Save button in the page head reads "Save" or "Save n changes", counting the edited custom fields plus every panel's changes. It does nothing while there is nothing to save, and it is not shown to an operator without `customers:manage` when no panel can be written.
- The custom fields no longer have a Save button of their own. Save writes them first, through the same `PATCH /api/v1/admin/customers/:id/custom-fields`, then the panels in zone order. If the custom-field write is refused, no panel is written and the refusal is shown at its field. If a panel fails after the custom fields saved, a summary at the top of the screen says what was saved and what was not; the next Save writes only what is left.
- Leaving the page or closing the browser tab with unsaved changes asks first.
- Block, unblock, password reset, two-step verification reset, impersonation, delete and restore, and the organization and customer-group assignments still apply at once. Their sections now carry an "Applies immediately" badge.
- New strings in English and Polish: `detail.save.hostPartLabel` and `detail.immediate.badge`.
