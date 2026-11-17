---
'@endora-commerce/mod-carts': patch
'@endora-commerce/admin-kit': patch
'@endora-commerce/mod-i18n': patch
---

The admin carts list now shows translated labels (EN and PL) for the cart status and the approval status, in both filter selects and in the status badges. Before, it showed the raw codes, such as `rejected_by_org_admin`. The screen's title, description, column headings and empty and loading text were missing from the `carts` catalogue, so they appeared as raw keys. They are now in the catalogue too, with the new `carts.status.<code>` and `carts.approvalStatus.<code>` keys.

`OrganizationStatusBadge` now reads its labels from the `core` catalogue (`organizationStatusBadge.<status>`, EN and PL) instead of hard-coded English. The badge is used in the organizations list, the moderation panel and the organization pickers. The English labels are unchanged.
