---
'@endora-commerce/contracts': minor
---

Members, invitations and session views name the organization role (`specs/170-organization-roles/`, WP-03). Breaking for an implementer of the changed port or a reader of the changed response types:

- `OrganizationRoleReadPort` gains `roleRef(organizationId, roleId, language?)` answering `OrganizationRoleRef | null` — `{ id, name, kind }`, with a predefined role's name translated.
- The deprecated `role` of `customerAccountSchema`, of `customerLoginResponseSchema`'s `customerAccount` and of `impersonationStartResponseSchema`'s `impersonatedCustomerAccount` becomes optional: the server no longer sends it. Read `organizationRole` (`{ id, name, kind }`) and, on the session views, `permissions: string[]`.
- `RfqCustomerContext.isOrgAdmin` becomes optional (`isOrgAdmin?: boolean`, was `isOrgAdmin: boolean`); absent reads as `false`.
- `customerSelfProfileSchema` (`GET /api/v1/me/customer`) gains the `organizationRole` (`{ id, name, kind }`) and `permissions: string[]` the endpoint answers.
