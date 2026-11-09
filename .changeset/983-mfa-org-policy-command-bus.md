---
'@endora-commerce/mod-mfa': patch
---

An organization's 2FA enforcement is now written through the Command Bus, from the storefront
(`PUT /api/v1/account/organization/mfa-policy`) and from the Admin UI
(`POST /api/v1/admin/organizations/:organizationId/mfa-policy`). Each write records one
`mfa.org_enforced` audit entry on the `organization`, in the same transaction as the write,
with the actor taken from the request and the replaced value as its before-state. The
routes no longer record that entry themselves after the write, and the second
`mfa.set_org_enforcement` entry (object type `mfa_organization_policy`) the service recorded for
the same write is no longer written.
