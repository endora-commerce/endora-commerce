---
'@endora-commerce/mod-mfa': patch
---

An organization's 2FA enforcement is now written through the Command Bus, from the storefront
(`PUT /api/v1/account/organization/mfa-policy`) and from the Admin UI
(`POST /api/v1/admin/organizations/:organizationId/mfa-policy`). The audit trail changes as
follows:

- each write records **one** entry instead of two: `mfa.org_enforced` on the `organization`,
  written in the same transaction as the write;
- `mfa.set_org_enforcement` (object type `mfa_organization_policy`) is no longer written;
- `stateBefore` now carries the replaced value (`{ enforceTotp }`, or `null` for an
  organization's first policy) instead of always `null`;
- the storefront administrator's write now records the acting customer account, where it
  recorded no actor before.
