---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-projects': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-analytics': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-price-lists': minor
'@endora-commerce/mod-returns': minor
---

One sales-representative reach rule on every admin surface (issue #305, owner ruling 2026-11-07). A sales representative reaches every Organization not governed by another representative — the ones assigned to them (with `organizations:rollup`, their subtrees, the nearest assignment winning) and every Organization nobody is assigned to. `adminTenantScopePort` answers that reach as its complement, computed in one statement per request (`SalesRepAssignmentService.reachOf`), so the tenant-scoped reads and writes of every module, the Organizations list and its pickers, admin search and the Organization screens answer by the same rule. Every module that read the reach as a list of assigned ids now reads it through the platform's helpers.

`mod-orders`: `resolveAdminOrdersScope` answers `{ allowAll: boolean }` (was `{ allowAll: false, allowedOrganizationIds }`); the list's reach is the ambient tenant context's. `mod-customers`: `ResolveModerationActor` answers `{ adminUserId, isPlatformAdmin }` (was with `allowedOrganizationIds`).

**Behaviour change on upgrade.** Every sales representative gains the tenant data of every unassigned Organization — members, customers, orders, invoices, carts, returns, quote requests and customer-level settings — and, since no representative can be assigned to a personal Organization, of every B2C customer (confirmed by the owner on 2026-11-08). The Organizations list, its pickers and admin search stop showing Organizations assigned to other representatives. A sales representative with no assignment used to be treated as a platform administrator by the quick-order default-preference routes; they now manage only the Organizations they reach, and a write naming an Organization that does not exist answers `404 NOT_FOUND`. The read-only query in *Upgrading an instance* ("One sales-representative reach rule on every surface") counts, per representative, what they gain and what leaves their lists.
