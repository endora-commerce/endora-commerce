---
'@endora-commerce/mod-quote-requests': minor
---

Quote request notification records name new recipients (issue #238,
`specs/179-rfq-and-customer-notifications/` WP-03). The records are still not delivered; the
delivery worker comes with a later release.

- **Buyer side.** The account that raised the request, and every member of its Organization who
  may open the request on the storefront. Today that is a member holding the Organization's
  *Administrator* role. A member who holds only *Member* rights and did not raise the request is
  not recorded. Deleted, blocked and anonymised accounts are skipped. A requester who is also an
  *Administrator* is recorded once per channel. In a personal Organization only the requester is
  recorded.
- **Operator side.** The administrator the request is assigned to, plus the representatives
  assigned to the Organization. Each one is kept only while active and holding `rfqs:handle`. The
  full-access role counts. When nobody remains, every active administrator holding `rfqs:handle`
  is recorded. Before this change every administrator was recorded, whatever their permissions.
- The storefront check that lets a member see every quote request of their Organization uses the
  same rule. It reads the Organization's *Administrator* role through `organizationRoleReadPort`
  and no longer asks `organizationPermissionPort.isAdministrator`. Who sees what is unchanged.

The module now resolves `organizationRoleReadPort` (`organizations`) and `permissionService`
(`admin_roles`). Both owners are already among its dependencies.
