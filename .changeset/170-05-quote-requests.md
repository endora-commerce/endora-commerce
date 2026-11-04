---
'@endora-commerce/mod-quote-requests': minor
---

Quote requests gated by organization permissions (`specs/170-organization-roles/`, WP-05). Breaking for a composition or a caller of the changed shapes:

- The manifest declares the organization permission `quote_requests.create` (*Create quote requests*, held by the *Member* role by default), with EN and PL labels. `POST /api/v1/quote-requests` and `POST /api/v1/quote-requests/:id/resubmit` require it, and `POST /api/v1/quote-requests/:id/convert-to-order` requires `carts.create`; a member lacking the code is refused `403 ORGANIZATION_PERMISSION_REQUIRED` before the body is validated.
- Seeing every quote request of the Organization (`GET /api/v1/quote-requests`, the detail and every action on one) is judged by `organizationPermissionPort.isAdministrator` — the *Administrator* role the member holds — instead of the legacy `role` column.
- `CustomerContext` (the shape `CustomerContextResolver` answers) loses `isOrgAdmin: boolean` and gains the optional `organizationRoleId?: string | null`; the default `rfqCustomerContextResolver` no longer reads `customerAccountReadPort`.
- `QuoteRequestsModuleOptions` and `QuoteRequestsCustomerDeps` gain the required `organizationPermissions: () => OrganizationPermissionPort`; `RfqServiceDeps` gains the required `organizationPermissions: () => Pick<OrganizationPermissionPort, 'isAdministrator'>`.
- `RfqService.listForCustomer` (the `RfqCustomerPort` method) always answers the account's own quote requests; the storefront list is the new `RfqService.listVisibleForCustomer`.
