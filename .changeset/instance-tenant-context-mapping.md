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

**Upgrade all `@endora-commerce/*` packages together.** The platform reads the admin's scope
from a port `@endora-commerce/mod-organizations` registers from this version on. With the
platform upgraded and that package left behind, every admin — a platform administrator included —
is confined to no organization and organization-scoped screens are empty; the platform logs a
warning at boot naming `adminTenantScopePort` when that is the case.

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
organization. The same holds for an admin while `organizations`, `admin_users` or `admin_roles`
is absent: the admin holds no organization, routes over global data keep answering, and a route
that reads organization data answers 503 `MODULE_DISABLED` naming the absent module.

A browser may hold an admin session and a customer session at once — an operator who is also
signed in to the storefront, and every request made while impersonating a customer. The route
decides which of the two a request runs as: an admin route runs in the admin's scope and a
storefront route in the customer's, whichever cookies are present. Admin screens are therefore
unaffected by a customer session in the same browser.

For a host that composes the platform itself:

- `ComposeAppOptions.buildTenantContext` is still accepted and should normally be omitted. A
  supplied mapping is now refused, and the request fails, when it answers a customer or an API
  key bound to an organization with a `system` or `all` context, or an admin with a `system`
  context.
- `@endora-commerce/mod-organizations` registers a new port, `adminTenantScopePort`
  (`AdminTenantScopePort` and `AdminTenantScope` in `@endora-commerce/contracts`):
  `resolveForAdmin(adminUserId)` answers `{ allowAll: true }` or
  `{ allowAll: false, allowedOrganizationIds }`. The platform reads it by container name; a
  composition that replaces `organizations` should register its own.
