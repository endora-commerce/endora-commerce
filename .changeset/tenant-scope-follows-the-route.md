---
'@endora-commerce/platform': patch
'@endora-commerce/mod-auth': patch
---

**The route decides which session scopes a request — upgrade.** A browser can hold an admin
session and a customer session at once: an operator who is also signed in to the storefront, and
every request made while impersonating a customer. A request to an admin route from such a
browser was authorized as the admin and ran in the **customer's** tenant scope: admin screens
were narrowed to that customer's organization, actions reserved for a platform administrator
were refused, and audit entries written through the Command Bus did not record the admin. The
fix is to upgrade; nothing in an instance has to be edited.

The rule, from this version on:

- a route behind the admin guard (`requireAdmin`, `requireAdminAny`) runs as the admin, in the
  scope the admin's role resolves to, and a Command it runs records the admin as its actor —
  also when a customer session is present;
- a route behind the customer guard (`requireCustomer`) runs as the customer, in the customer's
  scope — also when an admin session is present. During impersonation it keeps the customer's
  view and records the customer with the impersonating admin, as before;
- a route behind neither keeps the scope of the request's ambient actor, as before;
- a guard still refuses a request that carries only the other session, and never falls back to
  that session's scope.

Upgrade `@endora-commerce/platform` and `@endora-commerce/mod-auth` together: the guards call a
function the platform publishes from this version on.

For a module or host that publishes a guard of its own which chooses between sessions:
`@endora-commerce/platform/kernel` exports `scopeRequestToActor(request)`. Call it after putting
the accepted actor on `request.actor`; the platform derives the request's tenant context again
through the composition's own mapping. It takes no context, does nothing when the context was
already derived from that actor, and rejects — so the guard should refuse — when the mapping
does. A guard that only checks `request.actor`, and every route using the guards
`@endora-commerce/mod-auth` registers, needs no change.
