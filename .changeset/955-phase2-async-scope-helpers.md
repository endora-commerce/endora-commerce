---
'@endora-commerce/platform': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-quick-order': minor
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-mfa': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-projects': patch
---

**Breaking (0.x, so `minor`):** a sales representative's reach is no longer computed on every admin request (issue #955, owner ruling of 2026-11-10). `@endora-commerce/platform/tenancy` removes `isOrgInScope(id, ctx?)` and `ruleVisibleForScope(ids, ctx?)` — use `await orgInScope(id, ctx?)` and `await ruleInScope(ids, ctx?)`, or `const inScope = await orgScopeTest(ctx?)` for a synchronous predicate over rows you already hold — and `assignedOrganizationIdsForRanking(ctx?)` now returns a promise. They were removed rather than retyped because `if (!isOrgInScope(x))` over a promise is always false.

`AdminTenantScope`'s `excluding` member (`@endora-commerce/contracts`) replaces `excludedOrganizationIds` / `assignedOrganizationIds` with `loadReach(): Promise<{ excludedOrganizationIds, assignedOrganizationIds }>`, beside `excludedOrganizationsQuery`; the platform memoises it once per tenant context, and a failure rejects every helper that awaits it. `OrgConstraint`'s `excluded` arm and `AdminScopeInput` follow. `PreferenceActor`'s `salesperson.reaches(id)` returns `Promise<boolean>`, and `canManagePreference` (`quick_order`) is async. `adminTenantScopePort` (`organizations`) answers without calling `reachOf`. The listed modules move their call sites to the async helpers.
