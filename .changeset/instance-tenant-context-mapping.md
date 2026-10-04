---
'@endora-commerce/platform': patch
'@endora-commerce/contracts': patch
'@endora-commerce/mod-organizations': patch
---

**Tenant isolation fix for scaffolded instances — upgrade.** Every instance scaffolded from the
published packages up to and including 0.102.0 is affected. In such an instance requests were not
confined to the organization of the customer or API key making them, and an admin's scope was not
resolved from the admin's role: every request ran in the platform's system tenant scope, and
audit entries written through the Command Bus did not record the acting admin. The fix is to
upgrade; nothing in the instance has to be edited.

`composeApp` used to leave the actor → tenant-context mapping to its caller and fall back to a
system context when none was supplied, which is what an instance's entry point does. The mapping
is the platform's own now and every composition gets it:

- a customer is confined to its organization, widened to that organization's subtree only for an
  account with roll-up enabled;
- an admin gets the scope its role resolves to — every organization, or the organizations
  assigned to a sales representative;
- an API key bound to an organization is confined to that organization and its service account;
- system scope remains for a request that identifies nobody (anonymous traffic, an unbound API
  key) and for work with no request at all.

It fails closed. A composition that does not register the ports the mapping reads confines
rather than widens: a customer stays on its own organization and an admin reaches no
organization.

For a host that composes the platform itself:

- `ComposeAppOptions.buildTenantContext` is still accepted and should normally be omitted. A
  supplied mapping that answers a customer or an admin request with a system context is now
  refused, and that request fails.
- `@endora-commerce/mod-organizations` registers a new port, `adminTenantScopePort`
  (`AdminTenantScopePort` and `AdminTenantScope` in `@endora-commerce/contracts`):
  `resolveForAdmin(adminUserId)` answers `{ allowAll: true }` or
  `{ allowAll: false, allowedOrganizationIds }`. The platform reads it by container name; a
  composition that replaces `organizations` should register its own.
