---
'@endora-commerce/test-kit': minor
---

**`@endora-commerce/test-kit/module`** adds request-scope helpers (issue #1072). `installRequestScope(app, { buildTenantContext })` mounts the platform's real per-request scope hook on a test's own Fastify app, so that every handler runs inside the tenant context the mapping derives for its request. A rejected mapping fails the request. `tenantFor(actor, adminScope?)` returns the tenant context the platform derives for a customer, admin or API-key actor. `systemTenant(reason?)` returns the system context, and its reason defaults to `test`. The actor and admin-scope types are exported as `TestTenantActor` and `TestAdminScope`. The platform primitives behind these helpers are not re-exported.
